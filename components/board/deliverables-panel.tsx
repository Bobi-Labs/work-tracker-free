"use client";

/**
 * The deliverables panel — "show the work".
 *
 * A deliverable is a unit of work you can *hand to someone*: a page, a feature,
 * a report. It carries a scope, a guide, build notes, and the open questions
 * blocking it. The Kanban board tracks tasks; this tracks the things those tasks
 * add up to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED FROM THE PRIVATE APP'S PANEL (and why)
 *
 * 1. **There is now a create path.** The private panel had none — its empty
 *    state instructed the reader to "Insert rows in deliverable_items /
 *    deliverable_questions to populate". That is a SQL console wearing a UI's
 *    clothes, and it is the single biggest reason this file is a rebuild rather
 *    than a port. Deliverables, questions, and answers are all created, edited,
 *    reordered, and deleted from here.
 *
 * 2. **No client is threaded through.** The original passed a live `supabase`
 *    client down as a prop into five sub-components, so every leaf could write
 *    to Postgres on its own. Here, every sub-component takes plain data and
 *    callbacks; *this* component is the only thing that touches the store. That
 *    is not a stylistic preference — it is what lets `handleUpdate` below fix a
 *    tab-move's `sortOrder` in one place instead of five.
 *
 * 3. **No editor gate.** `canEdit` came from an email allowlist. There is one
 *    user, it is their machine, and everything is editable.
 *
 * 4. **Invoices, updates, and discovery plans are gone.** Invoices drag in
 *    currency, tax, and rounding. The "updates" feature's category icons were
 *    literally one client's expense categories (vehicle, travel, purchases,
 *    premises), business logic specific to them that has no place in a
 *    general tool.
 *
 * Everything is board-scoped: deliverables live inside the `BoardDoc`, with
 * their questions embedded. Nothing here fetches, and nothing here can fail —
 * the store's mutations are synchronous memory writes. There is no loading
 * state to model and no error to catch.
 */

import { memo, useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  HelpCircle,
  Layers,
  Package,
  Pencil,
  Plus,
  Save,
  Trash2,
  Truck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/board/markdown";
import type { DeliverablePatch, QuestionPatch } from "@/lib/store/board-doc";
import { useBoard, useBoardStore } from "@/lib/store/use-board";
import {
  deliverableStatusColors,
  deliverableStatusLabels,
  deliverableTabLabels,
  deliverableTabOrder,
  questionStatusLabels,
  storableDeliverableTabs,
  type Deliverable,
  type DeliverableStatus,
  type DeliverableTab,
  type Question,
} from "@/lib/types";

/** Every tab a deliverable can actually be filed under. `questions` is virtual. */
type StorableTab = Exclude<DeliverableTab, "questions">;

/* ───────────────────────────── Constants ───────────────────────────── */

const TAB_CONFIG: Record<
  DeliverableTab,
  { icon: typeof Layers; activeCls: string }
> = {
  backlog: {
    icon: Layers,
    activeCls: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  },
  ongoing: {
    icon: FileText,
    activeCls: "bg-primary/10 text-primary border-primary/30",
  },
  delivered: {
    icon: Truck,
    activeCls: "bg-green-500/10 text-green-400 border-green-500/30",
  },
  questions: {
    icon: HelpCircle,
    activeCls: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  },
};

/**
 * Empty-state copy. The point of these strings is to teach someone who has
 * never seen this panel what a deliverable *is* — they are the only onboarding
 * this feature gets. They must never mention tables, rows, or SQL.
 */
const EMPTY_COPY: Record<StorableTab, { title: string; body: string }> = {
  backlog: {
    title: "Nothing in the backlog yet",
    body: "A deliverable is a chunk of work you could hand to someone: a page, a feature, a report. Park the ones you haven't started here, with a note on what they involve.",
  },
  ongoing: {
    title: "No work in progress",
    body: "This is where a deliverable lives while you're building it. Move one over from the backlog when you start, or create it here.",
  },
  delivered: {
    title: "Nothing delivered yet",
    body: "Finished deliverables land here with scope, notes and answered questions intact, so you can show what was done without reconstructing it from memory.",
  },
};

/* ───────────────────────────── Ordering helpers ───────────────────────────── */

/**
 * `createdAt` is the tiebreak, not an afterthought: the store hands out
 * `sortOrder: 0` to anything created without one, so several deliverables can
 * genuinely tie. Without a stable second key their order flickers between
 * renders.
 */
function byOrder<T extends { sortOrder: number; createdAt: string }>(
  a: T,
  b: T,
): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/** `sortOrder` for a new entry appended to `list`. Empty list → 0. */
function nextSortOrder(list: readonly { sortOrder: number }[]): number {
  return list.reduce((max, x) => Math.max(max, x.sortOrder), -10) + 10;
}

/**
 * The id list `reorderDeliverables` / `reorderQuestions` want, with one entry
 * moved by `delta`. Returns `null` at the ends of the list — a no-op reorder
 * would still bump `updatedAt` and re-sort the board picker.
 */
function movedIds<T extends { id: string }>(
  ordered: readonly T[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const index = ordered.findIndex((x) => x.id === id);
  if (index < 0) return null;

  const target = index + delta;
  if (target < 0 || target >= ordered.length) return null;

  const ids = ordered.map((x) => x.id);
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved!);
  return ids;
}

const openCount = (questions: readonly Question[]): number =>
  questions.filter((q) => q.status === "open").length;

/* ───────────────────────────── Handler bundle ─────────────────────────────
 * Every write in this file goes through one of these. They are created once, in
 * the panel, and passed down — the leaves are pure. (The original threaded a
 * live database client into the leaves instead; see the header note.)
 */

interface Handlers {
  onUpdate: (id: string, patch: DeliverablePatch) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  /** Clears the "just created, open it in edit mode" flag. */
  onEditDone: () => void;
  onAddQuestion: (deliverableId: string, questionMd: string) => void;
  onUpdateQuestion: (
    deliverableId: string,
    questionId: string,
    patch: QuestionPatch,
  ) => void;
  onDeleteQuestion: (deliverableId: string, questionId: string) => void;
  onMoveQuestion: (
    deliverableId: string,
    questionId: string,
    delta: -1 | 1,
  ) => void;
}

/* ═══════════════════════════════ Panel ═══════════════════════════════ */

export function DeliverablesPanel() {
  const store = useBoardStore();
  const doc = useBoard(store);

  const [tab, setTab] = useState<DeliverableTab>("backlog");
  const [composing, setComposing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  /** The deliverable created a moment ago — mounts expanded, in edit mode. */
  const [freshId, setFreshId] = useState<string | null>(null);

  const deliverables = doc.deliverables;

  const byTab = useMemo(() => {
    const map: Record<StorableTab, Deliverable[]> = {
      backlog: [],
      ongoing: [],
      delivered: [],
    };
    for (const d of deliverables) map[d.tab].push(d);
    for (const key of storableDeliverableTabs) map[key].sort(byOrder);
    return map;
  }, [deliverables]);

  /** The Questions badge counts OPEN QUESTIONS, not deliverables. */
  const totalOpenQuestions = useMemo(
    () => deliverables.reduce((n, d) => n + openCount(d.questions), 0),
    [deliverables],
  );

  const counts: Record<DeliverableTab, number> = {
    backlog: byTab.backlog.length,
    ongoing: byTab.ongoing.length,
    delivered: byTab.delivered.length,
    questions: totalOpenQuestions,
  };

  /* ── writes ──
   * Each of these reads the live document via `store.getSnapshot()` rather than
   * closing over `doc`, so the callbacks stay referentially stable and the
   * memoised cards below don't re-render on every keystroke elsewhere.
   */

  const handleUpdate = useCallback(
    (id: string, patch: DeliverablePatch) => {
      const all = store.getSnapshot().deliverables;
      const current = all.find((d) => d.id === id);

      // Moving a deliverable to another tab carries its old `sortOrder` with it,
      // where it collides with whatever is already there and drops the card into
      // an arbitrary slot. Re-seat it at the end of the destination instead.
      if (current && patch.tab && patch.tab !== current.tab) {
        const destination = all.filter((d) => d.tab === patch.tab);
        store.updateDeliverable(id, {
          ...patch,
          sortOrder: nextSortOrder(destination),
        });
        return;
      }

      store.updateDeliverable(id, patch);
    },
    [store],
  );

  const handleDelete = useCallback(
    (id: string) => {
      store.deleteDeliverable(id);
      setFreshId((prev) => (prev === id ? null : prev));
    },
    [store],
  );

  const handleMove = useCallback(
    (id: string, delta: -1 | 1) => {
      const all = store.getSnapshot().deliverables;
      const target = all.find((d) => d.id === id);
      if (!target) return;

      const siblings = all.filter((d) => d.tab === target.tab).sort(byOrder);
      const ids = movedIds(siblings, id, delta);
      // Only this tab's ids are passed. `reorderDeliverables` assigns `tab` to
      // every id it is handed, so a stray id from another tab would silently
      // move that deliverable across tabs.
      if (ids) store.reorderDeliverables(target.tab, ids);
    },
    [store],
  );

  const handleEditDone = useCallback(() => setFreshId(null), []);

  const handleAddQuestion = useCallback(
    (deliverableId: string, questionMd: string) => {
      const text = questionMd.trim();
      if (!text) return;

      const deliverable = store
        .getSnapshot()
        .deliverables.find((d) => d.id === deliverableId);
      if (!deliverable) return;

      store.addQuestion(deliverableId, {
        questionMd: text,
        sortOrder: nextSortOrder(deliverable.questions),
      });
    },
    [store],
  );

  const handleUpdateQuestion = useCallback(
    (deliverableId: string, questionId: string, patch: QuestionPatch) => {
      store.updateQuestion(deliverableId, questionId, patch);
    },
    [store],
  );

  const handleDeleteQuestion = useCallback(
    (deliverableId: string, questionId: string) => {
      store.deleteQuestion(deliverableId, questionId);
    },
    [store],
  );

  const handleMoveQuestion = useCallback(
    (deliverableId: string, questionId: string, delta: -1 | 1) => {
      const deliverable = store
        .getSnapshot()
        .deliverables.find((d) => d.id === deliverableId);
      if (!deliverable) return;

      const ordered = [...deliverable.questions].sort(byOrder);
      const ids = movedIds(ordered, questionId, delta);
      if (ids) store.reorderQuestions(deliverableId, ids);
    },
    [store],
  );

  const handlers = useMemo<Handlers>(
    () => ({
      onUpdate: handleUpdate,
      onDelete: handleDelete,
      onMove: handleMove,
      onEditDone: handleEditDone,
      onAddQuestion: handleAddQuestion,
      onUpdateQuestion: handleUpdateQuestion,
      onDeleteQuestion: handleDeleteQuestion,
      onMoveQuestion: handleMoveQuestion,
    }),
    [
      handleUpdate,
      handleDelete,
      handleMove,
      handleEditDone,
      handleAddQuestion,
      handleUpdateQuestion,
      handleDeleteQuestion,
      handleMoveQuestion,
    ],
  );

  /* ── create ── */

  const activeStorableTab: StorableTab =
    tab === "questions" ? "backlog" : tab;

  const startComposing = () => {
    if (tab === "questions") setTab("backlog");
    setComposing(true);
  };

  const cancelComposing = () => {
    setComposing(false);
    setDraftTitle("");
  };

  const submitComposer = () => {
    const title = draftTitle.trim();
    if (!title) return;

    const created = store.addDeliverable({
      tab: activeStorableTab,
      title,
      sortOrder: nextSortOrder(byTab[activeStorableTab]),
    });

    setDraftTitle("");
    setComposing(false);
    // Mounts expanded and in edit mode, so a deliverable that exists as nothing
    // but a title lands you straight in the form that gives it a scope.
    setFreshId(created.id);
  };

  const switchTab = (next: DeliverableTab) => {
    setTab(next);
    setComposing(false);
    setDraftTitle("");
  };

  const list = tab === "questions" ? [] : byTab[tab];

  return (
    <div className="space-y-4">
      {/* Tab row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/50 p-1">
        {deliverableTabOrder.map((key) => {
          const config = TAB_CONFIG[key];
          const Icon = config.icon;
          const active = tab === key;
          const count = counts[key];

          return (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? config.activeCls
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {deliverableTabLabels[key]}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 font-mono text-[10px] ${
                    active ? "bg-background/40" : "bg-muted/60"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}

        <div className="flex-1" />

        {tab !== "questions" && !composing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={startComposing}
            className="h-7 gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            New deliverable
          </Button>
        )}
      </div>

      {/* Composer */}
      {composing && tab !== "questions" && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            New deliverable in {deliverableTabLabels[activeStorableTab]}
          </label>
          <Input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitComposer();
              if (e.key === "Escape") cancelComposing();
            }}
            placeholder="What is it? e.g. Pricing page"
            className="h-9"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={submitComposer}
              disabled={!draftTitle.trim()}
              className="h-7 gap-1.5 text-xs"
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancelComposing}
              className="h-7 gap-1.5 text-xs"
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Tab content */}
      {tab === "questions" ? (
        <QuestionsTab deliverables={deliverables} handlers={handlers} />
      ) : list.length === 0 ? (
        <EmptyTab tab={tab} onCreate={startComposing} />
      ) : (
        <div className="space-y-3">
          {list.map((deliverable, index) => {
            const shared = {
              deliverable,
              canMoveUp: index > 0,
              canMoveDown: index < list.length - 1,
              isFresh: deliverable.id === freshId,
              handlers,
            };

            if (tab === "delivered")
              return <DeliveredCard key={deliverable.id} {...shared} />;
            if (tab === "ongoing")
              return <OngoingCard key={deliverable.id} {...shared} />;
            return <BacklogCard key={deliverable.id} {...shared} />;
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Empty states ───────────────────────────── */

function EmptyTab({
  tab,
  onCreate,
}: {
  tab: StorableTab;
  onCreate: () => void;
}) {
  const copy = EMPTY_COPY[tab];
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-12 text-center">
      <Package className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
      <div className="text-sm font-medium text-foreground">{copy.title}</div>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
        {copy.body}
      </p>
      <Button size="sm" onClick={onCreate} className="mt-4 gap-1.5 text-xs">
        <Plus className="h-3.5 w-3.5" />
        New deliverable
      </Button>
    </div>
  );
}

/* ───────────────────────────── Cards ───────────────────────────── */

interface CardProps {
  deliverable: Deliverable;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Created seconds ago — mount expanded, in edit mode. */
  isFresh: boolean;
  handlers: Handlers;
}

/**
 * The reorder + expand controls every card shares. `stopPropagation` matters:
 * the whole header row is a button that toggles the card, so a bare click on
 * "move up" would also collapse the thing you just moved.
 */
function MoveButtons({
  id,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  id: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (id: string, delta: -1 | 1) => void;
}) {
  return (
    <div className="flex flex-shrink-0 flex-col">
      <button
        type="button"
        disabled={!canMoveUp}
        title="Move up"
        onClick={(e) => {
          e.stopPropagation();
          onMove(id, -1);
        }}
        className="text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
      >
        <ArrowUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        disabled={!canMoveDown}
        title="Move down"
        onClick={(e) => {
          e.stopPropagation();
          onMove(id, 1);
        }}
        className="text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
      >
        <ArrowDown className="h-3 w-3" />
      </button>
    </div>
  );
}

const DeliveredCard = memo(function DeliveredCard({
  deliverable,
  canMoveUp,
  canMoveDown,
  isFresh,
  handlers,
}: CardProps) {
  const [open, setOpen] = useState(isFresh);

  return (
    <div className="overflow-hidden rounded-lg border border-green-500/30 bg-green-500/5">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-green-400" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-green-400" />
          )}
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-400" />
          {deliverable.itemNumber && (
            <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
              {deliverable.itemNumber}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">
              {deliverable.title}
            </div>
            {deliverable.subtitle && (
              <div className="truncate text-xs text-muted-foreground">
                {deliverable.subtitle}
              </div>
            )}
          </div>
        </button>

        <StatusPill status={deliverable.status} />
        <MoveButtons
          id={deliverable.id}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMove={handlers.onMove}
        />
      </div>

      {open && (
        <div className="border-t border-green-500/30 bg-card/30">
          <CardBody
            deliverable={deliverable}
            isFresh={isFresh}
            handlers={handlers}
          />
        </div>
      )}
    </div>
  );
});

const OngoingCard = memo(function OngoingCard({
  deliverable,
  canMoveUp,
  canMoveDown,
  isFresh,
  handlers,
}: CardProps) {
  const [open, setOpen] = useState(isFresh);
  const openQuestions = openCount(deliverable.questions);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
          <Package className="h-4 w-4 flex-shrink-0 text-primary" />
          {deliverable.itemNumber && (
            <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
              {deliverable.itemNumber}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">
              {deliverable.title}
            </div>
            {deliverable.subtitle && (
              <div className="truncate text-xs text-muted-foreground">
                {deliverable.subtitle}
              </div>
            )}
          </div>
        </button>

        {openQuestions > 0 && (
          <span className="flex-shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            {openQuestions} open Q
          </span>
        )}
        <StatusPill status={deliverable.status} />
        <MoveButtons
          id={deliverable.id}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMove={handlers.onMove}
        />
      </div>

      {open && (
        <div className="border-t border-border bg-card/30">
          <CardBody
            deliverable={deliverable}
            isFresh={isFresh}
            handlers={handlers}
          />
        </div>
      )}
    </div>
  );
});

/**
 * The backlog card keeps the private app's minimal collapsed look — number,
 * title, subtitle, status, and a two-line clamp of the scope.
 *
 * It is *expandable*, though, which the original was not. It had no reason to
 * be: nothing in that panel could be edited into existence, so a backlog row
 * was a read-only preview of a row someone had typed into Postgres. Here, a
 * deliverable is created in the backlog with nothing but a title — if the card
 * didn't open, the thing you just made would be permanently uneditable.
 */
const BacklogCard = memo(function BacklogCard({
  deliverable,
  canMoveUp,
  canMoveDown,
  isFresh,
  handlers,
}: CardProps) {
  const [open, setOpen] = useState(isFresh);

  return (
    <div className="overflow-hidden rounded-lg border border-purple-500/20 bg-purple-500/5">
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            {open ? (
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-purple-400" />
            ) : (
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-purple-400" />
            )}
            <Layers className="h-4 w-4 flex-shrink-0 text-purple-400" />
            {deliverable.itemNumber && (
              <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
                {deliverable.itemNumber}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {deliverable.title}
              </div>
              {deliverable.subtitle && (
                <div className="truncate text-xs text-muted-foreground">
                  {deliverable.subtitle}
                </div>
              )}
            </div>
          </button>

          <StatusPill status={deliverable.status} />
          <MoveButtons
            id={deliverable.id}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onMove={handlers.onMove}
          />
        </div>

        {!open && deliverable.scopeMd && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {deliverable.scopeMd}
          </p>
        )}
      </div>

      {open && (
        <div className="border-t border-purple-500/20 bg-card/30">
          <CardBody
            deliverable={deliverable}
            isFresh={isFresh}
            handlers={handlers}
          />
        </div>
      )}
    </div>
  );
});

function StatusPill({ status }: { status: DeliverableStatus }) {
  return (
    <span
      className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${deliverableStatusColors[status]}`}
    >
      {deliverableStatusLabels[status]}
    </span>
  );
}

/* ───────────────────────────── Card body ───────────────────────────── */

/**
 * The expanded contents, identical across all three tabs. The original had this
 * copy-pasted into `DeliveredCard` and `OngoingCard` with a sub-tab machine and
 * an invoice branch bolted on top of each.
 */
function CardBody({
  deliverable,
  isFresh,
  handlers,
}: {
  deliverable: Deliverable;
  isFresh: boolean;
  handlers: Handlers;
}) {
  const [editing, setEditing] = useState(isFresh);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasContent =
    !!deliverable.scopeMd || !!deliverable.guideMd || !!deliverable.buildNotesMd;

  const finishEditing = () => {
    setEditing(false);
    handlers.onEditDone();
  };

  if (editing) {
    return (
      <div className="px-4 py-4">
        <EditItemPanel
          deliverable={deliverable}
          onSave={(patch) => {
            handlers.onUpdate(deliverable.id, patch);
            finishEditing();
          }}
          onCancel={finishEditing}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      <MarkdownView label="Scope" value={deliverable.scopeMd} />
      <MarkdownView label="Guide" value={deliverable.guideMd} />
      <MarkdownView
        label="Build notes"
        value={deliverable.buildNotesMd}
        emphasis
      />

      {!hasContent && (
        <p className="text-xs italic text-muted-foreground">
          No scope yet. Edit this deliverable to say what it involves.
        </p>
      )}

      <QuestionSection
        deliverableId={deliverable.id}
        questions={deliverable.questions}
        handlers={handlers}
      />

      <div className="flex items-center gap-2 border-t border-border/60 pt-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(true)}
          className="h-7 gap-1.5 text-xs"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </Button>

        <div className="flex-1" />

        {/* Deletion takes a deliverable, its scope, its notes and every question
            on it. There is no server-side copy to restore from — so it confirms,
            exactly like the item delete does. */}
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-destructive">
              Delete this deliverable and its {deliverable.questions.length}{" "}
              question
              {deliverable.questions.length === 1 ? "" : "s"}?
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handlers.onDelete(deliverable.id)}
              className="h-7 text-[10px]"
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              className="h-7 text-[10px]"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
            className="h-7 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Markdown ───────────────────────────── */

/**
 * These fields were named `scopeMd` / `guideMd` / `buildNotesMd` from day one,
 * but until `components/board/markdown.tsx` existed they rendered as plain
 * text — the names wrote a cheque the component didn't cash. Now they render.
 */
function MarkdownView({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string | null | undefined;
  emphasis?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <Markdown
        text={value}
        className={
          emphasis
            ? "rounded-md border border-blue-500/20 bg-blue-500/5 p-2 text-blue-100"
            : "text-foreground"
        }
      />
    </div>
  );
}

/* ───────────────────────────── Edit form ───────────────────────────── */

/**
 * Ungated — there is no editor allowlist here.
 *
 * Two fields are typed rather than free text. `status` was an `<Input>` in the
 * original because the column was free-text Postgres; it is a union now, and a
 * typo'd status would fail zod on the *next load*, long after the mistake. The
 * `tab` select is new: without it a deliverable could never leave the backlog,
 * and "mark this delivered" is the entire point of the panel.
 */
function EditItemPanel({
  deliverable,
  onSave,
  onCancel,
}: {
  deliverable: Deliverable;
  onSave: (patch: DeliverablePatch) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    title: deliverable.title,
    subtitle: deliverable.subtitle ?? "",
    tab: deliverable.tab,
    status: deliverable.status,
    scopeMd: deliverable.scopeMd ?? "",
    guideMd: deliverable.guideMd ?? "",
    buildNotesMd: deliverable.buildNotesMd ?? "",
  });

  const handleSave = () => {
    const title = draft.title.trim();
    // A deliverable with no title is unfindable in every view. Keep the old one.
    if (!title) return;

    onSave({
      title,
      subtitle: draft.subtitle.trim() || null,
      tab: draft.tab,
      status: draft.status,
      scopeMd: draft.scopeMd.trim() || null,
      guideMd: draft.guideMd.trim() || null,
      buildNotesMd: draft.buildNotesMd.trim() || null,
    });
  };

  const textFields: {
    key: "scopeMd" | "guideMd" | "buildNotesMd";
    label: string;
    placeholder: string;
  }[] = [
    {
      key: "scopeMd",
      label: "Scope",
      placeholder: "What does this deliverable cover?",
    },
    {
      key: "guideMd",
      label: "Guide",
      placeholder: "How does someone use it?",
    },
    {
      key: "buildNotesMd",
      label: "Build notes",
      placeholder: "How it was built, decisions taken, gotchas…",
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
      <Input
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        placeholder="Title"
        className="h-9"
        autoFocus
      />
      <Input
        value={draft.subtitle}
        onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))}
        placeholder="Subtitle (optional)"
        className="h-9"
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
            Tab
          </label>
          <select
            value={draft.tab}
            onChange={(e) =>
              setDraft((d) => ({ ...d, tab: e.target.value as StorableTab }))
            }
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          >
            {storableDeliverableTabs.map((t) => (
              <option key={t} value={t}>
                {deliverableTabLabels[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
            Status
          </label>
          <select
            value={draft.status}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                status: e.target.value as DeliverableStatus,
              }))
            }
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
          >
            {(
              Object.keys(deliverableStatusLabels) as DeliverableStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {deliverableStatusLabels[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {textFields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
            {field.label}
          </label>
          <Textarea
            value={draft[field.key]}
            onChange={(e) =>
              setDraft((d) => ({ ...d, [field.key]: e.target.value }))
            }
            placeholder={field.placeholder}
            rows={4}
            className="text-sm"
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!draft.title.trim()}
          className="h-7 gap-1.5 text-xs"
        >
          <Save className="h-3 w-3" />
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="h-7 gap-1.5 text-xs"
        >
          <X className="h-3 w-3" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── Questions ───────────────────────────── */

/**
 * The questions on one deliverable, plus the composer that creates them. Used
 * both inside a card body and — grouped by deliverable — on the Questions tab,
 * so an answer typed in one place is the same write as in the other.
 */
function QuestionSection({
  deliverableId,
  questions,
  handlers,
}: {
  deliverableId: string;
  questions: Question[];
  handlers: Handlers;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");

  const ordered = useMemo(() => [...questions].sort(byOrder), [questions]);
  const open = openCount(questions);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    handlers.onAddQuestion(deliverableId, text);
    setDraft("");
    setComposing(false);
  };

  const cancel = () => {
    setComposing(false);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Questions
        </span>
        {open > 0 && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
            {open} open
          </span>
        )}
        <div className="flex-1" />
        {!composing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setComposing(true)}
            className="h-6 gap-1 text-[10px]"
          >
            <Plus className="h-3 w-3" />
            Add question
          </Button>
        )}
      </div>

      {ordered.length === 0 && !composing && (
        <p className="text-xs italic text-muted-foreground">
          Nothing open. Park anything you need someone else to decide here.
        </p>
      )}

      {ordered.map((question, index) => (
        <QuestionRow
          key={question.id}
          deliverableId={deliverableId}
          question={question}
          canMoveUp={index > 0}
          canMoveDown={index < ordered.length - 1}
          handlers={handlers}
        />
      ))}

      {composing && (
        <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              if (e.key === "Escape") cancel();
            }}
            rows={2}
            placeholder="What needs answering?"
            className="resize-none text-sm"
            autoFocus
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={submit}
              disabled={!draft.trim()}
              className="h-6 gap-1 text-[10px]"
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              className="h-6 gap-1 text-[10px]"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const QuestionRow = memo(function QuestionRow({
  deliverableId,
  question,
  canMoveUp,
  canMoveDown,
  handlers,
}: {
  deliverableId: string;
  question: Question;
  canMoveUp: boolean;
  canMoveDown: boolean;
  handlers: Handlers;
}) {
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(question.answerMd ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isOpen = question.status === "open";
  const tone =
    question.status === "answered"
      ? "border-green-500/30 bg-green-500/5"
      : question.status === "dismissed"
        ? "border-zinc-500/30 bg-zinc-500/5 opacity-60"
        : "border-amber-500/30 bg-amber-500/5";

  /**
   * The store owns the answer/status coupling (see `updateQuestion`):
   * an answer flips status to `answered` and stamps `answeredAt`; clearing it
   * reverts to `open` and nulls the stamp. So we send only `answerMd` and let
   * it derive the rest — replicating that logic here is how the two drift apart.
   */
  const saveAnswer = () => {
    handlers.onUpdateQuestion(deliverableId, question.id, {
      answerMd: answer.trim() || null,
    });
    setEditing(false);
  };

  /** An explicit `status` in the patch beats the derivation — that's dismiss. */
  const dismiss = () =>
    handlers.onUpdateQuestion(deliverableId, question.id, {
      status: "dismissed",
    });

  const reopen = () =>
    handlers.onUpdateQuestion(deliverableId, question.id, {
      status: question.answerMd?.trim() ? "answered" : "open",
    });

  return (
    <div className={`rounded-md border ${tone} p-2.5 text-sm`}>
      <div className="flex items-start gap-2">
        <HelpCircle
          className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${
            isOpen ? "text-amber-400" : "text-muted-foreground"
          }`}
        />
        {/* min-w-0: a code block in the question must scroll inside this
            flex child, not blow the row out past the panel edge. */}
        <div className="min-w-0 flex-1">
          <Markdown text={question.questionMd} className="space-y-1" />
        </div>
        <span className="flex-shrink-0 text-[9px] uppercase tracking-widest text-muted-foreground">
          {questionStatusLabels[question.status]}
        </span>
        <MoveButtons
          id={question.id}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMove={(_id, delta) =>
            handlers.onMoveQuestion(deliverableId, question.id, delta)
          }
        />
      </div>

      {(question.answerMd || editing) && (
        <div className="ml-5 mt-2 border-l-2 border-border pl-3">
          {editing ? (
            <div className="space-y-1.5">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                placeholder="Answer… (clearing this reopens the question)"
                className="text-sm"
                autoFocus
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={saveAnswer}
                  className="h-6 gap-1 text-[10px]"
                >
                  <Save className="h-3 w-3" />
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAnswer(question.answerMd ?? "");
                    setEditing(false);
                  }}
                  className="h-6 gap-1 text-[10px]"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {question.answerMd && (
                <Markdown
                  text={question.answerMd}
                  className="space-y-1 text-xs leading-relaxed"
                />
              )}
              {/* The original credited an answer to an email address. There is
                  one user and no auth, so the useful fact is *when*. */}
              {question.answeredAt && (
                <div className="mt-1 text-[10px] text-muted-foreground/60">
                  Answered{" "}
                  {new Date(question.answeredAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <div className="ml-5 mt-1.5 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {question.answerMd ? "Edit answer" : "Answer"}
          </button>

          {question.status === "dismissed" ? (
            <button
              type="button"
              onClick={reopen}
              className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Dismiss
            </button>
          )}

          <div className="flex-1" />

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-destructive">Delete?</span>
              <button
                type="button"
                onClick={() =>
                  handlers.onDeleteQuestion(deliverableId, question.id)
                }
                className="text-[10px] font-semibold text-destructive hover:underline"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              title="Delete question"
              className="text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/* ───────────────────────────── Questions tab ─────────────────────────────
 * Virtual: no deliverable is stored with `tab: "questions"`. It aggregates the
 * questions on every deliverable, ordering the deliverables with the most open
 * ones first — the tab exists to answer "what is blocking me", so the blocking
 * things go at the top.
 */

function QuestionsTab({
  deliverables,
  handlers,
}: {
  deliverables: Deliverable[];
  handlers: Handlers;
}) {
  const withQuestions = useMemo(
    () =>
      deliverables
        .filter((d) => d.questions.length > 0)
        .sort(
          (a, b) =>
            openCount(b.questions) - openCount(a.questions) || byOrder(a, b),
        ),
    [deliverables],
  );

  if (deliverables.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-12 text-center">
        <HelpCircle className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">
          No questions, because there is nothing to ask about yet
        </div>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
          Questions hang off a deliverable: they are the things you need someone
          to decide before that piece of work can move. Create a deliverable
          first, then add questions to it.
        </p>
      </div>
    );
  }

  if (withQuestions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-12 text-center">
        <HelpCircle className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">
          Nothing outstanding
        </div>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
          Open a deliverable and hit &ldquo;Add question&rdquo; to park anything
          you are waiting on. It shows up here until it is answered.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {withQuestions.map((deliverable) => (
        <div
          key={deliverable.id}
          className="space-y-2 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex items-center gap-2">
            {deliverable.itemNumber && (
              <span className="font-mono text-xs text-muted-foreground">
                {deliverable.itemNumber}
              </span>
            )}
            <span className="text-sm font-medium text-foreground">
              {deliverable.title}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {deliverableTabLabels[deliverable.tab]}
            </span>
          </div>

          <QuestionSection
            deliverableId={deliverable.id}
            questions={deliverable.questions}
            handlers={handlers}
          />
        </div>
      ))}
    </div>
  );
}
