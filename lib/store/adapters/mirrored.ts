/**
 * Two sinks, one document — how a file gets *added* to a board instead of
 * replacing where it lives.
 *
 * The store holds exactly one `StorageAdapter`. The product requires that
 * **localStorage stays the base layer even when a file is attached**: it holds the
 * workspace index and a mirror of the active document, so the app still opens in a
 * browser with no File System Access API, and a user who revokes file permission
 * (or moves the file) does not lose their board. That makes the file an *opt-in
 * additional sink*, not a mode switch — which is exactly what a mirrored adapter
 * is:
 *
 *   store.attachAdapter(
 *     createMirroredAdapter(workspace.adapterFor(id), createFileSystemAdapter(handle)),
 *     { seed: true },   // ← writes the CURRENT in-memory board into the new file
 *   );
 *
 * Ordering is the whole design:
 *
 *   save() → **base first**, then the sink.
 *     localStorage's `setItem` is synchronous (see `local-storage.ts`), so the bytes
 *     land even on the `beforeunload` flush. Writing the fragile, permission-gated,
 *     user-relocatable file first would mean a failure there costs us the browser
 *     copy too. A sink failure after a successful base write is *reported* — the
 *     store keeps the change dirty and retries — but nothing is lost.
 *
 *   load() → **sink first**, and its failures are NOT swallowed.
 *     The file is the artifact the user pointed at; if they edited it in another
 *     tool, that is the version they mean. Falling back to the browser mirror on a
 *     permission error would show them a stale board and then autosave it over the
 *     newer file. We would rather fail loudly and offer a reconnect. The base is
 *     used only when the file has genuinely never been written (`null`).
 *
 * Generic on purpose: the Tauri adapter drops into `sink` unchanged.
 */

import type { StorageAdapter } from "./types";

class MirroredAdapter implements StorageAdapter {
  readonly id: string;
  readonly label: string;

  private readonly base: StorageAdapter;
  private readonly sink: StorageAdapter;

  constructor(base: StorageAdapter, sink: StorageAdapter) {
    this.base = base;
    this.sink = sink;
    // `local+fsa` — the UI can still tell what it is talking to.
    this.id = `${base.id}+${sink.id}`;
    // The sink's label is the one worth showing: "Saving to board.wtboard.json".
    this.label = sink.label;
  }

  /** Both must work. A file we cannot write is not a working configuration. */
  async isAvailable(): Promise<boolean> {
    const [base, sink] = await Promise.all([
      this.base.isAvailable(),
      this.sink.isAvailable(),
    ]);
    return base && sink;
  }

  async load(): Promise<string | null> {
    const fromSink = await this.sink.load(); // throws → propagates, on purpose
    if (fromSink !== null) return fromSink;
    return this.base.load();
  }

  async save(json: string): Promise<void> {
    await this.base.save(json); // never lose the browser copy
    await this.sink.save(json);
  }

  async clear(): Promise<void> {
    await this.base.clear();
    // A no-op for a file sink, and deliberately so — see `file-system.ts`. We do
    // not delete or truncate a file the user chose because a board was removed
    // from the app.
    await this.sink.clear();
  }
}

export function createMirroredAdapter(
  base: StorageAdapter,
  sink: StorageAdapter,
): StorageAdapter {
  return new MirroredAdapter(base, sink);
}
