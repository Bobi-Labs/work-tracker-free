/**
 * localStorage adapter — the base layer, always.
 *
 * Even once File System Access or Tauri is attached, localStorage keeps holding
 * the workspace index, the active board id, and a mirror of the document. That
 * makes a real file an *additional sink* rather than a *mode switch*: Firefox and
 * Safari (no FSA) keep working, and nothing needs a migration when a user starts
 * or stops syncing a board to disk.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. **`isAvailable()` probes an actual write.** Safari in private mode hands you
 *    a fully-formed `localStorage` object whose `setItem` throws on the first
 *    call. Feature-detecting `typeof localStorage` reports "available" and then
 *    every save fails.
 * 2. **`save()` calls `setItem` synchronously**, before returning its promise.
 *    The store force-flushes on `beforeunload`, where nothing async is guaranteed
 *    to run. Because there is no `await` before the write, the bytes land even if
 *    the returned promise is never settled.
 */

import { StoreError, type StorageAdapter } from "./types";

const PROBE_KEY = "wt.probe";

/** Firefox reports quota as `NS_ERROR_DOM_QUOTA_REACHED` / code 1014; everyone else as 22. */
function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

function getStorage(): Storage {
  if (typeof window === "undefined" || !window.localStorage) {
    throw new StoreError(
      "unavailable",
      "This browser has no localStorage (or storage is disabled).",
    );
  }
  return window.localStorage;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly id = "local";
  readonly label = "This browser";

  /** e.g. `wt.board.<uuid>` — see `boardStorageKey()` in `lib/types.ts`. */
  readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const storage = getStorage();
      storage.setItem(PROBE_KEY, "1");
      storage.removeItem(PROBE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<string | null> {
    try {
      return getStorage().getItem(this.key);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError("io", "Could not read this board from browser storage.", {
        cause: e,
      });
    }
  }

  async save(json: string): Promise<void> {
    // No `await` above this line, on purpose — see the file header.
    try {
      getStorage().setItem(this.key, json);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      if (isQuotaError(e)) {
        throw new StoreError(
          "quota",
          "Browser storage is full — this board could not be saved. Export it to a file, then delete boards you no longer need.",
          { cause: e },
        );
      }
      throw new StoreError("io", "Could not save this board to browser storage.", {
        cause: e,
      });
    }
  }

  async clear(): Promise<void> {
    try {
      getStorage().removeItem(this.key);
    } catch (e) {
      if (e instanceof StoreError) throw e;
      throw new StoreError("io", "Could not remove this board from browser storage.", {
        cause: e,
      });
    }
  }
}
