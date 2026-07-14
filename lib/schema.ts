/**
 * Runtime validation + forward migration for persisted documents.
 *
 * Five Postgres ENUMs, a stack of NOT NULL constraints and a set of foreign
 * keys used to do this work for free. All of them are gone. Everything that
 * enters the app from outside the running process — localStorage (which the
 * user can edit, and which older versions of this app wrote), or an imported
 * `.json` file (which could be anything at all) — passes through here.
 *
 * Validation runs at EXACTLY two call sites: `hydrate()` and `importJson()`.
 * Resist adding a third: schemas in the hot path are how you end up validating
 * on every render.
 */

import { z } from "zod";

import {
  DOC_KIND,
  INDEX_KIND,
  SCHEMA_VERSION,
  type BoardDoc,
  type BoardRef,
  type BoardSettings,
  type Deliverable,
  type DeliverableStatus,
  type Item,
  type ItemCategory,
  type ItemPriority,
  type ItemStatus,
  type Note,
  type Question,
  type QuestionStatus,
  type WorkspaceIndex,
} from "./types";

/* ─────────────────────────────── Enums ─────────────────────────────── */

export const ItemCategorySchema = z.enum([
  "data_needed",
  "question",
  "decision",
  "task",
  "bug",
  "feature",
]);

export const ItemPrioritySchema = z.enum(["high", "medium", "low"]);

export const ItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "done",
  "blocked",
  "future_phase",
]);

/** Storable tabs only — `questions` is virtual and is never persisted on a row. */
export const StorableDeliverableTabSchema = z.enum([
  "backlog",
  "ongoing",
  "delivered",
]);

export const DeliverableStatusSchema = z.enum([
  "pending",
  "active",
  "blocked",
  "delivered",
  "live",
  "future",
]);

export const QuestionStatusSchema = z.enum([
  "open",
  "answered",
  "dismissed",
]);

/* ───────────────────────────── Primitives ───────────────────────────── */

const IdSchema = z.string().min(1);
/** Not `.datetime()` — an ISO string produced by any engine's `toISOString()` is fine, and we never do date math on the raw value. */
const TimestampSchema = z.string().min(1);
const SortOrderSchema = z.number().finite();

/* ─────────────────────────────── Rows ─────────────────────────────── */

export const NoteSchema = z.object({
  id: IdSchema,
  content: z.string(),
  createdAt: TimestampSchema,
});

export const ItemSchema = z.object({
  id: IdSchema,
  title: z.string(),
  description: z.string().nullable(),
  category: ItemCategorySchema,
  priority: ItemPrioritySchema,
  status: ItemStatusSchema,
  assignedTo: z.string().nullable(),
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  sortOrder: SortOrderSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  notes: z.array(NoteSchema),
});

export const QuestionSchema = z.object({
  id: IdSchema,
  questionMd: z.string(),
  answerMd: z.string().nullable(),
  answeredAt: z.string().nullable(),
  category: z.string().nullable(),
  status: QuestionStatusSchema,
  sortOrder: SortOrderSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const DeliverableSchema = z.object({
  id: IdSchema,
  tab: StorableDeliverableTabSchema,
  itemNumber: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  scopeMd: z.string().nullable(),
  guideMd: z.string().nullable(),
  buildNotesMd: z.string().nullable(),
  status: DeliverableStatusSchema,
  sortOrder: SortOrderSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  questions: z.array(QuestionSchema),
});

export const BoardSettingsSchema = z.object({
  clientName: z.string().nullable(),
  phase: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  accent: z.string().nullable(),
});

export const BoardDocSchema = z.object({
  kind: z.literal(DOC_KIND),
  schemaVersion: z.number().int().positive(),
  id: IdSchema,
  name: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  settings: BoardSettingsSchema,
  items: z.array(ItemSchema),
  deliverables: z.array(DeliverableSchema),
});

export const BoardRefSchema = z.object({
  id: IdSchema,
  name: z.string(),
  updatedAt: TimestampSchema,
});

export const WorkspaceIndexSchema = z.object({
  kind: z.literal(INDEX_KIND),
  schemaVersion: z.number().int().positive(),
  activeBoardId: IdSchema.nullable(),
  boards: z.array(BoardRefSchema),
});

/* ───────────────────── Compile-time drift guards ─────────────────────
 * types.ts is the contract the UI compiles against; this file is what the
 * bytes on disk are checked against. If the two ever disagree, the app becomes
 * confidently wrong at runtime with a clean typecheck — the worst failure mode
 * available. These lines make that a build error instead.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _driftGuards: [
  Exact<z.infer<typeof ItemCategorySchema>, ItemCategory>,
  Exact<z.infer<typeof ItemPrioritySchema>, ItemPriority>,
  Exact<z.infer<typeof ItemStatusSchema>, ItemStatus>,
  Exact<z.infer<typeof DeliverableStatusSchema>, DeliverableStatus>,
  Exact<z.infer<typeof QuestionStatusSchema>, QuestionStatus>,
  Exact<z.infer<typeof NoteSchema>, Note>,
  Exact<z.infer<typeof ItemSchema>, Item>,
  Exact<z.infer<typeof QuestionSchema>, Question>,
  Exact<z.infer<typeof DeliverableSchema>, Deliverable>,
  Exact<z.infer<typeof BoardSettingsSchema>, BoardSettings>,
  Exact<z.infer<typeof BoardDocSchema>, BoardDoc>,
  Exact<z.infer<typeof BoardRefSchema>, BoardRef>,
  Exact<z.infer<typeof WorkspaceIndexSchema>, WorkspaceIndex>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
void _driftGuards;

/* ─────────────────────────── Corruption ─────────────────────────── */

export type CorruptDocReason =
  /** Not an object at all — truncated write, or someone imported a PNG. */
  | "not-an-object"
  /** A valid JSON document, but not one of ours (or a workspace index fed to the board parser). */
  | "wrong-kind"
  /** Written by a NEWER build of the app, or by no build of the app. We refuse to guess. */
  | "unknown-version"
  /** Right kind, right version, wrong shape — a bad enum value, a missing field. */
  | "invalid-shape";

/**
 * Thrown by `migrate()` / `parseWorkspaceIndex()`. Carries a machine-readable
 * `reason` so the caller can say "this file isn't a board" instead of "Error"
 * — a corrupt-document dialog is the only place a user meets this class, and
 * it needs to be able to tell them which of the four things went wrong.
 */
export class CorruptDocError extends Error {
  readonly reason: CorruptDocReason;
  readonly issues: z.ZodIssue[];

  constructor(
    reason: CorruptDocReason,
    message: string,
    issues: z.ZodIssue[] = [],
  ) {
    super(message);
    this.name = "CorruptDocError";
    this.reason = reason;
    this.issues = issues;
    // Required for `instanceof` to survive TS's ES5-ish class downleveling.
    Object.setPrototypeOf(this, CorruptDocError.prototype);
  }
}

/* ─────────────────────────── Migration ─────────────────────────── */

/** Just enough of the document to route it. Parsed before the full schema. */
const EnvelopeSchema = z.object({
  kind: z.string(),
  schemaVersion: z.number().int().positive(),
});

/**
 * `MIGRATIONS[n]` upgrades a v`n` document to v`n+1`. Chained forward until the
 * document reaches SCHEMA_VERSION, so a v1 doc opened by a v4 build runs
 * 1→2→3→4 in order. Each step takes and returns `unknown`: intermediate shapes
 * are not the current shape and must never be typed as `BoardDoc`.
 *
 * Empty at v1 — there is nothing older than the first release. The first entry
 * gets added the day a field changes meaning, and never a day later.
 */
const MIGRATIONS: Record<number, (doc: unknown) => unknown> = {};

/**
 * Turns untrusted JSON into a `BoardDoc`, or throws `CorruptDocError`.
 *
 * @param raw a value already through `JSON.parse` — this function does not parse strings.
 */
export function migrate(raw: unknown): BoardDoc {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CorruptDocError(
      "not-an-object",
      "This file does not contain a board.",
    );
  }

  const envelope = EnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new CorruptDocError(
      "wrong-kind",
      "This file is missing the board header (`kind` / `schemaVersion`).",
      envelope.error.issues,
    );
  }

  if (envelope.data.kind !== DOC_KIND) {
    throw new CorruptDocError(
      "wrong-kind",
      `Expected a "${DOC_KIND}" document but found "${envelope.data.kind}".`,
    );
  }

  let version = envelope.data.schemaVersion;
  if (version > SCHEMA_VERSION) {
    throw new CorruptDocError(
      "unknown-version",
      `This board was saved by a newer version of the app (schema v${version}; this build understands up to v${SCHEMA_VERSION}). Update the app, then reopen it.`,
    );
  }

  let doc: unknown = raw;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      throw new CorruptDocError(
        "unknown-version",
        `No migration exists from schema v${version} to v${version + 1}.`,
      );
    }
    doc = step(doc);
    version += 1;
  }

  const parsed = BoardDocSchema.safeParse(doc);
  if (!parsed.success) {
    throw new CorruptDocError(
      "invalid-shape",
      `This board is damaged: ${formatIssues(parsed.error.issues)}`,
      parsed.error.issues,
    );
  }

  // A migrated doc must claim the version it was migrated TO.
  return { ...parsed.data, schemaVersion: SCHEMA_VERSION };
}

/**
 * The index's counterpart to `migrate()`. Same contract, same error class.
 * Kept separate because the index is disposable — a caller that catches here
 * can rebuild it by scanning `wt.board.*` keys, whereas a corrupt board is a
 * user's actual data and must never be silently discarded.
 */
export function parseWorkspaceIndex(raw: unknown): WorkspaceIndex {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CorruptDocError(
      "not-an-object",
      "The workspace index is not a document.",
    );
  }

  const parsed = WorkspaceIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const kind = (raw as { kind?: unknown }).kind;
    const reason: CorruptDocReason =
      typeof kind !== "string" || kind !== INDEX_KIND
        ? "wrong-kind"
        : "invalid-shape";
    throw new CorruptDocError(
      reason,
      `The workspace index is damaged: ${formatIssues(parsed.error.issues)}`,
      parsed.error.issues,
    );
  }

  return parsed.data;
}

function formatIssues(issues: z.ZodIssue[]): string {
  const shown = issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  const rest = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";
  return `${shown}${rest}`;
}
