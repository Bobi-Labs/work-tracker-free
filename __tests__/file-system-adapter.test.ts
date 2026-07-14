/**
 * The file adapter, driven by a FAKE handle.
 *
 * No jsdom, no Chrome, no real File System Access API — the point of a fake is
 * that the two things that actually bite are reachable in a unit test:
 *
 *   1. A save/load round trip through `createWritable()` → `write` → `close`.
 *   2. **Permission `'prompt'` after a reload surfaces as a typed `StoreError`,
 *      immediately** — not a hang, not a swallowed click. A browser resets a
 *      stored handle's permission on every page load, so this is not an edge case,
 *      it is *every session*. If it ever regresses into a promise that never
 *      settles, the save indicator spins forever and the user believes their work
 *      is on disk when it is not.
 *
 * And the invariant that makes files safe to offer at all: a file failure NEVER
 * costs the browser copy. `createMirroredAdapter` writes localStorage first.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFileSystemAdapter,
  ensurePermission,
  isFileSystemAccessSupported,
  openBoardFile,
  pickFileForBoard,
  queryFilePermission,
  suggestFileName,
  type FilePermission,
} from "../lib/store/adapters/file-system";
import { MemoryAdapter } from "../lib/store/adapters/memory";
import { createMirroredAdapter } from "../lib/store/adapters/mirrored";
import { StoreError, type StorageAdapter } from "../lib/store/adapters/types";
import { createEmptyDoc } from "../lib/store/board-doc";
import { createBoardStore } from "../lib/store/store";

/* ─────────────────────────────── The fake ─────────────────────────────── */

class FakeFileHandle {
  contents: string;
  permission: FilePermission;
  /** Every completed write, in order — proves close() committed and abort() didn't. */
  readonly commits: string[] = [];
  /** Thrown by createWritable/write, to exercise the DOMException name → kind map. */
  failWith: { name: string } | null = null;
  requestCalls = 0;
  /** Chrome throws (rather than resolving "denied") when there is no user gesture. */
  requestThrows = false;

  constructor(
    readonly name = "board.wtboard.json",
    options: { contents?: string; permission?: FilePermission } = {},
  ) {
    this.contents = options.contents ?? "";
    this.permission = options.permission ?? "granted";
  }

  async queryPermission(): Promise<FilePermission> {
    return this.permission;
  }

  async requestPermission(): Promise<FilePermission> {
    this.requestCalls++;
    if (this.requestThrows) throw new DOMException("gesture required", "SecurityError");
    this.permission = "granted";
    return this.permission;
  }

  async getFile(): Promise<{ text(): Promise<string> }> {
    if (this.failWith) throw new DOMException("nope", this.failWith.name);
    const contents = this.contents;
    return { text: async () => contents };
  }

  async createWritable() {
    if (this.failWith) throw new DOMException("nope", this.failWith.name);
    let buffer = "";
    return {
      write: async (chunk: string) => {
        buffer += chunk;
      },
      close: async () => {
        // Only a successful close() commits — that is why an aborted write leaves
        // the previous contents intact.
        this.contents = buffer;
        this.commits.push(buffer);
      },
      abort: async () => {},
    };
  }

  /** The adapter takes a real `FileSystemFileHandle`; the fake is the subset it uses. */
  asHandle(): FileSystemFileHandle {
    return this as unknown as FileSystemFileHandle;
  }
}

function adapterFor(handle: FakeFileHandle): StorageAdapter {
  return createFileSystemAdapter(handle.asHandle());
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ────────────────────────────── Round trip ────────────────────────────── */

describe("save → load", () => {
  it("round-trips a document through the handle", async () => {
    const handle = new FakeFileHandle();
    const adapter = adapterFor(handle);

    expect(await adapter.load()).toBeNull(); // a file the picker just created is empty

    await adapter.save('{"hello":"world"}');
    expect(handle.contents).toBe('{"hello":"world"}');
    expect(await adapter.load()).toBe('{"hello":"world"}');

    await adapter.save('{"hello":"again"}'); // whole-document overwrite
    expect(handle.commits).toEqual(['{"hello":"world"}', '{"hello":"again"}']);
  });

  it("carries a real board across a session, through the store", async () => {
    const handle = new FakeFileHandle();
    const store = createBoardStore({ adapter: adapterFor(handle), debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("On disk"));
    store.addItem({ title: "written to a file", category: "task" });
    await store.flush();

    expect(store.getStatus().state).toBe("saved");
    expect(store.getStatus().adapterId).toBe("fsa");

    // A new session over the same file.
    const reopened = createBoardStore({ adapter: adapterFor(handle) });
    const result = await reopened.hydrate();

    expect(result.status).toBe("loaded");
    expect(reopened.getSnapshot()).toEqual(store.getSnapshot());
    expect(reopened.getSnapshot().items[0]!.title).toBe("written to a file");
  });

  it("labels itself with the file name (the UI renders “Saving to …”)", () => {
    expect(adapterFor(new FakeFileHandle("q3-work.wtboard.json")).label).toBe(
      "q3-work.wtboard.json",
    );
  });
});

/* ────────────────────────────── Permission ────────────────────────────── */

describe("permission", () => {
  it("surfaces 'prompt' as a typed StoreError instead of hanging", async () => {
    // Exactly the post-reload state: the handle survived in IndexedDB, the grant
    // did not.
    const handle = new FakeFileHandle("board.wtboard.json", { permission: "prompt" });
    const adapter = adapterFor(handle);

    const saved = adapter.save('{"a":1}');
    await expect(saved).rejects.toBeInstanceOf(StoreError);
    await expect(saved).rejects.toMatchObject({ kind: "unavailable" });
    await expect(adapter.load()).rejects.toMatchObject({ kind: "unavailable" });

    // It did not touch the file, and it did not prompt — prompting outside a user
    // gesture is what silently fails.
    expect(handle.commits).toHaveLength(0);
    expect(handle.requestCalls).toBe(0);

    // …and the message has to tell the user what to click.
    await expect(saved).rejects.toThrow(/Reconnect board\.wtboard\.json/);
  });

  it("parks a 'prompt' failure in the store's status and keeps the change dirty", async () => {
    const handle = new FakeFileHandle("board.wtboard.json", { permission: "prompt" });
    const store = createBoardStore({ adapter: adapterFor(handle), debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("Needs reconnect"));
    store.addItem({ title: "precious", category: "task" });

    await store.flush();

    const status = store.getStatus();
    expect(status.state).toBe("error");
    expect((status.error as StoreError).kind).toBe("unavailable");
    expect(status.pending).toBe(true); // still dirty → the reconnect retries it
    expect(store.getSnapshot().items[0]!.title).toBe("precious"); // nothing lost

    // The user clicks "Reconnect", grants, and the SAME pending change lands.
    expect(await ensurePermission(handle.asHandle())).toBe("granted");
    await store.flush();

    expect(store.getStatus().state).toBe("saved");
    expect(store.getStatus().error).toBeNull();
    expect(JSON.parse(handle.contents).items[0].title).toBe("precious");
  });

  it("ensurePermission() reports 'prompt' (not 'denied') when there was no user gesture", async () => {
    const handle = new FakeFileHandle("b.json", { permission: "prompt" });
    handle.requestThrows = true; // Chrome outside a click
    // Recoverable — the UI must keep offering the button, not give up.
    expect(await ensurePermission(handle.asHandle())).toBe("prompt");
  });

  it("ensurePermission() short-circuits on 'granted' and 'denied'", async () => {
    const granted = new FakeFileHandle("b.json", { permission: "granted" });
    expect(await ensurePermission(granted.asHandle())).toBe("granted");
    expect(granted.requestCalls).toBe(0);

    const denied = new FakeFileHandle("b.json", { permission: "denied" });
    expect(await ensurePermission(denied.asHandle())).toBe("denied");
    expect(denied.requestCalls).toBe(0);
  });

  it("a denied handle says so, and points at the browser copy", async () => {
    const handle = new FakeFileHandle("b.json", { permission: "denied" });
    await expect(adapterFor(handle).save("{}")).rejects.toThrow(
      /still saved in this browser/,
    );
  });

  it("queryFilePermission() assumes granted when the engine has no queryPermission()", async () => {
    const bare = {
      name: "b.json",
      getFile: async () => ({ text: async () => "" }),
    } as unknown as FileSystemFileHandle;
    expect(await queryFilePermission(bare)).toBe("granted");
  });
});

/* ───────────────────────────── Error mapping ───────────────────────────── */

describe("failure kinds", () => {
  const cases: Array<[string, StoreError["kind"], RegExp]> = [
    ["NotAllowedError", "unavailable", /permission/i],
    ["NotFoundError", "unavailable", /no longer where it was/i],
    ["QuotaExceededError", "quota", /not enough room/i],
    ["InvalidStateError", "io", /Could not saved|Could not/i],
  ];

  for (const [name, kind, message] of cases) {
    it(`${name} → ${kind}`, async () => {
      const handle = new FakeFileHandle();
      handle.failWith = { name };
      const rejected = adapterFor(handle).save("{}");
      await expect(rejected).rejects.toBeInstanceOf(StoreError);
      await expect(rejected).rejects.toMatchObject({ kind });
      await expect(rejected).rejects.toThrow(message);
    });
  }

  it("leaves the previous contents intact when a write fails", async () => {
    const handle = new FakeFileHandle("b.json", { contents: '{"good":true}' });
    handle.failWith = { name: "NotFoundError" };
    await expect(adapterFor(handle).save('{"bad":true}')).rejects.toBeInstanceOf(
      StoreError,
    );
    expect(handle.contents).toBe('{"good":true}');
  });

  it("clear() does NOT destroy the user's file", async () => {
    // Removing a board from the app is not consent to erase a file on their disk.
    const handle = new FakeFileHandle("b.json", { contents: '{"mine":true}' });
    await adapterFor(handle).clear();
    expect(handle.contents).toBe('{"mine":true}');
    expect(handle.commits).toHaveLength(0);
  });
});

/* ─────────────────────────────── Degrading ─────────────────────────────── */

describe("browsers without the File System Access API", () => {
  it("feature-detects false and the pickers return null rather than throwing", async () => {
    // Node's global has no `window` at all — the same shape as prerender.
    expect(isFileSystemAccessSupported()).toBe(false);
    expect(await pickFileForBoard("My Board")).toBeNull();
    expect(await openBoardFile()).toBeNull();

    // Firefox/Safari: a `window`, no pickers.
    vi.stubGlobal("window", {});
    expect(isFileSystemAccessSupported()).toBe(false);
    expect(await pickFileForBoard("My Board")).toBeNull();

    vi.stubGlobal("window", { showSaveFilePicker: () => {} });
    expect(isFileSystemAccessSupported()).toBe(true);
  });

  it("isAvailable() is false until the file is actually reconnected", async () => {
    vi.stubGlobal("window", { showSaveFilePicker: () => {} });
    const prompt = new FakeFileHandle("b.json", { permission: "prompt" });
    expect(await adapterFor(prompt).isAvailable()).toBe(false);

    const granted = new FakeFileHandle("b.json", { permission: "granted" });
    expect(await adapterFor(granted).isAvailable()).toBe(true);
  });

  it("suggests a safe file name", () => {
    expect(suggestFileName("My Board")).toBe("my-board.wtboard.json");
    expect(suggestFileName("../../etc/passwd")).toBe("etc-passwd.wtboard.json");
    expect(suggestFileName("///")).toBe("board.wtboard.json");
  });
});

/* ───────────────────────── localStorage stays the base ───────────────────────── */

describe("mirrored adapter", () => {
  it("writes the browser copy FIRST, so a file failure never loses the board", async () => {
    const base = new MemoryAdapter();
    const broken = new FakeFileHandle("b.json", { permission: "prompt" });
    const store = createBoardStore({
      adapter: createMirroredAdapter(base, adapterFor(broken)),
      debounceMs: 1,
    });

    store.replaceDoc(createEmptyDoc("Belt and braces"));
    store.addItem({ title: "not lost", category: "task" });
    await store.flush();

    // The file save failed and the user is told…
    expect(store.getStatus().state).toBe("error");
    expect((store.getStatus().error as StoreError).kind).toBe("unavailable");
    // …but the board is safe in the browser regardless.
    expect(JSON.parse(base.peek()!).items[0].title).toBe("not lost");
  });

  it("prefers the file on load, and falls back to the browser only when the file is empty", async () => {
    const local = createEmptyDoc("Stale local");
    const base = new MemoryAdapter({ initial: JSON.stringify(local) });

    const empty = new FakeFileHandle();
    expect(await createMirroredAdapter(base, adapterFor(empty)).load()).toBe(
      JSON.stringify(local),
    );

    const written = new FakeFileHandle("b.json", {
      contents: JSON.stringify({ ...local, name: "Newer on disk" }),
    });
    const raw = await createMirroredAdapter(base, adapterFor(written)).load();
    expect(JSON.parse(raw!).name).toBe("Newer on disk");
  });

  it("does not fall back to a stale browser copy when the file is merely locked", async () => {
    // Falling back here would show the old board and then autosave it over the
    // newer file. Fail loudly instead; the UI offers a reconnect.
    const base = new MemoryAdapter({ initial: JSON.stringify(createEmptyDoc("Old")) });
    const locked = new FakeFileHandle("b.json", { permission: "prompt" });
    await expect(
      createMirroredAdapter(base, adapterFor(locked)).load(),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("labels itself with the file, and keeps both ids visible", () => {
    const mirrored = createMirroredAdapter(
      new MemoryAdapter({ id: "local", label: "This browser" }),
      adapterFor(new FakeFileHandle("q3.wtboard.json")),
    );
    expect(mirrored.label).toBe("q3.wtboard.json");
    expect(mirrored.id).toBe("local+fsa");
  });
});

/* ─────────────────────────── attachAdapter({ seed }) ─────────────────────────── */

describe("attaching a file to a board that already exists", () => {
  it("seeds the new file with the CURRENT in-memory document", async () => {
    // The user has been working in the browser; now they click "Save to a file…".
    // Without a seed the file stays 0 bytes until the next keystroke, while the UI
    // claims "Saving to board.wtboard.json".
    const base = new MemoryAdapter();
    const store = createBoardStore({ adapter: base, debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("Existing work"));
    store.addItem({ title: "written before the file existed", category: "task" });
    await store.flush();
    expect(store.getStatus().pending).toBe(false); // clean — nothing left to save

    const handle = new FakeFileHandle();
    store.attachAdapter(createMirroredAdapter(base, adapterFor(handle)), { seed: true });
    await store.flush();

    expect(JSON.parse(handle.contents).items[0].title).toBe(
      "written before the file existed",
    );
    expect(store.getStatus().state).toBe("saved");
  });

  it("does NOT write on a plain attach — the board-switch path must stay a read", async () => {
    // A clean store (board A, already saved). Attaching board B's adapter WITHOUT
    // a seed must not push A's document into B's slot before hydrate() reads it.
    // (A *dirty* store still flushes on attach — that is the first-run "Start
    // empty" path, and persistence.test.ts pins it.)
    const store = createBoardStore({ adapter: new MemoryAdapter(), debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("A"));
    await store.flush();

    const other = new MemoryAdapter({ initial: JSON.stringify(createEmptyDoc("B")) });
    store.attachAdapter(other); // switching boards: hydrate() is about to read this
    await store.flush();

    expect(other.writes).toHaveLength(0);
    expect(JSON.parse(other.peek()!).name).toBe("B"); // board B, unharmed
  });
});
