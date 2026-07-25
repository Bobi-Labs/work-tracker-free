/**
 * The workspace — `wt.index`, the one key the app can read without already
 * knowing a board id.
 *
 * **Boards are unlimited and free. There is no cap, and no code here may ever
 * introduce one.** Monetisation is bespoke contracts, not a counter.
 *
 * Storage layout:
 *
 *   wt.index          → WorkspaceIndex  (this file)
 *   wt.board.<uuid>   → BoardDoc        (a BoardStore + its adapter)
 *
 * The index is **derived and disposable**: everything in it also exists inside
 * the board documents themselves. So when it is missing or damaged we rebuild it
 * by scanning `wt.board.*` rather than showing the user an error about a file
 * they have never heard of. A damaged *board*, by contrast, is the user's actual
 * data — that surfaces loudly and is never discarded (see `BoardStore.hydrate`).
 */

import { CorruptDocError, migrate, parseWorkspaceIndex } from "../schema";
import {
  INDEX_KIND,
  INDEX_STORAGE_KEY,
  SCHEMA_VERSION,
  boardStorageKey,
  type BoardDoc,
  type BoardRef,
  type WorkspaceIndex,
} from "../types";
import { LocalStorageAdapter } from "./adapters/local-storage";
import { StoreError, type StorageAdapter } from "./adapters/types";
import { createEmptyDoc, createEmptyIndex, now } from "./board-doc";

const BOARD_KEY_PREFIX = "wt.board.";

/* ───────────────────────────── Key-value backend ─────────────────────────────
 * The workspace needs `keys()` (to rebuild by scanning) and synchronous access
 * (the picker renders from it), which is more than `StorageAdapter` promises.
 * So it sits on its own tiny interface — trivially fakeable in tests, and the
 * seam where a Tauri workspace file would slot in later.
 */

export interface WorkspaceKV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export function browserKV(): WorkspaceKV {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
    keys: () => {
      const out: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key !== null) out.push(key);
      }
      return out;
    },
  };
}

export function memoryKV(seed: Record<string, string> = {}): WorkspaceKV {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

/** Prerender snapshot — frozen, and reachable without `window`. */
export const EMPTY_WORKSPACE_INDEX: WorkspaceIndex = Object.freeze({
  kind: INDEX_KIND,
  schemaVersion: SCHEMA_VERSION,
  activeBoardId: null,
  boards: Object.freeze([]) as readonly BoardRef[] as BoardRef[],
}) as WorkspaceIndex;

/* ───────────────────────────────── Workspace ───────────────────────────────── */

export interface Workspace {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceIndex;
  getServerSnapshot(): WorkspaceIndex;

  /** Read (or rebuild) the index from storage. Call once, on mount. */
  hydrate(): WorkspaceIndex;

  /** Boards, most-recently-updated first. */
  list(): BoardRef[];
  activeBoardId(): string | null;
  setActiveBoard(id: string | null): void;

  /** Creates the board document AND its index entry, and makes it active. */
  createBoard(name?: string): BoardDoc;
  /** Registers an existing document (imported, or a sample board) under its own id. */
  addBoard(doc: BoardDoc): BoardRef;
  /** Mirror a board's `name` / `updatedAt` into the index after it changed. */
  syncFromDoc(doc: BoardDoc): void;
  /** Deletes the board document AND its index entry. Unrecoverable — confirm first. */
  deleteBoard(id: string): void;

  /** Read a board document straight from storage (the picker's "duplicate"/"export" paths). */
  readBoard(id: string): BoardDoc | null;
  /** The storage adapter a `BoardStore` should be given for this board. */
  adapterFor(id: string): StorageAdapter;
}

class WorkspaceImpl implements Workspace {
  private readonly kv: WorkspaceKV;
  private index: WorkspaceIndex = EMPTY_WORKSPACE_INDEX;
  private listeners = new Set<() => void>();

  constructor(kv: WorkspaceKV) {
    this.kv = kv;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WorkspaceIndex => this.index;

  getServerSnapshot = (): WorkspaceIndex => EMPTY_WORKSPACE_INDEX;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private commit(index: WorkspaceIndex): void {
    this.index = index;
    try {
      this.kv.setItem(INDEX_STORAGE_KEY, JSON.stringify(index));
    } catch (e) {
      // The index is rebuildable from the board documents, so a failure to
      // persist it is survivable — but it is still a real signal (quota), and
      // the boards themselves are about to hit the same wall.
      throw new StoreError("io", "Could not save the board list.", { cause: e });
    }
    this.notify();
  }

  hydrate = (): WorkspaceIndex => {
    const raw = this.kv.getItem(INDEX_STORAGE_KEY);

    if (raw !== null && raw.trim() !== "") {
      try {
        const index = parseWorkspaceIndex(JSON.parse(raw));
        this.index = reconcile(index, this.scanBoardIds());
        this.notify();
        return this.index;
      } catch (e) {
        if (!(e instanceof CorruptDocError) && !(e instanceof SyntaxError)) throw e;
        // Fall through to a rebuild. The index holds nothing the boards don't.
      }
    }

    this.index = this.rebuild();
    this.persistQuietly();
    this.notify();
    return this.index;
  };

  /** Reconstruct the index by scanning `wt.board.*`. */
  private rebuild(): WorkspaceIndex {
    const boards: BoardRef[] = [];

    for (const id of this.scanBoardIds()) {
      const doc = this.readBoard(id);
      // A board that fails to parse is left ON DISK and merely left out of the
      // list. It is the user's data; a rebuild is not a licence to delete it.
      if (doc) boards.push({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt });
    }

    boards.sort(byUpdatedAtDesc);
    return {
      ...createEmptyIndex(),
      activeBoardId: boards[0]?.id ?? null,
      boards,
    };
  }

  private scanBoardIds(): string[] {
    return this.kv
      .keys()
      .filter((key) => key.startsWith(BOARD_KEY_PREFIX))
      .map((key) => key.slice(BOARD_KEY_PREFIX.length))
      .filter((id) => id !== "");
  }

  private persistQuietly(): void {
    try {
      this.kv.setItem(INDEX_STORAGE_KEY, JSON.stringify(this.index));
    } catch {
      /* rebuildable; do not block startup on it */
    }
  }

  list = (): BoardRef[] => [...this.index.boards].sort(byUpdatedAtDesc);

  activeBoardId = (): string | null => this.index.activeBoardId;

  setActiveBoard = (id: string | null): void => {
    if (this.index.activeBoardId === id) return;
    this.commit({ ...this.index, activeBoardId: id });
  };

  createBoard = (name = "My Board"): BoardDoc => {
    const doc = createEmptyDoc(name);
    this.writeBoard(doc);
    this.commit({
      ...this.index,
      activeBoardId: doc.id,
      boards: [...this.index.boards, toRef(doc)],
    });
    return doc;
  };

  addBoard = (doc: BoardDoc): BoardRef => {
    this.writeBoard(doc);
    const ref = toRef(doc);
    const boards = this.index.boards.filter((b) => b.id !== doc.id);
    this.commit({
      ...this.index,
      activeBoardId: doc.id,
      boards: [...boards, ref],
    });
    return ref;
  };

  syncFromDoc = (doc: BoardDoc): void => {
    const existing = this.index.boards.find((b) => b.id === doc.id);
    if (
      existing &&
      existing.name === doc.name &&
      existing.updatedAt === doc.updatedAt
    ) {
      return;
    }

    const boards = existing
      ? this.index.boards.map((b) => (b.id === doc.id ? toRef(doc) : b))
      : [...this.index.boards, toRef(doc)];

    this.commit({ ...this.index, boards });
  };

  deleteBoard = (id: string): void => {
    this.kv.removeItem(boardStorageKey(id));

    const boards = this.index.boards.filter((b) => b.id !== id);
    const activeBoardId =
      this.index.activeBoardId === id
        ? ([...boards].sort(byUpdatedAtDesc)[0]?.id ?? null)
        : this.index.activeBoardId;

    this.commit({ ...this.index, activeBoardId, boards });
  };

  readBoard = (id: string): BoardDoc | null => {
    const raw = this.kv.getItem(boardStorageKey(id));
    if (raw === null || raw.trim() === "") return null;
    try {
      return migrate(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  adapterFor = (id: string): StorageAdapter =>
    new LocalStorageAdapter(boardStorageKey(id));

  private writeBoard(doc: BoardDoc): void {
    try {
      this.kv.setItem(boardStorageKey(doc.id), JSON.stringify(doc, null, 2));
    } catch (e) {
      throw new StoreError("quota", "Could not create the board: storage is full.", {
        cause: e,
      });
    }
  }
}

/**
 * The index is a cache of the boards on disk, and caches go stale — a board
 * deleted from another tab, or a `wt.board.*` key written by an import in a
 * previous session. Drop entries whose document is gone; adopt documents the
 * index has never heard of.
 */
function reconcile(index: WorkspaceIndex, idsOnDisk: string[]): WorkspaceIndex {
  const present = new Set(idsOnDisk);
  const known = new Set(index.boards.map((b) => b.id));

  const boards = index.boards.filter((b) => present.has(b.id));
  const orphans = idsOnDisk.filter((id) => !known.has(id));

  // Orphans get a placeholder ref rather than a full parse of every document —
  // the picker calls `readBoard()` when it needs more. `updatedAt` of epoch sorts
  // them last, which is honest: we do not know when they were touched.
  for (const id of orphans) {
    boards.push({ id, name: "Untitled board", updatedAt: "1970-01-01T00:00:00.000Z" });
  }

  const activeBoardId =
    index.activeBoardId && present.has(index.activeBoardId)
      ? index.activeBoardId
      : ([...boards].sort(byUpdatedAtDesc)[0]?.id ?? null);

  return { ...index, schemaVersion: SCHEMA_VERSION, activeBoardId, boards };
}

function toRef(doc: BoardDoc): BoardRef {
  return { id: doc.id, name: doc.name, updatedAt: doc.updatedAt || now() };
}

function byUpdatedAtDesc(a: BoardRef, b: BoardRef): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

export function createWorkspace(kv: WorkspaceKV = browserKV()): Workspace {
  return new WorkspaceImpl(kv);
}
