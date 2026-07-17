/**
 * The board store.
 *
 * One in-memory `BoardDoc`, synchronous mutations, and a 400 ms debounced
 * whole-document write through a `StorageAdapter`. This replaces an entire
 * networked data layer — server cache, request registries, timeout wrappers,
 * staleness workarounds. There is no network, so there is no loading state to
 * model, no cache to invalidate, and no optimistic update to roll back — the
 * write already happened, in memory, before the function returned.
 *
 * Three rules the rest of this file exists to enforce:
 *
 * 1. **Mutations cannot fail.** They mutate memory. They return the entity they
 *    created, or nothing — never a `Result`. *Saving* can fail; that surfaces in
 *    `getStatus().error` and is **never swallowed**.
 * 2. **Every effective mutation bumps two timestamps** — the entity's
 *    `updatedAt` and the document's. The workspace picker sorts on the latter,
 *    so a board that changed and didn't say so sorts as if it hadn't.
 * 3. **`completedAt` is derived, never assigned.** There is no database trigger
 *    any more. See `deriveCompletedAt` below — it is the single point of truth
 *    and the type system keeps `completedAt` out of every patch type so no other
 *    code path can touch it.
 */

import { CorruptDocError, migrate } from "../schema";
import {
  DOC_KIND,
  type BoardDoc,
  type BoardSettings,
  type Deliverable,
  type DeliverableTab,
  type Item,
  type ItemStatus,
  type Note,
  type Question,
} from "../types";
import { StoreError, type StorageAdapter } from "./adapters/types";
import {
  EMPTY_BOARD_DOC,
  createDeliverable,
  createItem,
  createNote,
  createQuestion,
  isEmptyDoc,
  now,
  type DeliverablePatch,
  type ItemPatch,
  type NewDeliverableInput,
  type NewItemInput,
  type NewQuestionInput,
  type QuestionPatch,
} from "./board-doc";

export const SAVE_DEBOUNCE_MS = 400;

/* ─────────────────────────────── Status ─────────────────────────────── */

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface StoreStatus {
  state: SaveState;
  /** In-memory changes not yet written. `true` between a mutation and its save. */
  pending: boolean;
  lastSavedAt: string | null;
  /**
   * The last save or load failure. Quota exhaustion is real (localStorage caps
   * around 5 MB and deliverables are markdown), so this must be rendered.
   */
  error: StoreError | CorruptDocError | null;
  /** `null` until an adapter is attached (i.e. during prerender). */
  adapterId: string | null;
  /**
   * Autosave is halted because the persisted bytes did not parse. We will not
   * overwrite a document we failed to understand — that is how you eat someone's
   * data. Call `resumeSaving()` once the user has explicitly chosen to discard it.
   */
  suspended: boolean;
}

/* ─────────────────────────────── Hydration ─────────────────────────────── */

export type HydrateResult =
  | { status: "loaded"; doc: BoardDoc }
  /** Nothing has ever been persisted here — a genuinely new board, not a failure. */
  | { status: "empty" }
  /** The bytes exist but are not a board we understand. `raw` is preserved so the UI can offer a download-before-discard. */
  | { status: "corrupt"; error: CorruptDocError; raw: string }
  /** The adapter itself failed (storage disabled, permission revoked). */
  | { status: "error"; error: StoreError };

/* ─────────────────────────── Public surface ─────────────────────────── */

export interface BoardStore {
  /* reads */
  subscribe(listener: () => void): () => void;
  getSnapshot(): BoardDoc;
  /** Prerender/SSR snapshot. Frozen, empty, and never touches `window`. */
  getServerSnapshot(): BoardDoc;
  getStatus(): StoreStatus;

  /* lifecycle */
  attachAdapter(adapter: StorageAdapter | null, options?: AttachOptions): void;
  hydrate(): Promise<HydrateResult>;
  replaceDoc(doc: BoardDoc): void;
  flush(): Promise<void>;
  resumeSaving(): void;
  destroy(): void;

  /* items */
  addItem(input: NewItemInput): Item;
  updateItem(id: string, patch: ItemPatch): void;
  deleteItem(id: string): void;
  /** Rewrites `sortOrder` as `index * 10` across the destination column, and moves any item that wasn't already in it. */
  reorderItems(status: ItemStatus, orderedIds: string[]): void;
  bulkUpdateStatus(ids: string[], status: ItemStatus): void;
  /** Permanently deletes every Done item. The archive methods below are the non-destructive alternative the UI prefers. */
  clearDone(): void;

  /* archive — `archivedAt` is store-owned, like `completedAt`. Archiving never
   * touches `status`, so a restored item lands back in the column it left. */
  archiveDone(): void;
  archiveItem(id: string): void;
  restoreItem(id: string): void;
  /** Permanently deletes every archived item. The only bulk delete the UI exposes. */
  deleteArchived(): void;

  /* notes (embedded in items) */
  addNote(itemId: string, content: string): Note;
  updateNote(itemId: string, noteId: string, content: string): void;
  deleteNote(itemId: string, noteId: string): void;

  /* deliverables */
  addDeliverable(input: NewDeliverableInput): Deliverable;
  updateDeliverable(id: string, patch: DeliverablePatch): void;
  deleteDeliverable(id: string): void;
  reorderDeliverables(
    tab: Exclude<DeliverableTab, "questions">,
    orderedIds: string[],
  ): void;

  /* questions (embedded in deliverables) */
  addQuestion(deliverableId: string, input: NewQuestionInput): Question;
  updateQuestion(
    deliverableId: string,
    questionId: string,
    patch: QuestionPatch,
  ): void;
  deleteQuestion(deliverableId: string, questionId: string): void;
  reorderQuestions(deliverableId: string, orderedIds: string[]): void;

  /* board */
  renameBoard(name: string): void;
  updateSettings(patch: Partial<BoardSettings>): void;

  /* portability */
  exportJson(): string;
  /** Throws `CorruptDocError` and writes **nothing** on failure. */
  importJson(json: string): BoardDoc;
}

export interface AttachOptions {
  /**
   * Write the CURRENT in-memory document into the new adapter, even if nothing has
   * changed since the last save.
   *
   * Default `false`, which is right for the ordinary case — swapping boards, where
   * `hydrate()` is about to *read* from the adapter and seeding it would write a
   * board over itself. It is wrong for exactly one case, and that case is the whole
   * point of the file adapter: the user attaches an **empty, just-created file** to
   * a board they already have. Without a seed, that file stays empty until the next
   * keystroke — and "Saving to board.json" would be a lie about a 0-byte file.
   *
   * Seeding a store that is `suspended` (a corrupt load) still writes nothing:
   * `write()` refuses. Nor does it write the prerender document.
   */
  seed?: boolean;
}

export interface BoardStoreOptions {
  adapter?: StorageAdapter | null;
  /** Starting document. Defaults to the frozen empty doc, so the first client render matches the prerender. */
  doc?: BoardDoc;
  debounceMs?: number;
}

/* ─────────────────────────────── Helpers ─────────────────────────────── */

/**
 * THE `completedAt` RULE. There is no DB trigger; `dashboard.tsx:191-193` did
 * this client-side and the store now owns it:
 *
 *   → `done`      : stamp
 *   → anything else: null
 *
 * One deliberate refinement over the original: we stamp only on the **transition**
 * into `done`, preserving an existing stamp when an already-done item is written
 * again with `status: 'done'`. The original re-stamped unconditionally, which
 * means dragging a card *within* the Done column silently reset its completion
 * date — and "completed this week" quietly counts it twice.
 */
function deriveCompletedAt(
  prev: Item,
  nextStatus: ItemStatus,
  ts: string,
): string | null {
  if (nextStatus !== "done") return null;
  if (prev.status === "done" && prev.completedAt) return prev.completedAt;
  return ts;
}

/** Copies only the keys the caller actually set — `{ description: undefined }` must not blank a field. */
function applyPatch<T extends object>(target: T, patch: Partial<T>): T {
  const next = { ...target };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) next[key] = value as T[keyof T];
  }
  return next;
}

/** The bytes we persist and the bytes we export are the same bytes. */
function serialize(doc: BoardDoc): string {
  return JSON.stringify(doc, null, 2);
}

function parseDoc(json: string): BoardDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new CorruptDocError(
      "not-an-object",
      "This file isn't valid JSON.",
      [],
    );
  }
  return migrate(raw);
}

function toStoreError(e: unknown, fallback: string): StoreError {
  if (e instanceof StoreError) return e;
  return new StoreError("io", fallback, { cause: e });
}

/* ─────────────────────────────── Store ─────────────────────────────── */

class BoardStoreImpl implements BoardStore {
  private doc: BoardDoc;
  private adapter: StorageAdapter | null;
  private readonly debounceMs: number;

  private listeners = new Set<() => void>();
  private status: StoreStatus;

  private dirty = false;
  private suspended = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes writes. A save never overlaps a save. */
  private queue: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(options: BoardStoreOptions = {}) {
    this.doc = options.doc ?? EMPTY_BOARD_DOC;
    this.adapter = options.adapter ?? null;
    this.debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
    this.status = Object.freeze({
      state: "idle",
      pending: false,
      lastSavedAt: null,
      error: null,
      adapterId: this.adapter?.id ?? null,
      suspended: false,
    });
    this.bindLifecycle();
  }

  /* ── subscription ── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): BoardDoc => this.doc;

  getServerSnapshot = (): BoardDoc => EMPTY_BOARD_DOC;

  getStatus = (): StoreStatus => this.status;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private setStatus(patch: Partial<StoreStatus>): void {
    const next: StoreStatus = {
      ...this.status,
      ...patch,
      pending: patch.pending ?? this.dirty,
      adapterId: this.adapter?.id ?? null,
      suspended: patch.suspended ?? this.suspended,
    };
    this.status = Object.freeze(next);
    this.notify();
  }

  /* ── persistence ── */

  private scheduleSave(): void {
    if (!this.adapter || this.suspended || this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueueWrite();
    }, this.debounceMs);
  }

  private enqueueWrite(): Promise<void> {
    this.queue = this.queue.then(
      () => this.write(),
      () => this.write(),
    );
    return this.queue;
  }

  private async write(): Promise<void> {
    const adapter = this.adapter;
    if (!adapter || !this.dirty || this.suspended) return;

    // NEVER persist the prerender document. `commit()` already refuses to mutate
    // it, but `resumeSaving()` marks the store dirty without installing one — so
    // lifting a corrupt-load suspension before a board is loaded would otherwise
    // write `{ id: "" }` straight over the damaged-but-recoverable bytes. The
    // user would lose the original AND get the same load error next session,
    // since `id: ""` fails validation too. Stay dirty: the moment a real document
    // arrives, it saves.
    if (isEmptyDoc(this.doc)) return;

    const json = serialize(this.doc);
    this.dirty = false;
    this.setStatus({ state: "saving", pending: true });

    try {
      await adapter.save(json);
      this.setStatus({
        state: this.dirty ? "idle" : "saved",
        lastSavedAt: now(),
        error: null,
      });
    } catch (e) {
      // The change is still only in memory. Keep it dirty so the next flush
      // retries it, and put the failure where the UI must render it.
      this.dirty = true;
      this.setStatus({
        state: "error",
        error: toStoreError(e, "Could not save this board."),
      });
    }
  }

  /** Write now. Resolves even on failure — the error lives in `getStatus().error`. */
  flush = (): Promise<void> => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.enqueueWrite();
  };

  /* ── lifecycle ── */

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") void this.flush();
  };

  private onBeforeUnload = (): void => {
    // Nothing async is guaranteed to run here. This works only because
    // LocalStorageAdapter.save() calls setItem() synchronously before it awaits
    // anything — see the note in adapters/local-storage.ts.
    void this.flush();
  };

  private bindLifecycle(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("beforeunload", this.onBeforeUnload);
  }

  destroy = (): void => {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      window.removeEventListener("beforeunload", this.onBeforeUnload);
    }
    this.listeners.clear();
  };

  attachAdapter = (
    adapter: StorageAdapter | null,
    options: AttachOptions = {},
  ): void => {
    this.adapter = adapter;
    // `seed: true` — the caller attached a NEW, empty sink (a file the user just
    // created) and wants the board that is already open written into it. Marking
    // the document dirty is the whole mechanism: it reuses the ordinary save path,
    // including its debounce, its serialization, and its refusal to persist the
    // prerender document or a suspended one. Must precede `setStatus`, which
    // derives `pending` from `dirty`.
    if (adapter && options.seed && !isEmptyDoc(this.doc)) this.dirty = true;

    this.setStatus({ state: this.status.state });
    // A document mutated before an adapter existed (first-run "Start empty")
    // still needs to reach disk the moment one does.
    if (adapter && this.dirty) this.scheduleSave();
  };

  hydrate = async (): Promise<HydrateResult> => {
    const adapter = this.adapter;
    if (!adapter) return { status: "empty" };

    let raw: string | null;
    try {
      raw = await adapter.load();
    } catch (e) {
      const error = toStoreError(e, "Could not read this board.");
      this.setStatus({ state: "error", error });
      return { status: "error", error };
    }

    if (raw === null || raw.trim() === "") return { status: "empty" };

    const storedVersion = readStoredVersion(raw);

    let doc: BoardDoc;
    try {
      doc = parseDoc(raw);
    } catch (e) {
      const error =
        e instanceof CorruptDocError
          ? e
          : new CorruptDocError("invalid-shape", "This board is damaged.");
      // Refuse to autosave over bytes we could not read.
      this.suspended = true;
      this.setStatus({ state: "error", error, suspended: true });
      return { status: "corrupt", error, raw };
    }

    this.doc = doc;
    this.dirty = false;
    this.suspended = false;
    // A document that was migrated forward has to be written back, or it gets
    // migrated again on every single load.
    const migrated = storedVersion !== null && storedVersion < doc.schemaVersion;
    if (migrated) {
      this.dirty = true;
      this.scheduleSave();
    }
    this.setStatus({ state: migrated ? "idle" : "saved", error: null, suspended: false });
    return { status: "loaded", doc };
  };

  /**
   * Install a document wholesale — switching boards, "Start empty", "Load sample
   * board", or accepting an import. This is an explicit user act, so it also
   * clears a corrupt-load suspension: the next save overwrites the damaged bytes
   * *because the user asked it to*.
   */
  replaceDoc = (doc: BoardDoc): void => {
    this.doc = doc;
    this.dirty = true;
    this.suspended = false;
    this.scheduleSave();
    this.setStatus({ state: "idle", error: null, suspended: false });
  };

  /** Discard a corrupt-load suspension and let autosave overwrite the damaged document. */
  resumeSaving = (): void => {
    this.suspended = false;
    this.dirty = true;
    this.scheduleSave();
    this.setStatus({ state: "idle", error: null, suspended: false });
  };

  /* ── the commit primitive ── */

  private assertReady(): void {
    if (isEmptyDoc(this.doc)) {
      // Fail loud. Silently persisting a board with no id would corrupt the
      // workspace index in a way that only shows up a session later.
      throw new Error(
        "BoardStore: mutation attempted before a board was loaded. Call hydrate() or replaceDoc() first.",
      );
    }
  }

  /**
   * The only way the document ever changes. Returning `null` from `fn` means
   * "nothing actually changed" — and a no-op must NOT bump `updatedAt`, or the
   * workspace picker reorders itself every time someone opens a board.
   */
  private commit(
    fn: (doc: BoardDoc, ts: string) => BoardDoc | null,
    ts: string = now(),
  ): void {
    this.assertReady();
    const next = fn(this.doc, ts);
    if (!next) return;
    this.doc = { ...next, updatedAt: ts };
    this.dirty = true;
    this.scheduleSave();
    this.setStatus({ state: "idle", pending: true });
  }

  /* ── items ── */

  addItem = (input: NewItemInput): Item => {
    const ts = now();
    const item = createItem(input, ts);
    this.commit((doc) => ({ ...doc, items: [...doc.items, item] }), ts);
    return item;
  };

  updateItem = (id: string, patch: ItemPatch): void => {
    this.commit((doc, ts) => {
      const index = doc.items.findIndex((i) => i.id === id);
      if (index < 0) return null;

      const prev = doc.items[index]!;
      const next: Item = { ...applyPatch<Item>(prev, patch), updatedAt: ts };

      // Re-derived on EVERY write, from the item's resulting status — not only
      // when `status` is in the patch. `deriveCompletedAt` preserves an existing
      // stamp for an already-done item, so renaming a done card does not disturb
      // its completion date; but a card that is NOT done can never keep a stale
      // stamp, which is what "nulled for any other status" actually means. A
      // hand-edited import that violates the invariant heals on first touch.
      next.completedAt = deriveCompletedAt(prev, next.status, ts);

      const items = [...doc.items];
      items[index] = next;
      return { ...doc, items };
    });
  };

  deleteItem = (id: string): void => {
    this.commit((doc) => {
      const items = doc.items.filter((i) => i.id !== id);
      return items.length === doc.items.length ? null : { ...doc, items };
    });
  };

  reorderItems = (status: ItemStatus, orderedIds: string[]): void => {
    this.commit((doc, ts) => {
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      let changed = false;

      const items = doc.items.map((item) => {
        const index = position.get(item.id);
        if (index === undefined) return item;

        const sortOrder = index * 10;
        const movedIn = item.status !== status;
        if (!movedIn && item.sortOrder === sortOrder) return item;

        changed = true;
        if (!movedIn) return { ...item, sortOrder, updatedAt: ts };
        return {
          ...item,
          status,
          sortOrder,
          completedAt: deriveCompletedAt(item, status, ts),
          updatedAt: ts,
        };
      });

      return changed ? { ...doc, items } : null;
    });
  };

  bulkUpdateStatus = (ids: string[], status: ItemStatus): void => {
    this.commit((doc, ts) => {
      const target = new Set(ids);
      let changed = false;

      const items = doc.items.map((item) => {
        if (!target.has(item.id) || item.status === status) return item;
        changed = true;
        return {
          ...item,
          status,
          completedAt: deriveCompletedAt(item, status, ts),
          updatedAt: ts,
        };
      });

      return changed ? { ...doc, items } : null;
    });
  };

  clearDone = (): void => {
    this.commit((doc) => {
      const items = doc.items.filter((i) => i.status !== "done");
      return items.length === doc.items.length ? null : { ...doc, items };
    });
  };

  /* ── archive ── */

  archiveDone = (): void => {
    this.commit((doc, ts) => {
      let changed = false;
      const items = doc.items.map((item) => {
        if (item.status !== "done" || item.archivedAt) return item;
        changed = true;
        return { ...item, archivedAt: ts, updatedAt: ts };
      });
      return changed ? { ...doc, items } : null;
    });
  };

  archiveItem = (id: string): void => {
    this.commit((doc, ts) => {
      const index = doc.items.findIndex((i) => i.id === id);
      if (index < 0 || doc.items[index]!.archivedAt) return null;
      const items = [...doc.items];
      items[index] = { ...items[index]!, archivedAt: ts, updatedAt: ts };
      return { ...doc, items };
    });
  };

  restoreItem = (id: string): void => {
    this.commit((doc, ts) => {
      const index = doc.items.findIndex((i) => i.id === id);
      if (index < 0 || !doc.items[index]!.archivedAt) return null;
      const items = [...doc.items];
      items[index] = { ...items[index]!, archivedAt: null, updatedAt: ts };
      return { ...doc, items };
    });
  };

  deleteArchived = (): void => {
    this.commit((doc) => {
      const items = doc.items.filter((i) => !i.archivedAt);
      return items.length === doc.items.length ? null : { ...doc, items };
    });
  };

  /* ── notes ── */

  addNote = (itemId: string, content: string): Note => {
    const item = this.doc.items.find((i) => i.id === itemId);
    if (!item) throw new Error(`BoardStore.addNote: no item "${itemId}".`);

    const ts = now();
    const note = createNote(content, ts);
    this.commit(
      (doc) => ({
        ...doc,
        items: doc.items.map((i) =>
          i.id === itemId ? { ...i, notes: [...i.notes, note], updatedAt: ts } : i,
        ),
      }),
      ts,
    );
    return note;
  };

  updateNote = (itemId: string, noteId: string, content: string): void => {
    this.commit((doc, ts) => {
      let changed = false;
      const items = doc.items.map((item) => {
        if (item.id !== itemId) return item;
        const notes = item.notes.map((note) => {
          if (note.id !== noteId || note.content === content) return note;
          changed = true;
          return { ...note, content };
        });
        return changed ? { ...item, notes, updatedAt: ts } : item;
      });
      return changed ? { ...doc, items } : null;
    });
  };

  deleteNote = (itemId: string, noteId: string): void => {
    this.commit((doc, ts) => {
      let changed = false;
      const items = doc.items.map((item) => {
        if (item.id !== itemId) return item;
        const notes = item.notes.filter((n) => n.id !== noteId);
        if (notes.length === item.notes.length) return item;
        changed = true;
        return { ...item, notes, updatedAt: ts };
      });
      return changed ? { ...doc, items } : null;
    });
  };

  /* ── deliverables ── */

  addDeliverable = (input: NewDeliverableInput): Deliverable => {
    const ts = now();
    const deliverable = createDeliverable(input, ts);
    this.commit(
      (doc) => ({ ...doc, deliverables: [...doc.deliverables, deliverable] }),
      ts,
    );
    return deliverable;
  };

  updateDeliverable = (id: string, patch: DeliverablePatch): void => {
    this.commit((doc, ts) => {
      const index = doc.deliverables.findIndex((d) => d.id === id);
      if (index < 0) return null;

      const prev = doc.deliverables[index]!;
      const next: Deliverable = {
        ...applyPatch<Deliverable>(prev, patch),
        updatedAt: ts,
      };

      const deliverables = [...doc.deliverables];
      deliverables[index] = next;
      return { ...doc, deliverables };
    });
  };

  deleteDeliverable = (id: string): void => {
    this.commit((doc) => {
      const deliverables = doc.deliverables.filter((d) => d.id !== id);
      return deliverables.length === doc.deliverables.length
        ? null
        : { ...doc, deliverables };
    });
  };

  reorderDeliverables = (
    tab: Exclude<DeliverableTab, "questions">,
    orderedIds: string[],
  ): void => {
    this.commit((doc, ts) => {
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      let changed = false;

      const deliverables = doc.deliverables.map((deliverable) => {
        const index = position.get(deliverable.id);
        if (index === undefined) return deliverable;

        const sortOrder = index * 10;
        const movedIn = deliverable.tab !== tab;
        if (!movedIn && deliverable.sortOrder === sortOrder) return deliverable;

        changed = true;
        return { ...deliverable, tab, sortOrder, updatedAt: ts };
      });

      return changed ? { ...doc, deliverables } : null;
    });
  };

  /* ── questions ── */

  addQuestion = (deliverableId: string, input: NewQuestionInput): Question => {
    const deliverable = this.doc.deliverables.find((d) => d.id === deliverableId);
    if (!deliverable) {
      throw new Error(`BoardStore.addQuestion: no deliverable "${deliverableId}".`);
    }

    const ts = now();
    const question = createQuestion(input, ts);
    this.commit(
      (doc) => ({
        ...doc,
        deliverables: doc.deliverables.map((d) =>
          d.id === deliverableId
            ? { ...d, questions: [...d.questions, question], updatedAt: ts }
            : d,
        ),
      }),
      ts,
    );
    return question;
  };

  /**
   * The answer/status coupling the Questions tab depends on:
   *   answer set     → status `answered` + `answeredAt` stamped (first time only)
   *   answer cleared → status reverts to `open`, stamp cleared
   * An explicit `status` in the patch always wins — that is how "dismiss" works
   * on a question that already has an answer.
   */
  updateQuestion = (
    deliverableId: string,
    questionId: string,
    patch: QuestionPatch,
  ): void => {
    this.commit((doc, ts) => {
      let changed = false;

      const deliverables = doc.deliverables.map((deliverable) => {
        if (deliverable.id !== deliverableId) return deliverable;

        const index = deliverable.questions.findIndex((q) => q.id === questionId);
        if (index < 0) return deliverable;

        const prev = deliverable.questions[index]!;
        const next: Question = {
          ...applyPatch<Question>(prev, patch),
          updatedAt: ts,
        };

        if (patch.answerMd !== undefined) {
          const answered =
            patch.answerMd !== null && patch.answerMd.trim() !== "";
          next.answeredAt = answered ? (prev.answeredAt ?? ts) : null;
          if (patch.status === undefined) {
            next.status = answered ? "answered" : "open";
          }
        }

        const questions = [...deliverable.questions];
        questions[index] = next;
        changed = true;
        return { ...deliverable, questions, updatedAt: ts };
      });

      return changed ? { ...doc, deliverables } : null;
    });
  };

  deleteQuestion = (deliverableId: string, questionId: string): void => {
    this.commit((doc, ts) => {
      let changed = false;

      const deliverables = doc.deliverables.map((deliverable) => {
        if (deliverable.id !== deliverableId) return deliverable;
        const questions = deliverable.questions.filter((q) => q.id !== questionId);
        if (questions.length === deliverable.questions.length) return deliverable;
        changed = true;
        return { ...deliverable, questions, updatedAt: ts };
      });

      return changed ? { ...doc, deliverables } : null;
    });
  };

  reorderQuestions = (deliverableId: string, orderedIds: string[]): void => {
    this.commit((doc, ts) => {
      const position = new Map(orderedIds.map((id, index) => [id, index]));
      let changed = false;

      const deliverables = doc.deliverables.map((deliverable) => {
        if (deliverable.id !== deliverableId) return deliverable;

        let touched = false;
        const questions = deliverable.questions.map((question) => {
          const index = position.get(question.id);
          if (index === undefined) return question;
          const sortOrder = index * 10;
          if (question.sortOrder === sortOrder) return question;
          touched = true;
          return { ...question, sortOrder, updatedAt: ts };
        });

        if (!touched) return deliverable;
        changed = true;
        return { ...deliverable, questions, updatedAt: ts };
      });

      return changed ? { ...doc, deliverables } : null;
    });
  };

  /* ── board ── */

  renameBoard = (name: string): void => {
    this.commit((doc) => (doc.name === name ? null : { ...doc, name }));
  };

  updateSettings = (patch: Partial<BoardSettings>): void => {
    this.commit((doc) => ({
      ...doc,
      settings: applyPatch(doc.settings, patch),
    }));
  };

  /* ── portability ── */

  exportJson = (): string => serialize(this.doc);

  /**
   * Parse → kind check → version check → migrate → validate. Every one of those
   * throws `CorruptDocError`, and `replaceDoc()` is only reached past all of
   * them, so a failed import leaves the current board **completely untouched**.
   *
   * The imported document keeps the *current* board's `id`. The store is bound to
   * a storage key derived from that id; adopting a foreign id would write board A
   * into board B's slot and orphan it in the workspace index. (Importing as a
   * *new* board is `workspace.importBoard()`, which creates the slot first.)
   */
  importJson = (json: string): BoardDoc => {
    const parsed = parseDoc(json);
    const doc: BoardDoc = {
      ...parsed,
      kind: DOC_KIND,
      id: isEmptyDoc(this.doc) ? parsed.id : this.doc.id,
      updatedAt: now(),
    };
    this.replaceDoc(doc);
    return doc;
  };
}

/** Reads `schemaVersion` off untrusted bytes without validating them — used only to tell "was this migrated?". */
function readStoredVersion(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
      if (typeof v === "number") return v;
    }
  } catch {
    /* handled properly by parseDoc */
  }
  return null;
}

export function createBoardStore(options: BoardStoreOptions = {}): BoardStore {
  return new BoardStoreImpl(options);
}

export { CorruptDocError, StoreError };
