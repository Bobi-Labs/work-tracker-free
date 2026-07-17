"use client";

/**
 * The board orchestrator — filters, selection, and every mutation the board can
 * perform, wired straight into the `BoardStore`.
 *
 * Ported from the private app's `dashboard.tsx` (533 lines). What died, and why:
 *
 *  - **Two `useQuery` reads** → `useBoard(store)`. The store IS the data, and it
 *    is synchronous. There is no fetch, so there is no loading state to model
 *    here at all — `page.tsx` owns the one real load (hydration) and does not
 *    mount this component until it has finished.
 *  - **All six inline `supabase` mutations, and every scrap of the optimistic
 *    machinery around them** — `onMutate`, `cancelQueries`, `setQueryData`, the
 *    `previous` snapshot, the `onError` rollback, `invalidate()`. An optimistic
 *    update is a *lie you tell the UI while the network catches up*. The network
 *    is gone. `store.updateItem()` has already changed the document by the time
 *    it returns; there is nothing to be optimistic about and nothing to roll
 *    back. This is the single biggest deletion in the port and it must not creep
 *    back in.
 *  - **The `fetch(apiPath('/api/tracker/notify'))`** fired on item-done. No API
 *    routes, no Telegram, no network. Deleted outright rather than left dangling.
 *  - **`DemoBanner`, `TrackerChatPanel`, `TrackerFilesPanel`, the `files` view,
 *    `IS_DEMO_MODE`, `createClient()`, `useTrackerAuth()`.**
 *  - **`canEdit` / `canAdd`.** Both were `!!user`. With auth gone they would
 *    evaluate to `undefined` and the board would render beautifully and be
 *    SILENTLY READ-ONLY — no drag, no quick-done, no move arrows, no Clear Done,
 *    no Add button, and no error anywhere. The props are deleted at both ends.
 *    **This app is always editable. There is no permission model. Do not add one.**
 *  - **The `keydown` effect.** It called `preventDefault()` on `/` and then did
 *    nothing — a half-built "focus the search box" shortcut that, as shipped,
 *    only ate the keystroke.
 *
 * What was kept verbatim, because it is pure logic and rewriting it only
 * introduces bugs: the filter engine and its date math, the assignees memo, the
 * selection state, and the stable `useCallback` handlers feeding the memo'd
 * children.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CorruptDocError } from "@/lib/schema";
import {
  StoreError,
  createFileSystemAdapter,
  createMirroredAdapter,
  ensurePermission,
  isFileSystemAccessSupported,
  loadBoardFileHandle,
  forgetBoardFileHandle,
  openBoardFile,
  pickFileForBoard,
  queryFilePermission,
  saveBoardFileHandle,
  type BoardStore,
  type StoreStatus,
  type Workspace,
} from "@/lib/store";
import type { ItemPatch, NewItemInput } from "@/lib/store/board-doc";
import {
  useBoard,
  useBoardStatus,
  useBoardStore,
  useWorkspace,
} from "@/lib/store/use-board";
import type { Item, ItemStatus } from "@/lib/types";

import { ArchiveSheet } from "./archive-sheet";
import { DeliverablesPanel } from "./deliverables-panel";
import { FilterBar, type BoardFilters } from "./filter-bar";
import { HeaderBar, type ViewMode } from "./header-bar";
import { ItemDetail } from "./item-detail";
import { KanbanView } from "./kanban-view";
import { ListView } from "./list-view";
import { NewItemForm } from "./new-item-form";
import {
  SettingsSheet,
  type BoardFileControls,
  type BoardFileState,
} from "./settings-sheet";
import { StatsCard } from "./stats-card";

const NO_FILTERS: BoardFilters = {
  search: "",
  categories: [],
  priorities: [],
  statuses: [],
  assignedTo: null,
  dueDate: null,
};

export function BoardApp() {
  const store = useBoardStore();
  const workspace = useWorkspace();
  const doc = useBoard(store);
  const status = useBoardStatus(store);

  const items = doc.items;

  /**
   * THE ARCHIVE SPLIT. Everything the board renders — columns, list, stats,
   * filters, assignee pills, sort-order math — consumes `activeItems`. Archived
   * items exist only in the archive sheet. Miss one consumer and archived cards
   * haunt it: a "Done 12" stat over a column showing 2, an assignee pill for
   * someone who only exists on archived cards.
   */
  const activeItems = useMemo(
    () => items.filter((i) => !i.archivedAt),
    [items],
  );
  const archivedItems = useMemo(
    () => items.filter((i) => i.archivedAt),
    [items],
  );

  /**
   * Mirror the live document into the workspace index.
   *
   * The index caches each board's `name` and `updatedAt` so the picker can render
   * without loading every document — and it sorts on `updatedAt`. Every mutation
   * bumps `doc.updatedAt`, so without this the picker's ordering goes stale the
   * moment you touch a card and never recovers (a rebuild only ever adds or drops
   * entries; it does not refresh the ones it already has).
   *
   * This lives HERE, and not in `page.tsx`, for a load-bearing reason: the Shell
   * subscribes to the workspace index only, so it does not re-render when an item
   * changes — an effect keyed on `doc.updatedAt` up there would simply never fire.
   * `BoardApp` is subscribed to the document, so it is the only component that sees
   * every mutation.
   *
   * `syncFromDoc` no-ops when nothing actually changed, so this is cheap. The
   * try/catch is not decoration: it writes to localStorage and can throw on quota,
   * and an uncaught throw in an effect tears down the whole tree. Losing the board
   * over a stale sort key would be an absurd trade — the board's own save path
   * reports its own failure, loudly, in the header.
   */
  useEffect(() => {
    if (!doc.id) return;
    try {
      workspace.syncFromDoc(doc);
    } catch {
      /* survivable: the index is rebuildable from the documents themselves */
    }
  }, [workspace, doc]);

  const [view, setView] = useState<ViewMode>("kanban");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);

  /**
   * Selection is held as an **id**, never as a captured `Item`.
   *
   * The private dashboard kept `useState<TrackerItem | null>(selectedItem)` and
   * then paid for it with a hand-written re-sync inside its optimistic-update
   * block (dashboard.tsx:224-226) to stop the open detail sheet from showing a
   * stale copy of the row it was editing. Holding the id and looking the item up
   * out of the live document deletes that whole class of bug: the sheet's notes
   * come from `item.notes`, so a snapshot captured at click time would never show
   * a comment the user just posted — no error, nothing in the console.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  /**
   * Assignees — everyone an existing item is actually assigned to.
   *
   * The original seeded this set from `DEV_TEAM_MEMBERS`, which was parsed out of
   * a `process.env` var. There are no env vars in this build (and no team), so the
   * seed is gone and the list is derived purely from the board. An empty list is
   * the normal solo case and is handled downstream: the filter bar omits the User
   * pills entirely, and the new-item form falls back to a free-text input.
   */
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const item of activeItems) {
      if (item.assignedTo) set.add(item.assignedTo);
    }
    return Array.from(set).sort();
  }, [activeItems]);

  /* ─────────────────────────── The filter engine ───────────────────────────
   * Kept verbatim from dashboard.tsx:117-176 — same branches, same comparisons,
   * same `today` / `weekEnd` construction. Only the field names changed
   * (snake_case → camelCase), and the `?? "medium"` / `?? "pending"` coalescing
   * is gone because `Item.priority` and `Item.status` are non-nullable now; the
   * compiler enforces what those fallbacks were papering over.
   *
   * ⚠️ ONE DELIBERATE FIX, and it is not a rewrite — it is one token.
   *
   * The original parsed the due date as `new Date(item.due_date)`. `dueDate` is a
   * DATE-only string (`"2026-07-14"`), and `new Date("2026-07-14")` parses as UTC
   * midnight, while `today` below is built from local Y/M/D — i.e. LOCAL midnight.
   * Anywhere west of Greenwich those are different days, so an item due *today*
   * compares as `due < today` and is silently reported as OVERDUE.
   *
   * `item-card.tsx` already parses this field as `dueDate + "T00:00:00"` (local
   * midnight) for exactly this reason, with a comment saying so. Leaving the two
   * disagreeing would mean a card whose own badge reads "today" gets matched by
   * the "Overdue" filter pill — which renders perfectly and is wrong by one day
   * for most of the Americas. Same parse convention in both places, or neither.
   */
  const filteredItems = useMemo(() => {
    return activeItems.filter((item) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (
          !item.title.toLowerCase().includes(q) &&
          !(item.description ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      if (
        filters.categories.length > 0 &&
        !filters.categories.includes(item.category)
      )
        return false;
      if (
        filters.priorities.length > 0 &&
        !filters.priorities.includes(item.priority)
      )
        return false;
      if (filters.statuses.length > 0 && !filters.statuses.includes(item.status))
        return false;
      if (filters.assignedTo && item.assignedTo !== filters.assignedTo)
        return false;
      if (filters.dueDate) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekEnd = new Date(today);
        weekEnd.setDate(today.getDate() + 7);
        // See the note above: "T00:00:00" forces local-midnight parsing, matching
        // `today` and matching what item-card renders on the card itself.
        const due = item.dueDate ? new Date(item.dueDate + "T00:00:00") : null;
        switch (filters.dueDate) {
          case "overdue":
            if (!due || due >= today) return false;
            break;
          case "today":
            if (!due || due.toDateString() !== today.toDateString()) return false;
            break;
          case "thisWeek":
            if (!due || due < today || due > weekEnd) return false;
            break;
          case "noDate":
            if (due) return false;
            break;
        }
      }
      return true;
    });
  }, [activeItems, filters]);

  /* ────────────────────────────── Mutations ──────────────────────────────
   * Every one of these is a direct, synchronous store call. `store` is created
   * once in `page.tsx` and its methods are bound class properties, so it is a
   * stable dependency and these handlers stay referentially stable for the
   * memo'd children.
   */

  const handleItemClick = useCallback((item: Item) => setSelectedId(item.id), []);

  const handleUpdate = useCallback(
    (id: string, patch: ItemPatch) => store.updateItem(id, patch),
    [store],
  );

  const handleDelete = useCallback(
    (id: string) => {
      store.deleteItem(id);
      setSelectedId((curr) => (curr === id ? null : curr));
    },
    [store],
  );

  const handleCreateItem = useCallback(
    (input: NewItemInput) => {
      // New cards land at the BOTTOM of their column. `addItem` defaults
      // `sortOrder` to 0, which would tie every new card with the column's first
      // card and wedge it into second place — a small, permanent wrongness that
      // the private app inherited from the DB's `DEFAULT 0`. The orchestrator is
      // the only thing that knows the rest of the column, so it does the sum.
      const status = input.status ?? "pending";
      // Sort against the VISIBLE column — an archived card's sortOrder must not
      // push new cards below where the eye says the column ends.
      const maxSort = activeItems.reduce(
        (max, i) => (i.status === status ? Math.max(max, i.sortOrder) : max),
        -10,
      );
      store.addItem({ ...input, sortOrder: maxSort + 10 });
      setShowAddForm(false);
    },
    [store, activeItems],
  );

  const handleStatusChange = useCallback(
    (itemId: string, newStatus: ItemStatus) =>
      store.updateItem(itemId, { status: newStatus }),
    [store],
  );

  /**
   * The store owns BOTH halves of a drop — it rewrites `sortOrder` across the
   * destination column AND moves any card that wasn't already in that status,
   * re-deriving `completedAt`. So a cross-column drag fires this and nothing
   * else; also calling `onStatusChange` would be a redundant second commit of a
   * move that already happened.
   */
  const handleReorder = useCallback(
    (status: ItemStatus, orderedIds: string[]) =>
      store.reorderItems(status, orderedIds),
    [store],
  );

  const handleBulkAction = useCallback(
    (action: "done" | "in_progress" | "pending") => {
      store.bulkUpdateStatus(Array.from(selectedIds), action);
      setSelectedIds(new Set());
    },
    [store, selectedIds],
  );

  /**
   * No confirm, unlike the delete it replaced: archiving is reversible (the
   * archive sheet restores any card with one click), and confirming a
   * reversible action teaches people to click through confirms.
   */
  const handleArchiveDone = useCallback(() => {
    store.archiveDone();
  }, [store]);

  const handleRestoreItem = useCallback(
    (id: string) => store.restoreItem(id),
    [store],
  );

  const handleDeleteArchived = useCallback(
    () => store.deleteArchived(),
    [store],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    () => setSelectedIds(new Set(filteredItems.map((i) => i.id))),
    [filteredItems],
  );

  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /* notes — embedded in items, so these are item mutations */

  const handleAddNote = useCallback(
    (itemId: string, content: string) => {
      store.addNote(itemId, content);
    },
    [store],
  );

  const handleUpdateNote = useCallback(
    (itemId: string, noteId: string, content: string) =>
      store.updateNote(itemId, noteId, content),
    [store],
  );

  const handleDeleteNote = useCallback(
    (itemId: string, noteId: string) => store.deleteNote(itemId, noteId),
    [store],
  );

  const handleToggleAddForm = useCallback(() => setShowAddForm((s) => !s), []);
  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleOpenArchive = useCallback(() => setArchiveOpen(true), []);

  /* Where this board saves — see `useBoardFile` below. */
  const file = useBoardFile(store, workspace, doc.id, status);

  const isBoardView = view === "kanban" || view === "list";

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-6">
      <HeaderBar
        boardName={doc.name}
        settings={doc.settings}
        view={view}
        onViewChange={setView}
        status={status}
        sinkLabel={file.sinkLabel}
        reconnectFile={file.reconnectFile}
        onOpenSettings={handleOpenSettings}
        onOpenArchive={handleOpenArchive}
        archivedCount={archivedItems.length}
      />

      <div className="mt-4">
        <StatsCard items={activeItems} />
      </div>

      {isBoardView && (
        <div className="mt-4">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            assignees={assignees}
            onToggleAddForm={handleToggleAddForm}
          />
        </div>
      )}

      {isBoardView && showAddForm && (
        <div className="mt-3">
          <NewItemForm
            open={showAddForm}
            onClose={() => setShowAddForm(false)}
            onSubmit={handleCreateItem}
            assignees={assignees}
          />
        </div>
      )}

      <div className="mt-3">
        {view === "deliverables" ? (
          // Reads and writes the store itself (`useBoardStore()`), so it takes no
          // props — deliverables are not filtered by the board's filter bar, and
          // threading a dozen CRUD handlers through here would buy nothing.
          <DeliverablesPanel />
        ) : view === "kanban" ? (
          <KanbanView
            items={filteredItems}
            onItemClick={handleItemClick}
            onStatusChange={handleStatusChange}
            onReorder={handleReorder}
            onArchiveDone={handleArchiveDone}
          />
        ) : (
          <ListView
            items={filteredItems}
            onItemClick={handleItemClick}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onBulkAction={handleBulkAction}
            onStatusChange={handleStatusChange}
          />
        )}
      </div>

      <ItemDetail
        item={selectedItem}
        open={!!selectedItem}
        onClose={() => setSelectedId(null)}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
        onAddNote={handleAddNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        file={file.controls}
      />

      <ArchiveSheet
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        items={archivedItems}
        onRestore={handleRestoreItem}
        onDelete={handleDelete}
        onDeleteAll={handleDeleteArchived}
      />
    </div>
  );
}

/* ═══════════════════════ Where this board saves ═══════════════════════
 *
 * localStorage is the BASE LAYER, always. A file is an *additional* sink layered
 * on top with `createMirroredAdapter(local, fsa)` — never a replacement. So a user
 * who revokes permission, moves the file, or opens the app in Firefox still has
 * their board. That is the whole reason the mirrored adapter exists.
 *
 * ⚠️ THE PERMISSION RULE, which shapes every branch below. A `FileSystemFileHandle`
 * survives a reload (IndexedDB keeps it — `file-handles.ts`); its **permission does
 * not**. On the next load `queryPermission()` says `'prompt'`, and only a **user
 * gesture** can re-grant it. `ensurePermission()` therefore appears exactly once,
 * inside `reconnect()`, which is called from a click. It can never be hoisted into
 * the mount effect, however convenient that would be — the request is rejected
 * outside a gesture, and the board would sit there silently not syncing.
 *
 * ⚠️ AND THE ID RULE. We do **not** attach the file and call `store.hydrate()`,
 * which is the obvious move. `hydrate()` installs the parsed document *verbatim* —
 * including its `id` — while the storage key underneath is derived from the
 * CURRENT board's id. A file holding a different board would be written into this
 * board's slot under a foreign id and orphaned in the workspace index (the store
 * says as much in `importJson`'s doc comment, which is why that method re-seats the
 * id). So every path that takes content *from* a file goes through `store.importJson()`:
 *
 *   - it validates BEFORE it writes, so a damaged file cannot become this board's
 *     sink, cannot replace the board, and — unlike a failed `hydrate()` — cannot
 *     suspend autosave and leave a perfectly healthy board unable to save;
 *   - it keeps this board's id, so the browser slot and the index stay coherent.
 *
 * ⚠️ AND THE DIRECTION RULE. Which copy wins is decided per entry point, never
 * guessed:
 *
 *   "Save to a file…"   → the BOARD wins. Seed it into the file. The user picked a
 *                         destination; reading that file back and importing it
 *                         would silently replace the very board they were saving
 *                         (the OS picker has already asked them about overwriting).
 *   "Open a board file…"→ the FILE wins — that is what "open" means — but it is
 *                         destructive, so a non-empty board gets the same confirm
 *                         an Import does.
 *   "Reconnect"         → whichever is NEWER. This is the subtle one: after a
 *                         reload the board saves to the browser alone, so twenty
 *                         minutes of work can accumulate that the file has never
 *                         seen. Blindly adopting the file here would eat all of it.
 *                         We compare `updatedAt`, write our newer board out to the
 *                         file, and only ever *ask* when the file is genuinely
 *                         ahead (edited elsewhere).
 */

interface PendingOpen {
  handle: FileSystemFileHandle;
  text: string;
}

interface BoardFile {
  controls: BoardFileControls;
  /** For the header: "Saved · browser storage" / "Saved · board.wtboard.json". */
  sinkLabel: string;
  /** For the header pill: a remembered file we are NOT currently writing to. */
  reconnectFile: string | null;
}

function useBoardFile(
  store: BoardStore,
  workspace: Workspace,
  boardId: string,
  status: StoreStatus,
): BoardFile {
  const [state, setState] = useState<BoardFileState>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOpen | null>(null);

  /** The handle for THIS board, once we know it. Held in a ref: `reconnect()` needs
   *  it inside a click, and re-rendering to hand it over would waste the gesture. */
  const handleRef = useRef<FileSystemFileHandle | null>(null);

  /* ── attach ── */

  const attachTo = useCallback(
    (handle: FileSystemFileHandle, seed: boolean) => {
      // `workspace.adapterFor(id)` stays the base. The file is a second sink, not a
      // relocation: `save()` writes localStorage first (synchronously, so it even
      // survives `beforeunload`) and the file second.
      store.attachAdapter(
        createMirroredAdapter(
          workspace.adapterFor(store.getSnapshot().id),
          createFileSystemAdapter(handle),
        ),
        { seed },
      );
      handleRef.current = handle;
      setState({ kind: "attached", name: handle.name });
    },
    [store, workspace],
  );

  /** Take the file's contents as this board. Throws `CorruptDocError` — and when it
   *  does, nothing has been written and nothing has been attached. */
  const adopt = useCallback(
    (handle: FileSystemFileHandle, text: string) => {
      if (text !== store.exportJson()) {
        store.importJson(text);
        // The picker caches names; an adopted board almost certainly renamed this one.
        workspace.syncFromDoc(store.getSnapshot());
      }
      attachTo(handle, false);
    },
    [store, workspace, attachTo],
  );

  /** Record which file this board uses, so it survives a reload. */
  const remember = useCallback(
    async (handle: FileSystemFileHandle): Promise<boolean> => {
      try {
        await saveBoardFileHandle(store.getSnapshot().id, handle);
        return true;
      } catch (e) {
        // The file IS attached and IS being written to — we simply could not record
        // *which* file. Do not undo the attach over it; say what the user will
        // actually experience (the link is gone after a reload) and move on.
        setError(
          `${messageFor(e, "This browser would not remember which file this board uses.")} The board is saving to “${handle.name}” now, but you will have to pick it again after a reload.`,
        );
        return false;
      }
    },
    [store],
  );

  /* ── mount: is a file remembered for this board? ──
   * Silent by construction. `loadBoardFileHandle` and `queryFilePermission` never
   * prompt, so this is safe in an effect — and it is the ONLY thing that may run
   * here. `BoardApp` mounts once per loaded board (the Shell swaps in a skeleton
   * while a board loads), so this re-runs on every board switch, which is exactly
   * when the answer changes.
   */
  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      setState({ kind: "unsupported" });
      return;
    }

    let cancelled = false;
    handleRef.current = null;
    setState({ kind: "none" });
    setError(null);
    setNotice(null);
    setPending(null);

    void (async () => {
      const handle = await loadBoardFileHandle(boardId);
      if (cancelled || !handle) return;

      const permission = await queryFilePermission(handle);
      if (cancelled) return;

      handleRef.current = handle;

      if (permission === "granted") {
        // Same session, board switched away and back. The file and the browser
        // mirror were written together by every save, so they agree — attach, read
        // nothing, write nothing.
        attachTo(handle, false);
        return;
      }

      setState({
        kind: permission === "denied" ? "denied" : "needs-reconnect",
        name: handle.name,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [boardId, attachTo]);

  /* ── actions ── */

  const saveToFile = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setPending(null);
      try {
        // Synchronous up to here, so the picker still sees the click's gesture.
        const handle = await pickFileForBoard(store.getSnapshot().name);
        if (!handle) return; // cancelled
        attachTo(handle, true); // the board wins — see THE DIRECTION RULE
        const ok = await remember(handle);
        if (ok) {
          setNotice(`This board now saves to ${handle.name}, and to this browser.`);
        }
      } catch (e) {
        setError(messageFor(e, "That file could not be used."));
      } finally {
        setBusy(false);
      }
    })();
  }, [store, attachTo, remember]);

  const openFile = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const handle = await openBoardFile();
        if (!handle) return; // cancelled

        // Read it BEFORE attaching anything. A file we cannot even open must not
        // become this board's sink.
        const text = await createFileSystemAdapter(handle).load();

        if (text === null) {
          // An empty file. There is nothing to open, so this is a "save to" —
          // saying "board replaced" over a 0-byte file would be a lie.
          attachTo(handle, true);
          const ok = await remember(handle);
          if (ok) {
            setNotice(`${handle.name} was empty, so this board was saved into it.`);
          }
          return;
        }

        const doc = store.getSnapshot();
        const boardIsEmpty =
          doc.items.length === 0 && doc.deliverables.length === 0;

        if (boardIsEmpty || text === store.exportJson()) {
          adopt(handle, text); // nothing to destroy
          const ok = await remember(handle);
          if (ok) setNotice(`This board now saves to ${handle.name}.`);
          return;
        }

        // Destructive. Same rule as Import: stage it, and let the user say yes.
        setPending({ handle, text });
      } catch (e) {
        setError(messageFor(e, "That file could not be opened."));
      } finally {
        setBusy(false);
      }
    })();
  }, [store, attachTo, adopt, remember]);

  const confirmOpen = useCallback(() => {
    const staged = pending;
    if (!staged) return;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        adopt(staged.handle, staged.text);
        setPending(null);
        const ok = await remember(staged.handle);
        if (ok) {
          setNotice(
            `Opened ${staged.handle.name}. This board now saves to it, and to this browser.`,
          );
        }
      } catch (e) {
        // `importJson` threw: the file is not a board we can read. It was never
        // attached, and the board on screen was never touched.
        setPending(null);
        setError(
          `${messageFor(e, "That file is not a board.")} Nothing was changed — your board is exactly as it was.`,
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [pending, adopt, remember]);

  const cancelOpen = useCallback(() => {
    setPending(null);
    setNotice(null);
  }, []);

  /**
   * The one place `requestPermission()` may be called — from a click, and only a
   * click. Everything else in this hook is deliberately prompt-free.
   */
  const reconnect = useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;

    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const permission = await ensurePermission(handle);

        if (permission !== "granted") {
          setState({
            kind: permission === "denied" ? "denied" : "needs-reconnect",
            name: handle.name,
          });
          setError(
            permission === "denied"
              ? `Permission to use “${handle.name}” was denied. This board is still saving in this browser — nothing was lost.`
              : `“${handle.name}” was not reconnected. This board is still saving in this browser — nothing was lost.`,
          );
          return;
        }

        const text = await createFileSystemAdapter(handle).load();

        if (text === null || !fileIsNewer(text, store.getSnapshot().updatedAt)) {
          // Our board is the newer one (the usual case: everything typed since the
          // reload exists only in the browser copy). Write it out. Adopting the file
          // here would delete that work — silently, and with no way back.
          attachTo(handle, true);
          setNotice(`Reconnected ${handle.name}. Saving to it again.`);
          return;
        }

        // The file moved on without us — edited by hand, or by another machine
        // through a synced folder. It genuinely wins, but not without being asked.
        setPending({ handle, text });
      } catch (e) {
        setError(messageFor(e, `“${handle.name}” could not be reconnected.`));
      } finally {
        setBusy(false);
      }
    })();
  }, [store, attachTo]);

  const detach = useCallback(() => {
    const handle = handleRef.current;
    void (async () => {
      setBusy(true);
      setError(null);
      setNotice(null);
      setPending(null);
      try {
        await forgetBoardFileHandle(store.getSnapshot().id);
      } catch (e) {
        setError(messageFor(e, "The file could not be detached."));
        return;
      } finally {
        setBusy(false);
      }
      // Back to the base layer alone. The file itself is left ON DISK, untouched —
      // it is the user's file, and "stop syncing" is not consent to delete it.
      store.attachAdapter(workspace.adapterFor(store.getSnapshot().id));
      handleRef.current = null;
      setState({ kind: "none" });
      setNotice(
        handle
          ? `This board now saves in this browser only. ${handle.name} is still on your disk, untouched.`
          : "This board now saves in this browser only.",
      );
    })();
  }, [store, workspace]);

  /* ── what the UI is allowed to claim ──
   * `adapterId` comes from the STORE, not from this hook's state. If an attach is
   * mid-flight, or an effect raced, the header still reports the sink the next save
   * will actually use.
   */
  const fileSink = (status.adapterId ?? "").includes("fsa");
  const permissionLost =
    status.error instanceof StoreError &&
    status.error.kind === "unavailable" &&
    fileSink;

  const needsReconnect =
    state.kind === "needs-reconnect" ||
    (state.kind === "attached" && permissionLost);

  const controls: BoardFileControls = {
    state,
    busy,
    error,
    notice,
    pendingOpen: pending ? { name: pending.handle.name } : null,
    needsReconnect,
    saveToFile,
    openFile,
    confirmOpen,
    cancelOpen,
    reconnect,
    detach,
  };

  return {
    controls,
    sinkLabel:
      fileSink && state.kind === "attached" ? state.name : "browser storage",
    // A failing file already shows as a red NOT SAVING; a second amber pill beside
    // it would just be noise. The pill is for the quiet case — saving fine, to the
    // browser, while the user believes their file is keeping up.
    reconnectFile: state.kind === "needs-reconnect" ? state.name : null,
  };
}

function messageFor(e: unknown, fallback: string): string {
  if (e instanceof StoreError || e instanceof CorruptDocError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/**
 * Is the board in this file newer than the one we are holding?
 *
 * Untrusted bytes: read `updatedAt` off them without validating the rest (that is
 * `importJson`'s job, and it happens only if the answer here is yes). Anything
 * unreadable answers **no** — "I cannot tell" must never mean "overwrite the
 * user's live board".
 */
function fileIsNewer(text: string, ours: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const theirs = (raw as { updatedAt?: unknown }).updatedAt;
    if (typeof theirs !== "string") return false;
    const a = Date.parse(theirs);
    const b = Date.parse(ours);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return a > b;
  } catch {
    return false;
  }
}
