import { describe, expect, it, vi } from "vitest";

import { CorruptDocError } from "../schema";
import { DOC_KIND, boardStorageKey } from "../types";
import { MemoryAdapter } from "./adapters/memory";
import { StoreError, type StorageAdapter } from "./adapters/types";
import { EMPTY_BOARD_DOC, createEmptyDoc } from "./board-doc";
import { createBoardStore } from "./store";
import { createWorkspace, memoryKV } from "./workspace";

function freshStore(adapter = new MemoryAdapter(), debounceMs = 400) {
  const store = createBoardStore({ adapter, debounceMs });
  store.replaceDoc(createEmptyDoc("Test"));
  return { store, adapter };
}

describe("completedAt derivation", () => {
  it("stamps on transition to done, nulls on any other status", () => {
    const { store } = freshStore();
    const item = store.addItem({ title: "a", category: "task" });
    expect(item.completedAt).toBeNull();

    store.updateItem(item.id, { status: "done" });
    const done = store.getSnapshot().items[0]!;
    expect(done.completedAt).not.toBeNull();

    store.updateItem(item.id, { status: "in_progress" });
    expect(store.getSnapshot().items[0]!.completedAt).toBeNull();

    store.updateItem(item.id, { status: "blocked" });
    expect(store.getSnapshot().items[0]!.completedAt).toBeNull();
  });

  // NOTE: these two MUST advance the clock between writes. Without it, a
  // re-stamp and a preserved stamp are the same ISO string (same millisecond)
  // and the assertion passes no matter what the code does.
  it("does NOT touch completedAt when status is absent from the patch", () => {
    const { store } = freshStore();
    const item = store.addItem({ title: "a", category: "task", status: "done" });
    const stamp = store.getSnapshot().items[0]!.completedAt;
    expect(stamp).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + 60_000));
    store.updateItem(item.id, { title: "renamed" });
    expect(store.getSnapshot().items[0]!.completedAt).toBe(stamp);
    vi.useRealTimers();
  });

  it("preserves the original stamp when an already-done item is re-set to done", () => {
    const { store } = freshStore();
    const item = store.addItem({ title: "a", category: "task" });
    store.updateItem(item.id, { status: "done" });
    const stamp = store.getSnapshot().items[0]!.completedAt!;

    vi.setSystemTime(new Date(Date.now() + 60_000));
    store.updateItem(item.id, { status: "done" });
    expect(store.getSnapshot().items[0]!.completedAt).toBe(stamp);

    // and the same via a drag within the Done column
    vi.setSystemTime(new Date(Date.now() + 60_000));
    store.reorderItems("done", [item.id]);
    expect(store.getSnapshot().items[0]!.completedAt).toBe(stamp);
    vi.useRealTimers();
  });

  it("heals a stale stamp on a non-done item (imported / hand-edited data)", () => {
    const { store } = freshStore();
    const doc = createEmptyDoc("Imported");
    const item = {
      id: "i1",
      title: "a",
      description: null,
      category: "task",
      priority: "medium",
      // the invariant violated: pending, but carrying a completion stamp
      status: "pending",
      assignedTo: null,
      dueDate: null,
      completedAt: "2020-01-01T00:00:00.000Z",
      sortOrder: 0,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      notes: [],
    };
    store.importJson(JSON.stringify({ ...doc, items: [item] }));
    expect(store.getSnapshot().items[0]!.completedAt).toBe("2020-01-01T00:00:00.000Z");

    store.updateItem("i1", { title: "renamed" });
    expect(store.getSnapshot().items[0]!.completedAt).toBeNull();
  });

  it("bulkUpdateStatus stamps and clears identically", () => {
    const { store } = freshStore();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "bug" });

    store.bulkUpdateStatus([a.id, b.id], "done");
    for (const i of store.getSnapshot().items) expect(i.completedAt).not.toBeNull();

    store.bulkUpdateStatus([a.id, b.id], "pending");
    for (const i of store.getSnapshot().items) expect(i.completedAt).toBeNull();
  });
});

describe("reorderItems", () => {
  it("rewrites sortOrder as index * 10 and moves items into the destination column", () => {
    const { store } = freshStore();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "task", status: "in_progress" });
    const c = store.addItem({ title: "c", category: "task" });

    store.reorderItems("in_progress", [c.id, b.id, a.id]);
    const byId = new Map(store.getSnapshot().items.map((i) => [i.id, i]));

    expect(byId.get(c.id)!.sortOrder).toBe(0);
    expect(byId.get(b.id)!.sortOrder).toBe(10);
    expect(byId.get(a.id)!.sortOrder).toBe(20);
    for (const id of [a.id, b.id, c.id]) {
      expect(byId.get(id)!.status).toBe("in_progress");
    }
  });
});

describe("updatedAt", () => {
  it("every effective mutation bumps BOTH the entity and the document", () => {
    const { store } = freshStore();
    const item = store.addItem({ title: "a", category: "task" });
    const before = store.getSnapshot().updatedAt;

    vi.setSystemTime(new Date(Date.now() + 5000));
    store.updateItem(item.id, { title: "b" });
    const doc = store.getSnapshot();

    expect(doc.updatedAt > before).toBe(true);
    expect(doc.items[0]!.updatedAt).toBe(doc.updatedAt);
    vi.useRealTimers();
  });

  it("a no-op mutation does NOT bump updatedAt", () => {
    const { store } = freshStore();
    store.renameBoard("Same");
    const before = store.getSnapshot().updatedAt;

    store.renameBoard("Same");
    store.deleteItem("does-not-exist");
    store.updateItem("does-not-exist", { title: "x" });

    expect(store.getSnapshot().updatedAt).toBe(before);
  });

  it("a note mutation bumps the item AND the document", () => {
    const { store } = freshStore();
    const item = store.addItem({ title: "a", category: "task" });
    vi.setSystemTime(new Date(Date.now() + 5000));

    const note = store.addNote(item.id, "hello");
    const doc = store.getSnapshot();
    expect(doc.items[0]!.notes).toHaveLength(1);
    expect(doc.items[0]!.updatedAt).toBe(doc.updatedAt);

    store.deleteNote(item.id, note.id);
    expect(store.getSnapshot().items[0]!.notes).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("questions", () => {
  it("answer set → answered + stamped; cleared → reverts to open", () => {
    const { store } = freshStore();
    const d = store.addDeliverable({ title: "D" });
    const q = store.addQuestion(d.id, { questionMd: "why?" });
    expect(q.status).toBe("open");
    expect(q.answeredAt).toBeNull();

    store.updateQuestion(d.id, q.id, { answerMd: "because" });
    let stored = store.getSnapshot().deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("answered");
    expect(stored.answeredAt).not.toBeNull();

    store.updateQuestion(d.id, q.id, { answerMd: "" });
    stored = store.getSnapshot().deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("open");
    expect(stored.answeredAt).toBeNull();
  });

  it("an explicit status wins over the answer derivation (dismiss)", () => {
    const { store } = freshStore();
    const d = store.addDeliverable({ title: "D" });
    const q = store.addQuestion(d.id, { questionMd: "why?" });

    store.updateQuestion(d.id, q.id, { answerMd: "n/a", status: "dismissed" });
    const stored = store.getSnapshot().deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("dismissed");
    expect(stored.answeredAt).not.toBeNull();
  });
});

describe("persistence", () => {
  it("debounces, then writes once", async () => {
    vi.useFakeTimers();
    const adapter = new MemoryAdapter();
    const store = createBoardStore({ adapter, debounceMs: 400 });
    store.replaceDoc(createEmptyDoc("Test"));

    store.addItem({ title: "a", category: "task" });
    store.addItem({ title: "b", category: "task" });
    expect(adapter.writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(adapter.writes).toHaveLength(1);
    expect(JSON.parse(adapter.peek()!).items).toHaveLength(2);
    vi.useRealTimers();
  });

  it("flush() writes immediately", async () => {
    const { store, adapter } = freshStore();
    store.addItem({ title: "a", category: "task" });
    await store.flush();
    expect(adapter.writes).toHaveLength(1);
  });

  it("surfaces a save failure in getStatus().error and keeps the change dirty for retry", async () => {
    let fail = true;
    const flaky: StorageAdapter = {
      id: "flaky",
      label: "Flaky",
      isAvailable: async () => true,
      load: async () => null,
      save: async () => {
        if (fail) throw new StoreError("quota", "full");
        saved = true;
      },
      clear: async () => {},
    };
    let saved = false;

    const store = createBoardStore({ adapter: flaky, debounceMs: 1 });
    store.replaceDoc(createEmptyDoc("Test"));
    store.addItem({ title: "a", category: "task" });

    await store.flush();
    const status = store.getStatus();
    expect(status.state).toBe("error");
    expect(status.error).toBeInstanceOf(StoreError);
    expect((status.error as StoreError).kind).toBe("quota");
    expect(status.pending).toBe(true);

    fail = false;
    await store.flush();
    expect(saved).toBe(true);
    expect(store.getStatus().state).toBe("saved");
    expect(store.getStatus().error).toBeNull();
  });

  it("hydrate() loads a persisted doc; a corrupt doc suspends autosave instead of overwriting it", async () => {
    const doc = createEmptyDoc("Persisted");
    const adapter = new MemoryAdapter({ initial: JSON.stringify(doc) });
    const store = createBoardStore({ adapter });

    const result = await store.hydrate();
    expect(result.status).toBe("loaded");
    expect(store.getSnapshot().name).toBe("Persisted");

    const corrupt = new MemoryAdapter({ initial: '{"kind":"trello.board"}' });
    const store2 = createBoardStore({ adapter: corrupt, debounceMs: 1 });
    const result2 = await store2.hydrate();
    expect(result2.status).toBe("corrupt");
    expect(store2.getStatus().suspended).toBe(true);

    // the damaged bytes must survive: no write may happen while suspended
    store2.replaceDoc(createEmptyDoc("Recovered"));
    await store2.flush();
    expect(JSON.parse(corrupt.peek()!).name).toBe("Recovered"); // only after an explicit replaceDoc
    expect(corrupt.writes).toHaveLength(1);
  });

  it("hydrate() on empty storage reports empty and writes nothing", async () => {
    const adapter = new MemoryAdapter();
    const store = createBoardStore({ adapter });
    expect((await store.hydrate()).status).toBe("empty");
    expect(adapter.writes).toHaveLength(0);
  });
});

describe("export / import", () => {
  it("round-trips with full fidelity", () => {
    const { store } = freshStore();
    const item = store.addItem({
      title: "a",
      category: "bug",
      priority: "high",
      status: "done",
    });
    store.addNote(item.id, "note");
    const d = store.addDeliverable({ title: "D", scopeMd: "# scope" });
    store.addQuestion(d.id, { questionMd: "q?" });

    const json = store.exportJson();
    const { store: other } = freshStore();
    other.importJson(json);

    // everything but the board id, which stays bound to the destination slot
    const source = store.getSnapshot();
    const imported = other.getSnapshot();
    expect(imported.items).toEqual(source.items);
    expect(imported.deliverables).toEqual(source.deliverables);
    expect(imported.settings).toEqual(source.settings);
    expect(imported.name).toBe(source.name);
  });

  it("rejects a foreign kind and writes NOTHING", async () => {
    const { store, adapter } = freshStore();
    store.addItem({ title: "keep me", category: "task" });
    await store.flush();
    const writesBefore = adapter.writes.length;

    expect(() => store.importJson('{"kind":"trello.board","schemaVersion":1}')).toThrow(
      CorruptDocError,
    );
    expect(() => store.importJson("not json at all")).toThrow(CorruptDocError);
    expect(() =>
      store.importJson(
        JSON.stringify({ ...createEmptyDoc(), schemaVersion: 99, kind: DOC_KIND }),
      ),
    ).toThrow(CorruptDocError);

    // a bad enum on an otherwise valid doc
    const bad = createEmptyDoc();
    const badJson = JSON.stringify({
      ...bad,
      items: [{ ...store.getSnapshot().items[0], status: "cancelled" }],
    });
    expect(() => store.importJson(badJson)).toThrow(CorruptDocError);

    // the board is untouched and nothing new was persisted
    expect(store.getSnapshot().items[0]!.title).toBe("keep me");
    await store.flush();
    expect(adapter.writes).toHaveLength(writesBefore);
  });
});

describe("prerender safety", () => {
  it("getServerSnapshot is the frozen empty doc, stable across calls", () => {
    const store = createBoardStore();
    expect(store.getServerSnapshot()).toBe(EMPTY_BOARD_DOC);
    expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    expect(Object.isFrozen(store.getServerSnapshot())).toBe(true);
    expect(store.getServerSnapshot().id).toBe("");
  });

  it("mutating before hydrate throws loudly rather than persisting an id-less board", () => {
    const store = createBoardStore({ adapter: new MemoryAdapter() });
    expect(() => store.addItem({ title: "a", category: "task" })).toThrow(
      /before a board was loaded/,
    );
  });
});

describe("workspace", () => {
  it("creates unlimited boards, lists newest first, and deletes both doc and entry", () => {
    const kv = memoryKV();
    const ws = createWorkspace(kv);
    ws.hydrate();

    const docs = Array.from({ length: 25 }, (_, i) => ws.createBoard(`Board ${i}`));
    expect(ws.list()).toHaveLength(25); // no cap
    expect(ws.activeBoardId()).toBe(docs[24]!.id);

    const victim = docs[0]!;
    ws.deleteBoard(victim.id);
    expect(ws.list()).toHaveLength(24);
    expect(kv.getItem(boardStorageKey(victim.id))).toBeNull();
    expect(ws.readBoard(victim.id)).toBeNull();
  });

  it("rebuilds a missing index by scanning wt.board.* keys", () => {
    const doc = createEmptyDoc("Orphan");
    const kv = memoryKV({ [boardStorageKey(doc.id)]: JSON.stringify(doc) });

    const ws = createWorkspace(kv);
    const index = ws.hydrate();
    expect(index.boards).toHaveLength(1);
    expect(index.boards[0]!.name).toBe("Orphan");
    expect(index.activeBoardId).toBe(doc.id);
    expect(kv.getItem("wt.index")).not.toBeNull();
  });

  it("rebuilds a CORRUPT index without deleting any board", () => {
    const doc = createEmptyDoc("Survivor");
    const kv = memoryKV({
      "wt.index": "{{{ not json",
      [boardStorageKey(doc.id)]: JSON.stringify(doc),
    });

    const ws = createWorkspace(kv);
    expect(ws.hydrate().boards).toHaveLength(1);
    expect(ws.readBoard(doc.id)!.name).toBe("Survivor");
  });

  it("drops index entries whose board document is gone", () => {
    const doc = createEmptyDoc("Ghost");
    const kv = memoryKV({
      "wt.index": JSON.stringify({
        kind: "worktracker.index",
        schemaVersion: 1,
        activeBoardId: doc.id,
        boards: [{ id: doc.id, name: "Ghost", updatedAt: doc.updatedAt }],
      }),
    });

    const ws = createWorkspace(kv);
    const index = ws.hydrate();
    expect(index.boards).toHaveLength(0);
    expect(index.activeBoardId).toBeNull();
  });

  it("syncFromDoc mirrors a renamed board into the index", () => {
    const kv = memoryKV();
    const ws = createWorkspace(kv);
    ws.hydrate();
    const doc = ws.createBoard("Before");

    ws.syncFromDoc({ ...doc, name: "After", updatedAt: new Date().toISOString() });
    expect(ws.list()[0]!.name).toBe("After");
  });
});
