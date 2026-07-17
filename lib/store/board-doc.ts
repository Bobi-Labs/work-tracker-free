/**
 * Document factories — and the defaults the database used to supply for free.
 *
 * Every one of these was a Postgres `DEFAULT` clause. With the database gone,
 * this file is the *only* thing standing between a half-filled form and a row
 * with `status: undefined` that then fails zod on the next reload — long after
 * the mistake, with no way to trace it back.
 *
 *   status      → 'pending'
 *   priority    → 'medium'
 *   sortOrder   → 0
 *   q.status    → 'open'
 *   createdAt / updatedAt → now
 *
 * `category` is the exception, and it is deliberate: it was **NOT NULL with no
 * default**, so there is no value this file could invent that wouldn't be a
 * guess. It is therefore **required** on `NewItemInput` — the compiler now
 * enforces what the `NOT NULL` constraint used to. The form supplies `'task'`.
 */

import { newId } from "../id";
import {
  DOC_KIND,
  INDEX_KIND,
  SCHEMA_VERSION,
  type BoardDoc,
  type BoardSettings,
  type Deliverable,
  type DeliverableStatus,
  type DeliverableTab,
  type Item,
  type ItemCategory,
  type ItemPriority,
  type ItemStatus,
  type Note,
  type Question,
  type QuestionStatus,
  type WorkspaceIndex,
} from "../types";

export function now(): string {
  return new Date().toISOString();
}

/* ─────────────────────────────── Inputs ───────────────────────────────
 * What a caller must provide vs. what the store fills in. Fields the store
 * OWNS (`id`, `createdAt`, `updatedAt`, `completedAt`, `answeredAt`, embedded
 * children) are absent from every input type — they are not the caller's to set.
 */

export interface NewItemInput {
  title: string;
  /** No DB default and NOT NULL. Always supply it; the form default is `'task'`. */
  category: ItemCategory;
  description?: string | null;
  priority?: ItemPriority;
  status?: ItemStatus;
  assignedTo?: string | null;
  dueDate?: string | null;
  sortOrder?: number;
}

/**
 * `completedAt` is absent on purpose — it is **derived**, never assigned. See
 * `store.ts`. Making it unsettable at the type level is how the invariant stops
 * being a convention someone eventually forgets.
 */
export type ItemPatch = Partial<
  Pick<
    Item,
    | "title"
    | "description"
    | "category"
    | "priority"
    | "status"
    | "assignedTo"
    | "dueDate"
    | "sortOrder"
  >
>;

export interface NewDeliverableInput {
  title: string;
  tab?: Exclude<DeliverableTab, "questions">;
  itemNumber?: string | null;
  subtitle?: string | null;
  scopeMd?: string | null;
  guideMd?: string | null;
  buildNotesMd?: string | null;
  status?: DeliverableStatus;
  sortOrder?: number;
}

export type DeliverablePatch = Partial<
  Pick<
    Deliverable,
    | "tab"
    | "itemNumber"
    | "title"
    | "subtitle"
    | "scopeMd"
    | "guideMd"
    | "buildNotesMd"
    | "status"
    | "sortOrder"
  >
>;

export interface NewQuestionInput {
  questionMd: string;
  answerMd?: string | null;
  category?: string | null;
  status?: QuestionStatus;
  sortOrder?: number;
}

/** `answeredAt` is derived from `answerMd` — same reasoning as `completedAt`. */
export type QuestionPatch = Partial<
  Pick<Question, "questionMd" | "answerMd" | "category" | "status" | "sortOrder">
>;

/* ─────────────────────────────── Factories ─────────────────────────────── */

export function createItem(input: NewItemInput, ts: string = now()): Item {
  return {
    id: newId(),
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    assignedTo: input.assignedTo ?? null,
    dueDate: input.dueDate ?? null,
    // An item created straight into `done` is completed the moment it exists.
    // Same rule as every other transition — see `deriveCompletedAt` in store.ts.
    completedAt: (input.status ?? "pending") === "done" ? ts : null,
    // Nothing is born archived. Only the store's archive methods set this.
    archivedAt: null,
    sortOrder: input.sortOrder ?? 0,
    createdAt: ts,
    updatedAt: ts,
    notes: [],
  };
}

export function createNote(content: string, ts: string = now()): Note {
  return { id: newId(), content, createdAt: ts };
}

export function createQuestion(
  input: NewQuestionInput,
  ts: string = now(),
): Question {
  const answerMd = input.answerMd ?? null;
  const answered = answerMd !== null && answerMd.trim() !== "";
  return {
    id: newId(),
    questionMd: input.questionMd,
    answerMd,
    answeredAt: answered ? ts : null,
    category: input.category ?? null,
    status: input.status ?? (answered ? "answered" : "open"),
    sortOrder: input.sortOrder ?? 0,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createDeliverable(
  input: NewDeliverableInput,
  ts: string = now(),
): Deliverable {
  return {
    id: newId(),
    tab: input.tab ?? "backlog",
    itemNumber: input.itemNumber ?? null,
    title: input.title,
    subtitle: input.subtitle ?? null,
    scopeMd: input.scopeMd ?? null,
    guideMd: input.guideMd ?? null,
    buildNotesMd: input.buildNotesMd ?? null,
    status: input.status ?? "pending",
    sortOrder: input.sortOrder ?? 0,
    createdAt: ts,
    updatedAt: ts,
    questions: [],
  };
}

export function createEmptySettings(): BoardSettings {
  return { clientName: null, phase: null, bannerUrl: null, accent: null };
}

export function createEmptyDoc(name = "My Board", ts: string = now()): BoardDoc {
  return {
    kind: DOC_KIND,
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: ts,
    updatedAt: ts,
    settings: createEmptySettings(),
    items: [],
    deliverables: [],
  };
}

export function createEmptyIndex(): WorkspaceIndex {
  return {
    kind: INDEX_KIND,
    schemaVersion: SCHEMA_VERSION,
    activeBoardId: null,
    boards: [],
  };
}

/* ─────────────────────────── The prerender document ───────────────────────────
 * `output: 'export'` STILL PRERENDERS at build time. `getServerSnapshot()` must
 * return a value that is (a) referentially stable — React re-invokes it and will
 * infinite-loop if the identity changes — and (b) reachable without touching
 * `window`, `localStorage`, `Date.now()` or `crypto`. So: one frozen singleton,
 * with a fixed epoch timestamp and an **empty id**.
 *
 * The empty id is the tell. `store.assertReady()` refuses to mutate a document
 * without one, so a mutation that somehow fires before hydration throws loudly
 * instead of quietly persisting a board that belongs to no one.
 */
const EPOCH = "1970-01-01T00:00:00.000Z";

export const EMPTY_BOARD_DOC: BoardDoc = Object.freeze({
  kind: DOC_KIND,
  schemaVersion: SCHEMA_VERSION,
  id: "",
  name: "",
  createdAt: EPOCH,
  updatedAt: EPOCH,
  settings: Object.freeze(createEmptySettings()),
  items: Object.freeze([]) as readonly Item[] as Item[],
  deliverables: Object.freeze([]) as readonly Deliverable[] as Deliverable[],
}) as BoardDoc;

/** A document that has never been hydrated or replaced. */
export function isEmptyDoc(doc: BoardDoc): boolean {
  return doc.id === "";
}
