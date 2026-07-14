/**
 * Remembering which file a board is attached to, across reloads.
 *
 * ⚠️ **A `FileSystemFileHandle` cannot go in localStorage.** It is not JSON —
 * `JSON.stringify(handle)` yields `{}`, and you find that out a session later,
 * when the file silently stopped syncing. It *is* structured-cloneable, and
 * IndexedDB is the only browser store that keeps structured clones. So: a tiny
 * promise-wrapped IDB store, keyed by board id, and no dependency to carry.
 *
 * What survives a reload is the **handle**, not the **permission** — the browser
 * resets that to `'prompt'`, and only a user gesture can re-grant it. So the flow
 * on mount is:
 *
 *   1. `loadBoardFileHandle(boardId)`   — cheap, silent, no prompt, safe in an effect
 *   2. `queryFilePermission(handle)`    — `'prompt'` after every reload
 *   3. render **"Reconnect <file>"** and call `ensurePermission()` *in the click*
 *
 * Never step 3 automatically. See `adapters/file-system.ts`.
 *
 * Everything here degrades: Firefox/Safari have no File System Access API and will
 * never write a handle, private modes can refuse IndexedDB outright. Reads return
 * `null`, and the app runs on localStorage as it always did.
 */

import { StoreError } from "./adapters/types";

const DB_NAME = "worktracker.files";
const DB_VERSION = 1;
const STORE_NAME = "handles";

interface HandleRecord {
  boardId: string;
  handle: FileSystemFileHandle;
  attachedAt: string;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/** `IDBRequest` → promise. The one piece of ceremony IndexedDB actually demands. */
function fromRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "boardId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab is holding an old version open. Rather than hang forever on a
    // transaction that will never start, give up — the file is simply not
    // remembered this session, and the board still saves to localStorage.
    request.onblocked = () =>
      reject(new StoreError("unavailable", "Another tab is blocking file storage."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const result = await fromRequest(fn(tx.objectStore(STORE_NAME)));
    // Wait for the transaction, not just the request: on a write, the request
    // succeeds before the transaction commits, and a quota failure surfaces here.
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return result;
  } finally {
    db.close();
  }
}

/* ───────────────────────────────── API ───────────────────────────────── */

/**
 * Remember the file this board is attached to.
 *
 * Throws `StoreError` — losing the handle is not data loss (the board is safe in
 * localStorage and the file is written for the rest of this session), but it does
 * mean the attachment silently evaporates on reload, and the user is entitled to
 * be told that now rather than to discover it later.
 */
export async function saveBoardFileHandle(
  boardId: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  if (!idbAvailable()) {
    throw new StoreError(
      "unavailable",
      "This browser will not let the app remember which file your board is saved to.",
    );
  }

  const record: HandleRecord = {
    boardId,
    handle,
    attachedAt: new Date().toISOString(),
  };

  try {
    await withStore("readwrite", (store) => store.put(record));
  } catch (e) {
    if (e instanceof StoreError) throw e;
    throw new StoreError(
      "io",
      "Could not remember which file this board is saved to — it will need reconnecting after a reload.",
      { cause: e },
    );
  }
}

/**
 * The handle for this board, or `null` if there isn't one (or IndexedDB is
 * unusable, or the handle was written by a browser that no longer exists here).
 *
 * **Silent and prompt-free — safe to call on mount.** The returned handle's
 * permission is almost certainly `'prompt'`; that is the caller's next question,
 * not this function's.
 */
export async function loadBoardFileHandle(
  boardId: string,
): Promise<FileSystemFileHandle | null> {
  if (!idbAvailable()) return null;

  try {
    const record = await withStore<HandleRecord | undefined>("readonly", (store) =>
      store.get(boardId),
    );
    const handle = record?.handle;
    // Guard the shape: a record written by an older build, or a clone that did not
    // survive, must not blow up the boot path.
    if (!handle || typeof handle !== "object" || !("getFile" in handle)) return null;
    return handle;
  } catch {
    // A board that cannot remember its file still opens, on localStorage. Silence
    // is right here and nowhere else in this file.
    return null;
  }
}

/** Detach: the board keeps saving to localStorage; the file itself is untouched. */
export async function forgetBoardFileHandle(boardId: string): Promise<void> {
  if (!idbAvailable()) return;
  try {
    await withStore("readwrite", (store) => store.delete(boardId));
  } catch (e) {
    if (e instanceof StoreError) throw e;
    throw new StoreError("io", "Could not detach the file from this board.", {
      cause: e,
    });
  }
}

/** Board ids that have a file attached — lets the picker mark them. Never throws. */
export async function boardIdsWithFiles(): Promise<string[]> {
  if (!idbAvailable()) return [];
  try {
    const keys = await withStore<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys(),
    );
    return keys.filter((key): key is string => typeof key === "string");
  } catch {
    return [];
  }
}
