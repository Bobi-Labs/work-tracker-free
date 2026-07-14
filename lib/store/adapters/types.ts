/**
 * The storage contract.
 *
 * Deliberately **whole-document, async, and dumb**: no queries, no patches, no
 * transactions, no partial reads. That is not laziness — it is the only contract
 * that maps 1:1 onto all three backends we intend to ship:
 *
 * | adapter            | load                            | save                                  |
 * |--------------------|---------------------------------|---------------------------------------|
 * | localStorage       | `getItem(key)`                  | `setItem(key, json)`                   |
 * | File System Access | `(await handle.getFile()).text()` | `createWritable()` → write → close    |
 * | Tauri v2           | `readTextFile(path)`            | `writeTextFile(path, json)`            |
 *
 * A board is small (200 items + markdown ≪ 1 MB), so rewriting the whole
 * document on every save is correct and deletes the entire partial-write /
 * merge-conflict bug class. It is also why the Tauri adapter is ~30 lines
 * instead of a port.
 *
 * Adapters are **dumb pipes**: they know nothing about `BoardDoc`, zod,
 * migration, or debouncing. They move a string. That is all.
 */

/** Why a storage operation failed. Drives what the UI is allowed to say. */
export type StoreErrorKind =
  /** Out of space. Real: localStorage caps at ~5 MB and deliverables are markdown-heavy. */
  | "quota"
  /** The backend is not usable here — Safari private mode, disabled storage, no permission. */
  | "unavailable"
  /** Anything else the backend threw. */
  | "io";

/**
 * The only error type an adapter may throw. The store catches it and parks it in
 * `getStatus().error` — save failures are **never swallowed**. A tool whose whole
 * value proposition is "your data stays on your machine" cannot fail to write and
 * say nothing.
 */
export class StoreError extends Error {
  readonly kind: StoreErrorKind;

  constructor(kind: StoreErrorKind, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "StoreError";
    this.kind = kind;
    if (options?.cause !== undefined) {
      // `cause` is ES2022; assigning it directly keeps us off that lib target.
      (this as { cause?: unknown }).cause = options.cause;
    }
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}

export interface StorageAdapter {
  /** Stable machine id — `"memory"`, `"local"`, `"fsa"`, `"tauri"`. */
  readonly id: string;
  /** Human label for the UI: `"This browser"`, `"board.json"`. */
  readonly label: string;

  /**
   * Can this adapter be used *right now*? Implementations must **probe**, not
   * feature-detect: Safari in private mode exposes a complete `localStorage`
   * object whose `setItem` throws.
   */
  isAvailable(): Promise<boolean>;

  /** The persisted document, or `null` if nothing has ever been written. */
  load(): Promise<string | null>;

  /** Replace the persisted document wholesale. Throws `StoreError`. */
  save(json: string): Promise<void>;

  /** Remove the persisted document entirely. */
  clear(): Promise<void>;
}
