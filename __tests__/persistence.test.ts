/**
 * The store ↔ adapter contract.
 *
 * This is the whole product promise: the user's data is on their machine and it
 * is still there tomorrow. There is no server to re-fetch from, so a write that
 * silently didn't happen is unrecoverable — the bytes only ever existed in a tab
 * that is now closed.
 *
 * Hence the two rules with teeth: a save failure is **surfaced, never swallowed**
 * (localStorage quota is ~5 MB and deliverables are markdown), and a document we
 * failed to *parse* is never overwritten by autosave.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSampleBoard } from "../lib/seed/sample-board";
import { MemoryAdapter } from "../lib/store/adapters/memory";
import { StoreError, type StorageAdapter } from "../lib/store/adapters/types";
import { EMPTY_BOARD_DOC, createEmptyDoc } from "../lib/store/board-doc";
import { createBoardStore } from "../lib/store/store";
import { rig, tick } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("save", () => {
  it("persists through the adapter and restores on hydrate()", async () => {
    const adapter = new MemoryAdapter();
    const store = createBoardStore({ adapter, debounceMs: 1 });

    // A realistic document: notes, deliverables, questions, markdown.
    store.replaceDoc(createSampleBoard());
    const item = store.addItem({ title: "one more", category: "feature" });
    store.addNote(item.id, "with a note");
    await store.flush();

    expect(adapter.writes.length).toBeGreaterThan(0);
    expect(adapter.peek()).not.toBeNull();

    // A new session: a brand-new store over the same bytes.
    const reopened = createBoardStore({
      adapter: new MemoryAdapter({ initial: adapter.peek() }),
    });
    const result = await reopened.hydrate();

    expect(result.status).toBe("loaded");
    expect(reopened.getSnapshot()).toEqual(store.getSnapshot());
    expect(reopened.getSnapshot().items.find((i) => i.id === item.id)!.notes).toHaveLength(
      1,
    );
    expect(reopened.getStatus().state).toBe("saved");
    expect(reopened.getStatus().pending).toBe(false);
  });

  it("debounces a burst into a single write", async () => {
    vi.useFakeTimers();
    const adapter = new MemoryAdapter();
    const store = createBoardStore({ adapter, debounceMs: 400 });
    store.replaceDoc(createEmptyDoc("Burst"));

    for (let i = 0; i < 10; i++) store.addItem({ title: `#${i}`, category: "task" });
    expect(adapter.writes).toHaveLength(0); // nothing yet — still typing
    expect(store.getStatus().pending).toBe(true);

    await vi.advanceTimersByTimeAsync(400);

    expect(adapter.writes).toHaveLength(1); // …and exactly one write, not ten
    expect(JSON.parse(adapter.peek()!).items).toHaveLength(10);
    expect(store.getStatus().state).toBe("saved");
    expect(store.getStatus().pending).toBe(false);
  });

  it("writes the same bytes it exports", async () => {
    const { store, adapter } = rig({ debounceMs: 1 });
    store.addItem({ title: "a", category: "task" });
    await store.flush();
    expect(adapter.peek()).toBe(store.exportJson());
  });

  it("SURFACES a save failure and keeps the change dirty for the next attempt", async () => {
    let fail = true;
    const saves: string[] = [];
    const flaky: StorageAdapter = {
      id: "flaky",
      label: "Flaky",
      isAvailable: async () => true,
      load: async () => null,
      save: async (json) => {
        if (fail) throw new StoreError("quota", "Storage is full.");
        saves.push(json);
      },
      clear: async () => {},
    };

    const store = createBoardStore({ adapter: flaky, debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("Doomed"));
    store.addItem({ title: "precious", category: "task" });

    await store.flush();

    const status = store.getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toBeInstanceOf(StoreError);
    expect((status.error as StoreError).kind).toBe("quota");
    // Still dirty: the edit lives only in memory and the store knows it.
    expect(status.pending).toBe(true);
    // …and the edit itself was NOT discarded.
    expect(store.getSnapshot().items[0]!.title).toBe("precious");

    fail = false;
    await store.flush();
    expect(saves).toHaveLength(1);
    expect(JSON.parse(saves[0]!).items[0].title).toBe("precious");
    expect(store.getStatus().state).toBe("saved");
    expect(store.getStatus().error).toBeNull();
    expect(store.getStatus().pending).toBe(false);
  });

  it("does not write when nothing changed", async () => {
    const { store, adapter } = rig({ debounceMs: 1 });
    await store.flush();
    const writes = adapter.writes.length;

    await store.flush();
    await store.flush();
    expect(adapter.writes).toHaveLength(writes);
  });
});

describe("hydrate", () => {
  it("reports `empty` for storage that has never been written, and writes nothing", async () => {
    const adapter = new MemoryAdapter();
    const store = createBoardStore({ adapter });

    expect((await store.hydrate()).status).toBe("empty");
    expect(adapter.writes).toHaveLength(0);
    // Still the prerender document — nothing was invented on the user's behalf.
    expect(store.getSnapshot()).toBe(EMPTY_BOARD_DOC);
  });

  it("SUSPENDS autosave on a corrupt document rather than overwriting it", async () => {
    const damaged = '{"kind":"worktracker.board","schemaVersion":1,"items":';
    const adapter = new MemoryAdapter({ initial: damaged });
    const store = createBoardStore({ adapter, debounceMs: 1 });

    const result = await store.hydrate();
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") throw new Error("unreachable");
    // The raw bytes come back so the UI can offer download-before-discard.
    expect(result.raw).toBe(damaged);
    expect(store.getStatus().suspended).toBe(true);

    // Autosave is off. Even a flush must not touch the damaged bytes.
    tick();
    await store.flush();
    expect(adapter.writes).toHaveLength(0);
    expect(adapter.peek()).toBe(damaged);

    // Only an explicit user act — "start over" / "import" — overwrites them.
    store.replaceDoc(createEmptyDoc("Recovered"));
    await store.flush();
    expect(adapter.writes).toHaveLength(1);
    expect(JSON.parse(adapter.peek()!).name).toBe("Recovered");
    expect(store.getStatus().suspended).toBe(false);
  });

  it("resumeSaving() before a board is loaded still must not destroy the damaged bytes", async () => {
    // The nastiest path in the file. After a corrupt load the store's document is
    // the *frozen empty doc* (id: ""). If `resumeSaving()` is called before a real
    // board is installed — a stray click on "discard", a dialog wired in the wrong
    // order — the naive behaviour is to autosave that empty document straight over
    // the user's damaged-but-recoverable bytes. It would then fail to load next
    // session too (`id: ""` is not a valid id), so the user loses the original AND
    // gets the same error. Lifting the suspension must not, on its own, write.
    const damaged = "{ not a board";
    const adapter = new MemoryAdapter({ initial: damaged });
    const store = createBoardStore({ adapter, debounceMs: 1 });
    await store.hydrate();
    expect(store.getStatus().suspended).toBe(true);

    store.resumeSaving();
    await store.flush();

    expect(store.getStatus().suspended).toBe(false);
    expect(adapter.writes).toHaveLength(0);
    expect(adapter.peek()).toBe(damaged); // the user can still export/recover this

    // A real document, installed by an explicit user act, does overwrite it.
    store.replaceDoc(createEmptyDoc("Fresh"));
    await store.flush();
    expect(JSON.parse(adapter.peek()!).name).toBe("Fresh");
  });
});

describe("prerender safety", () => {
  it("getServerSnapshot() is a stable frozen document that never touches window", () => {
    // `output: 'export'` still prerenders. React re-invokes getServerSnapshot and
    // infinite-loops if the identity changes between calls.
    const store = createBoardStore();
    expect(store.getServerSnapshot()).toBe(EMPTY_BOARD_DOC);
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(Object.isFrozen(store.getServerSnapshot())).toBe(true);
    expect(store.getServerSnapshot().id).toBe("");
  });

  it("mutating before a board is loaded throws instead of persisting an id-less board", () => {
    const store = createBoardStore({ adapter: new MemoryAdapter() });
    expect(() => store.addItem({ title: "a", category: "task" })).toThrow(
      /before a board was loaded/,
    );
  });

  it("a document mutated before an adapter existed still reaches storage once one is attached", async () => {
    // First run: "Start empty" happens before the localStorage adapter is wired
    // up in a useEffect. Those edits must not evaporate.
    const store = createBoardStore({ debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("First run"));
    store.addItem({ title: "typed before the adapter existed", category: "task" });
    expect(store.getStatus().adapterId).toBeNull();

    const adapter = new MemoryAdapter();
    store.attachAdapter(adapter);
    await store.flush();

    expect(store.getStatus().adapterId).toBe("memory");
    expect(JSON.parse(adapter.peek()!).items[0].title).toBe(
      "typed before the adapter existed",
    );
  });
});
