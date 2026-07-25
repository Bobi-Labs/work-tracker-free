/**
 * File System Access adapter — a real file on the user's disk.
 *
 * This is the whole desktop story, and it is a **strict superset** of the browser
 * one rather than a mode switch: localStorage stays the base layer (it holds the
 * workspace index and a mirror of every document), and a file is an *additional*
 * sink layered on top via `createMirroredAdapter()`. Consequences that matter:
 *
 *   - Firefox and Safari have no File System Access API. They keep working, on
 *     localStorage alone, with the file UI simply absent. `isFileSystemAccessSupported()`
 *     is the one gate — it **degrades, it never throws**.
 *   - A user who revokes file permission, moves the file, or deletes it does not
 *     lose their board. The browser copy is still there.
 *
 * ⚠️ THE PERMISSION RULE, which shapes this entire API.
 *
 * A `FileSystemFileHandle` survives a reload (we keep it in IndexedDB — see
 * `../file-handles.ts`), but its **permission does not**. On the next page load
 * `queryPermission()` reports `'prompt'`, and permission can only be re-granted
 * from a **user gesture**. There is no way to silently re-acquire it on mount.
 *
 * So this adapter **never prompts**. It checks, and if the answer is not
 * `'granted'` it throws a typed `StoreError` immediately — a fast, rendered
 * "reconnect this file" rather than a save that hangs forever or a click that
 * gets swallowed because it happened outside a gesture. The UI is responsible for
 * rendering a "Reconnect <filename>" button and calling `ensurePermission()` from
 * inside its click handler. That is the only place `requestPermission()` may run.
 *
 * Error mapping (there is no `permission` kind — read `types.ts`: `unavailable`
 * is defined as "the backend is not usable here — … no permission"):
 *
 *   NotAllowedError / SecurityError  → `unavailable`  ("reconnect the file")
 *   NotFoundError                    → `unavailable`  (moved, renamed, deleted)
 *   QuotaExceededError               → `quota`        (disk full)
 *   anything else                    → `io`
 */

import { StoreError, type StorageAdapter } from "./types";

/** Boards are saved as `<name>.wtboard.json` — still plain JSON, just self-identifying. */
export const BOARD_FILE_EXTENSION = ".wtboard.json";

export type FilePermission = "granted" | "prompt" | "denied";

/* ────────────────────────── The bits TS's lib.dom lacks ──────────────────────────
 * `FileSystemFileHandle` and `createWritable()` are in lib.dom. The permission
 * methods and the pickers are not (they are the non-standardised half of the
 * spec), so we describe exactly the slice we use and cast at the boundary. No
 * global augmentation: if a future TypeScript ships these, nothing here collides.
 */

interface PermissionDescriptor {
  mode: "read" | "readwrite";
}

interface PermissionAwareHandle {
  queryPermission?(descriptor: PermissionDescriptor): Promise<FilePermission>;
  requestPermission?(descriptor: PermissionDescriptor): Promise<FilePermission>;
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
}

interface FilePickerWindow {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(
    options?: OpenFilePickerOptions,
  ): Promise<FileSystemFileHandle[]>;
}

function pickerWindow(): FilePickerWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as FilePickerWindow;
}

/**
 * Is the File System Access API usable in this browser?
 *
 * Chrome/Edge: yes. Firefox/Safari: no — and that is a supported configuration,
 * not an error. Every entry point below returns `null` / `false` rather than
 * throwing when this is `false`, so the caller's only job is to not render the
 * button.
 *
 * Safe during prerender: `typeof window` is guarded, so this is `false` at build
 * time and the first client render agrees with the prerendered HTML.
 */
export function isFileSystemAccessSupported(): boolean {
  const w = pickerWindow();
  return w !== null && typeof w.showSaveFilePicker === "function";
}

/* ────────────────────────────── Error mapping ────────────────────────────── */

function errorName(e: unknown): string {
  if (e && typeof e === "object" && "name" in e) {
    const name = (e as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** The user hit Cancel in the file picker. Not a failure — there is nothing to report. */
function isAbort(e: unknown): boolean {
  return errorName(e) === "AbortError";
}

const JSON_FILE_TYPE: FilePickerAcceptType = {
  description: "Work Tracker board",
  accept: { "application/json": [".json"] },
};

function toFileStoreError(e: unknown, fileName: string, verb: string): StoreError {
  if (e instanceof StoreError) return e;

  switch (errorName(e)) {
    case "NotAllowedError":
    case "SecurityError":
      return new StoreError(
        "unavailable",
        `Permission to use “${fileName}” was withdrawn, so it could not be ${verb}. Reconnect the file to continue saving to it. Your board is still saved in this browser.`,
        { cause: e },
      );

    case "NotFoundError":
      return new StoreError(
        "unavailable",
        `“${fileName}” is no longer where it was. It may have been moved, renamed, or deleted. Your board is still saved in this browser; pick a new file to keep syncing it to disk.`,
        { cause: e },
      );

    case "QuotaExceededError":
      return new StoreError(
        "quota",
        `There is not enough room on disk to save “${fileName}”.`,
        { cause: e },
      );

    default:
      return new StoreError("io", `Could not ${verb} “${fileName}”.`, { cause: e });
  }
}

/* ───────────────────────────── Permissions ───────────────────────────── */

/**
 * The handle's current permission — **read-only, never prompts**. Safe to call on
 * mount, in an effect, anywhere.
 *
 * An implementation without `queryPermission` (it is not in every engine that
 * ships `createWritable`) is treated as granted: we then find out for real on the
 * first read/write, and that failure maps to `unavailable` like any other.
 */
export async function queryFilePermission(
  handle: FileSystemFileHandle,
): Promise<FilePermission> {
  const permissioned = handle as unknown as PermissionAwareHandle;
  if (typeof permissioned.queryPermission !== "function") return "granted";
  try {
    return await permissioned.queryPermission({ mode: "readwrite" });
  } catch (e) {
    // A handle whose backing file is gone can throw here. `prompt` is the honest
    // answer: the UI offers a reconnect, and reconnecting reports the real cause.
    return "prompt";
  }
}

/**
 * Ensure we can write to `handle`, prompting the user if we must.
 *
 * ⚠️ **CALL THIS FROM A USER GESTURE — a click handler, nothing else.** Chrome
 * rejects `requestPermission()` outside one, which is precisely why a stored
 * handle cannot be silently revived on mount. The intended flow after a reload:
 *
 * ```ts
 * const handle = await loadBoardFileHandle(boardId);       // effect: cheap, no prompt
 * const state  = handle ? await queryFilePermission(handle) : null;
 * // state === "prompt"  → render <button>Reconnect {handle.name}</button>
 *
 * async function onReconnectClick() {                       // ← the user gesture
 *   if (await ensurePermission(handle) !== "granted") return;
 *   store.attachAdapter(
 *     createMirroredAdapter(workspace.adapterFor(boardId), createFileSystemAdapter(handle)),
 *   );
 * }
 * ```
 *
 * Returns `'prompt'` (not `'denied'`) if the request itself was refused for lack
 * of a gesture — that state is still recoverable by clicking the button properly.
 */
export async function ensurePermission(
  handle: FileSystemFileHandle,
): Promise<FilePermission> {
  const current = await queryFilePermission(handle);
  if (current !== "prompt") return current;

  const permissioned = handle as unknown as PermissionAwareHandle;
  if (typeof permissioned.requestPermission !== "function") return "prompt";

  try {
    return await permissioned.requestPermission({ mode: "readwrite" });
  } catch {
    // Thrown, not resolved-as-denied ⇒ we were outside a user gesture. Still
    // recoverable; report the state that says so.
    return "prompt";
  }
}

/* ─────────────────────────────── Pickers ─────────────────────────────── */

/** `My Board` → `my-board.wtboard.json`. Path separators cannot survive this. */
export function suggestFileName(boardName: string): string {
  const slug = boardName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "board"}${BOARD_FILE_EXTENSION}`;
}

/**
 * "Save this board to a file…" — `showSaveFilePicker`.
 *
 * Returns `null` when the user cancels **and** when the browser has no File
 * System Access API. Both are ordinary outcomes; neither throws. Must be called
 * from a user gesture (the picker itself requires one).
 */
export async function pickFileForBoard(
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  const w = pickerWindow();
  if (!w?.showSaveFilePicker) return null;

  try {
    return await w.showSaveFilePicker({
      suggestedName: suggestedName.endsWith(BOARD_FILE_EXTENSION)
        ? suggestedName
        : suggestFileName(suggestedName),
      types: [JSON_FILE_TYPE],
    });
  } catch (e) {
    if (isAbort(e)) return null;
    throw toFileStoreError(e, suggestedName, "created");
  }
}

/**
 * "Open a board file…" — `showOpenFilePicker`. `null` on cancel or on an
 * unsupported browser. Must be called from a user gesture.
 */
export async function openBoardFile(): Promise<FileSystemFileHandle | null> {
  const w = pickerWindow();
  if (!w?.showOpenFilePicker) return null;

  try {
    const handles = await w.showOpenFilePicker({
      types: [JSON_FILE_TYPE],
      multiple: false,
    });
    return handles[0] ?? null;
  } catch (e) {
    if (isAbort(e)) return null;
    throw toFileStoreError(e, "that file", "opened");
  }
}

/* ─────────────────────────────── Adapter ─────────────────────────────── */

class FileSystemAdapter implements StorageAdapter {
  readonly id = "fsa";
  /** The file name — the UI renders "Saving to board.wtboard.json". */
  readonly label: string;

  private readonly handle: FileSystemFileHandle;

  constructor(handle: FileSystemFileHandle) {
    this.handle = handle;
    this.label = handle.name;
  }

  /** The handle we were built from — the UI needs it to store/forget it in IndexedDB. */
  get fileHandle(): FileSystemFileHandle {
    return this.handle;
  }

  /**
   * Usable *right now* — which for a file means the API exists **and** permission
   * is currently granted. After a reload it is `false` until the user reconnects,
   * and that is the correct answer, not a bug.
   */
  async isAvailable(): Promise<boolean> {
    if (!isFileSystemAccessSupported()) return false;
    return (await queryFilePermission(this.handle)) === "granted";
  }

  /**
   * Fail fast on a handle we are not allowed to touch. Without this, a save on a
   * `'prompt'` handle either rejects deep inside `createWritable()` with an
   * opaque DOMException or — depending on the engine — sits there. Either way the
   * store's `error` is what the user sees, so it had better say the right thing.
   */
  private async assertPermitted(): Promise<void> {
    const state = await queryFilePermission(this.handle);
    if (state === "granted") return;

    if (state === "denied") {
      throw new StoreError(
        "unavailable",
        `Permission to use “${this.label}” was denied. Your board is still saved in this browser. Pick a different file to sync it to disk.`,
      );
    }

    throw new StoreError(
      "unavailable",
      `“${this.label}” needs your permission again. Browsers forget file access on reload. Click “Reconnect ${this.label}” to resume saving to it. Nothing is lost: your board is still saved in this browser.`,
    );
  }

  async load(): Promise<string | null> {
    await this.assertPermitted();
    try {
      const text = await (await this.handle.getFile()).text();
      // A file the user just created through the save picker exists and is empty.
      // That is "nothing has ever been written here", not a corrupt document.
      return text.trim() === "" ? null : text;
    } catch (e) {
      throw toFileStoreError(e, this.label, "read");
    }
  }

  async save(json: string): Promise<void> {
    await this.assertPermitted();

    let writable: FileSystemWritableFileStream;
    try {
      writable = await this.handle.createWritable();
    } catch (e) {
      throw toFileStoreError(e, this.label, "saved");
    }

    try {
      await writable.write(json);
      await writable.close();
    } catch (e) {
      // `createWritable()` writes to a swap file and only commits on `close()`, so
      // aborting leaves the user's file untouched — the old contents survive a
      // failed write. Never leave the stream dangling.
      try {
        await writable.abort();
      } catch {
        /* already closed / already gone */
      }
      throw toFileStoreError(e, this.label, "saved");
    }
  }

  /**
   * DELIBERATE DIVERGENCE FROM THE CONTRACT. `StorageAdapter.clear()` says "remove
   * the persisted document entirely" — for localStorage, one `removeItem`. Here it
   * would mean truncating (or unlinking) **a file the user chose, on their disk,
   * that they may well have in a git repo or a Dropbox folder**. Deleting a board
   * inside the app is not consent to destroy that file.
   *
   * So this is a no-op, and the mirrored adapter still clears the browser copy.
   * The board leaves the app; the file remains theirs.
   */
  async clear(): Promise<void> {
    /* intentionally does not touch the user's file — see above */
  }
}

/** `createFileSystemAdapter(handle)` — the file sink for one board. */
export function createFileSystemAdapter(handle: FileSystemFileHandle): StorageAdapter {
  return new FileSystemAdapter(handle);
}
