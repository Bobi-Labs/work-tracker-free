/**
 * The data contract for the whole app.
 *
 * This file replaces what a database used to provide: the enums, the row
 * shapes, the defaults. There is no server, so this is the only place these
 * facts exist. Everything else in `lib/` and `components/` reads from here.
 *
 * Runtime validation of these shapes lives in `lib/schema.ts` and runs at
 * exactly two boundaries: `hydrate()` (reading persisted JSON) and
 * `importJson()` (reading a user-supplied file). Nowhere else.
 */

/* ─────────────────────────── Kanban item enums ───────────────────────────
 * Ported verbatim from the private app's tracker (`components/tracker/utils.ts`).
 * The three unions were Postgres ENUMs; the colour/label maps drove the UI.
 * Colours here are *semantic* (red = blocked, green = done, amber = decision) —
 * they are deliberately NOT the app accent, and must not be re-keyed when the
 * theme changes.
 */

export type ItemCategory =
  | "data_needed"
  | "question"
  | "decision"
  | "task"
  | "bug"
  | "feature";

export type ItemPriority = "high" | "medium" | "low";

export type ItemStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "blocked"
  | "future_phase";

export const priorityColors: Record<ItemPriority, string> = {
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  low: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

export const statusColors: Record<ItemStatus, string> = {
  pending: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  in_progress: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  done: "bg-green-500/20 text-green-400 border-green-500/30",
  blocked: "bg-red-500/20 text-red-400 border-red-500/30",
  future_phase: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
};

export const categoryColors: Record<ItemCategory, string> = {
  data_needed: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  question: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  decision: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  task: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  bug: "bg-red-500/20 text-red-400 border-red-500/30",
  feature: "bg-green-500/20 text-green-400 border-green-500/30",
};

export const statusLabels: Record<ItemStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  blocked: "Blocked",
  future_phase: "Future Phase",
};

export const categoryLabels: Record<ItemCategory, string> = {
  data_needed: "Data Needed",
  question: "Question",
  decision: "Decision",
  task: "Task",
  bug: "Bug",
  feature: "Feature",
};

export const priorityLabels: Record<ItemPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Column order for the Kanban board — NOT the declaration order of ItemStatus.
 * `blocked` sits before `done` on purpose: blocked work needs eyes, done work
 * does not. Preserve this ordering; it is a UX decision, not an accident.
 */
export const statusOrder: ItemStatus[] = [
  "pending",
  "in_progress",
  "blocked",
  "done",
  "future_phase",
];

/* ─────────────────────────── Deliverable enums ───────────────────────────
 * These were free-text Postgres columns. With the database gone there is no
 * CHECK constraint left to lean on, so they are promoted to real unions and
 * validated by zod.
 */

/**
 * The deliverables shell's four tabs. `questions` is a *virtual* tab — no
 * deliverable is ever stored with `tab: "questions"`; it aggregates open
 * questions across every deliverable. Kept in the union because the tab
 * selector is typed against it.
 */
export type DeliverableTab = "backlog" | "ongoing" | "delivered" | "questions";

/**
 * Note the absence of `bid-pending` — that is agency vocabulary (a proposal
 * awaiting a client's signature) and has no meaning in a personal tool.
 */
export type DeliverableStatus =
  | "pending"
  | "active"
  | "blocked"
  | "delivered"
  | "live"
  | "future";

export type QuestionStatus = "open" | "answered" | "dismissed";

export const deliverableTabLabels: Record<DeliverableTab, string> = {
  backlog: "Backlog",
  ongoing: "Ongoing Work",
  delivered: "Delivered",
  questions: "Questions",
};

export const deliverableStatusColors: Record<DeliverableStatus, string> = {
  pending: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  active: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  blocked: "bg-red-500/15 text-red-400 border-red-500/30",
  delivered: "bg-green-500/15 text-green-400 border-green-500/30",
  live: "bg-green-500/15 text-green-400 border-green-500/30",
  future: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
};

export const deliverableStatusLabels: Record<DeliverableStatus, string> = {
  pending: "Pending",
  active: "Active",
  blocked: "Blocked",
  delivered: "Delivered",
  live: "Live",
  future: "Future",
};

export const questionStatusLabels: Record<QuestionStatus, string> = {
  open: "Open",
  answered: "Answered",
  dismissed: "Dismissed",
};

/**
 * Tabs a deliverable can actually be filed under. Excludes the virtual
 * `questions` tab. Use this for tab pickers in create/edit forms.
 */
export const deliverableTabOrder: DeliverableTab[] = [
  "backlog",
  "ongoing",
  "delivered",
  "questions",
];

export const storableDeliverableTabs: Exclude<DeliverableTab, "questions">[] = [
  "backlog",
  "ongoing",
  "delivered",
];

/* ─────────────────────────── Document model ───────────────────────────
 * One board = one self-contained document = one localStorage key = one
 * exported .json = one file handle. Nothing references anything outside
 * itself; a BoardDoc is portable by construction.
 *
 * camelCase throughout — snake_case was PostgREST leaking into the UI.
 */

export const SCHEMA_VERSION = 1;
export const DOC_KIND = "worktracker.board" as const;
export const INDEX_KIND = "worktracker.index" as const;

/** localStorage keys. `wt.board.<uuid>` is built by `boardKey()`. */
export const INDEX_STORAGE_KEY = "wt.index";
export const boardStorageKey = (boardId: string): string =>
  `wt.board.${boardId}`;

/** An item comment. `author` is gone — there is one user and it is you. */
export interface Note {
  id: string;
  content: string;
  createdAt: string; // ISO 8601
}

export interface Item {
  id: string;
  title: string;
  description: string | null;
  /** No default in the old schema and NOT NULL — the store must always supply `"task"`. */
  category: ItemCategory;
  /** DB default was `medium`. */
  priority: ItemPriority;
  /** DB default was `pending`. */
  status: ItemStatus;
  assignedTo: string | null;
  /** ISO date, `YYYY-MM-DD`. */
  dueDate: string | null;
  /**
   * Derived client-side, never by a trigger: stamped on transition to `done`,
   * and **nulled on transition to any other status**. The store owns this
   * invariant; if it drifts, "completed this week" counts silently rot.
   */
  completedAt: string | null;
  /**
   * Set = the item lives in the archive, off the board. Owned by the store's
   * dedicated methods (`archiveDone` / `archiveItem` / `restoreItem`) and
   * deliberately absent from `ItemPatch`, same as `completedAt` — archiving is
   * a state an item is IN, not a field callers edit. `status` is untouched by
   * archiving, so a restored item lands back in the column it left.
   *
   * Schema note: validated with a `default(null)` so boards written before
   * this field existed still parse — no schema-version bump, no migration.
   */
  archivedAt: string | null;
  /** Dense-ish ordering within a status column. Reorder rewrites as idx * 10. */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
}

/** An open question hanging off a deliverable. */
export interface Question {
  id: string;
  questionMd: string;
  answerMd: string | null;
  /** Stamped when an answer is set; cleared when the answer is cleared. */
  answeredAt: string | null;
  /** Optional free-text bucket for grouping. */
  category: string | null;
  /** DB default was `open`. */
  status: QuestionStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A "show the work" card. Board-scoped — the original table had no board
 * scoping at all, and the panel silently dropped the argument on the floor.
 * That was a bug wearing a feature's coat; deliverables belong to a board.
 *
 * Everything invoice-shaped is gone (amount, number, status, sent/paid stamps,
 * line items) along with `discoveryPlanMd`.
 */
export interface Deliverable {
  id: string;
  /** Never `"questions"` — that tab is computed. */
  tab: Exclude<DeliverableTab, "questions">;
  /** Human-facing label like `"07"`. Display only; not an identifier. */
  itemNumber: string | null;
  title: string;
  subtitle: string | null;
  scopeMd: string | null;
  guideMd: string | null;
  buildNotesMd: string | null;
  /** DB default was `pending`. */
  status: DeliverableStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
}

/**
 * The survivable subset of the old `tracker_projects` row. Hours, budget,
 * scope, owner and demo flags did not survive the cut — the first two were
 * never rendered, the last three were multi-tenant machinery.
 */
export interface BoardSettings {
  clientName: string | null;
  phase: string | null;
  /**
   * A remote banner image. Optional, and **the wrong default for this app** —
   * an offline/Tauri build renders a remote URL as a broken image. Prefer
   * `accent`, which needs no network. Kept because a user with their own
   * hosted image (or a `data:` URI) may legitimately want one.
   */
  bannerUrl: string | null;
  /**
   * A CSS `background-image` value — in practice a gradient — painted where the
   * banner would go. Renders identically offline, in a `file://` build, and in
   * Tauri, which is why the sample board uses it instead of a CDN banner.
   *
   * Note for whoever wires this into a `style` prop: it is applied verbatim, so
   * an *imported* board could smuggle a `url(https://…)` in here and turn a
   * board open into a network beacon. If that matters, gate it on
   * `startsWith("linear-gradient(")` at the render site.
   */
  accent: string | null;
}

export interface BoardDoc {
  /** Reject any import whose kind is not exactly this. */
  kind: typeof DOC_KIND;
  /** `migrate()` chains v1 → v2 → … forward to SCHEMA_VERSION. */
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  /** Bumped by EVERY mutation. The workspace index sorts on it. */
  updatedAt: string;
  settings: BoardSettings;
  items: Item[];
  deliverables: Deliverable[];
}

/** A board's entry in the workspace index — enough to render the picker without loading every doc. */
export interface BoardRef {
  id: string;
  name: string;
  updatedAt: string;
}

/**
 * `wt.index` — the only key the app reads without knowing a board id.
 * Stays in localStorage even when a board is also mirrored to a real file,
 * which is what makes File System Access an additive sink rather than a mode.
 */
export interface WorkspaceIndex {
  kind: typeof INDEX_KIND;
  schemaVersion: number;
  activeBoardId: string | null;
  boards: BoardRef[];
}
