/**
 * Export → import, and the four ways an import must refuse.
 *
 * This is the boundary where the app meets bytes it did not write: a file the
 * user picked, or localStorage they (or an older build) edited. There is no
 * database left to reject a bad row, so a document that gets past this file is
 * trusted everywhere downstream. Each rejection test asserts **two** things:
 * that the import threw, and that the current board and the persisted bytes are
 * bit-for-bit what they were before the attempt. A validator that throws *after*
 * clobbering the board is worse than no validator.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { CorruptDocError, migrate } from "../lib/schema";
import { createSampleBoard } from "../lib/seed/sample-board";
import { MemoryAdapter } from "../lib/store/adapters/memory";
import { createEmptyDoc } from "../lib/store/board-doc";
import { createBoardStore } from "../lib/store/store";
import { DOC_KIND, INDEX_KIND, SCHEMA_VERSION } from "../lib/types";
import { contentOf, rig, tick } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("export → import round-trip fidelity", () => {
  it("a hand-built board survives exportJson → importJson unchanged", () => {
    const { store } = rig();

    const item = store.addItem({
      title: "Ünïcödé, emoji 🐛, and a \"quoted\" \\ backslash",
      category: "bug",
      priority: "high",
      status: "done",
      description: "line one\nline two\n\n- bullet",
      assignedTo: "someone",
      dueDate: "2026-12-31",
      sortOrder: 30,
    });
    store.addNote(item.id, "a note with **markdown**");
    store.addItem({ title: "plain", category: "task" }); // every nullable left null

    const d = store.addDeliverable({
      title: "Deliverable",
      tab: "ongoing",
      itemNumber: "07",
      subtitle: "sub",
      scopeMd: "# Scope\n\n```ts\nconst x = 1;\n```",
      guideMd: null,
      buildNotesMd: "notes",
      status: "active",
      sortOrder: 10,
    });
    store.addQuestion(d.id, { questionMd: "why?", answerMd: "because", category: "scope" });
    store.addQuestion(d.id, { questionMd: "unanswered?" });
    store.updateSettings({ clientName: "Acme", phase: "Phase 2", accent: null });

    const source = store.getSnapshot();
    const json = store.exportJson();

    // Imported into a *fresh, unloaded* store, so the document keeps its own id
    // — this is the true fidelity check, with nothing rebound by the destination.
    const other = createBoardStore({ adapter: new MemoryAdapter() });
    const imported = other.importJson(json);

    expect(imported.id).toBe(source.id);
    expect(contentOf(imported)).toEqual(contentOf(source));
    // The one field that is *supposed* to move: the import is itself an edit.
    expect(imported.updatedAt >= source.updatedAt).toBe(true);
  });

  it("the sample board survives a full serialize → validate → serialize cycle byte-identically", () => {
    const doc = createSampleBoard();

    const once = JSON.stringify(doc, null, 2);
    const parsed = migrate(JSON.parse(once));
    const twice = JSON.stringify(parsed, null, 2);

    expect(parsed).toEqual(doc);
    expect(twice).toBe(once);
  });

  it("preserves nulls, empty arrays and numeric sortOrder rather than coercing them", () => {
    const { store } = rig();
    const item = store.addItem({ title: "bare", category: "task", sortOrder: 0 });

    const other = createBoardStore({ adapter: new MemoryAdapter() });
    const imported = other.importJson(store.exportJson());
    const round = imported.items.find((i) => i.id === item.id)!;

    expect(round.description).toBeNull();
    expect(round.assignedTo).toBeNull();
    expect(round.dueDate).toBeNull();
    expect(round.completedAt).toBeNull();
    expect(round.notes).toEqual([]);
    expect(round.sortOrder).toBe(0);
    expect(imported.deliverables).toEqual([]);
  });

  it("an imported board is bound to the DESTINATION board's id, not the file's", () => {
    // The store writes to a storage key derived from the board id. Adopting a
    // foreign id would write board A's bytes into board B's slot.
    const { store } = rig();
    const destinationId = store.getSnapshot().id;

    const foreign = createEmptyDoc("From a file");
    foreign.items.push({ ...createSampleBoard().items[0]! });

    const imported = store.importJson(JSON.stringify(foreign));
    expect(imported.id).toBe(destinationId);
    expect(imported.id).not.toBe(foreign.id);
    expect(imported.name).toBe("From a file");
    expect(imported.items).toHaveLength(1);
  });
});

describe("importJson rejects and writes NOTHING", () => {
  /** Runs an import that must fail, and proves nothing moved. */
  async function mustReject(json: string, reason: CorruptDocError["reason"]) {
    const { store, adapter } = rig({ debounceMs: 1 });
    store.addItem({ title: "keep me", category: "task" });
    await store.flush();

    const docBefore = store.getSnapshot();
    const bytesBefore = adapter.peek();
    const writesBefore = adapter.writes.length;

    let thrown: unknown;
    try {
      store.importJson(json);
    } catch (e) {
      thrown = e;
    }

    expect(thrown, "the import should have thrown").toBeInstanceOf(CorruptDocError);
    expect((thrown as CorruptDocError).reason).toBe(reason);

    // The board is untouched — same object identity, so not even a no-op commit.
    expect(store.getSnapshot()).toBe(docBefore);
    expect(store.getSnapshot().items[0]!.title).toBe("keep me");

    // And nothing reached storage: no write was scheduled, and a flush finds
    // nothing dirty to write.
    await store.flush();
    expect(adapter.writes).toHaveLength(writesBefore);
    expect(adapter.peek()).toBe(bytesBefore);
  }

  it("rejects a foreign `kind` (someone's Trello export)", async () => {
    await mustReject(
      JSON.stringify({ kind: "trello.board", schemaVersion: 1, cards: [] }),
      "wrong-kind",
    );
  });

  it("rejects the workspace index fed to the board parser", async () => {
    await mustReject(
      JSON.stringify({
        kind: INDEX_KIND,
        schemaVersion: SCHEMA_VERSION,
        activeBoardId: null,
        boards: [],
      }),
      "wrong-kind",
    );
  });

  it("rejects a bad enum value on an otherwise perfect document", async () => {
    const doc = createSampleBoard();
    expect(doc.items.length, "vacuous fixture").toBeGreaterThan(0);

    const bad = {
      ...doc,
      items: doc.items.map((i, n) => (n === 0 ? { ...i, status: "cancelled" } : i)),
    };
    await mustReject(JSON.stringify(bad), "invalid-shape");
  });

  it("rejects a bad enum value nested two levels down (deliverable → question)", async () => {
    const doc = createSampleBoard();

    // Tamper with a deliverable that ACTUALLY HAS questions. The obvious version
    // of this test (`deliverables[0]`) mutates nothing — that deliverable has no
    // questions — so it imports a perfectly valid document and passes whether or
    // not the nested enum is checked at all.
    const target = doc.deliverables.find((d) => d.questions.length > 0);
    expect(target, "vacuous fixture: no deliverable has questions").toBeDefined();

    const bad = {
      ...doc,
      deliverables: doc.deliverables.map((d) =>
        d.id === target!.id
          ? { ...d, questions: d.questions.map((q) => ({ ...q, status: "deferred" })) }
          : d,
      ),
    };
    await mustReject(JSON.stringify(bad), "invalid-shape");
  });

  it("rejects the virtual `questions` tab on a stored deliverable", async () => {
    // `questions` exists in the tab union (the tab bar is typed against it) but
    // is computed, never stored. A document claiming it is not one of ours.
    const doc = createSampleBoard();
    const bad = {
      ...doc,
      deliverables: doc.deliverables.map((d, n) =>
        n === 0 ? { ...d, tab: "questions" } : d,
      ),
    };
    await mustReject(JSON.stringify(bad), "invalid-shape");
  });

  it("rejects a missing required field", async () => {
    const doc = createSampleBoard();
    const first = doc.items[0]!;
    const { category: _dropped, ...withoutCategory } = first;
    const bad = { ...doc, items: [withoutCategory, ...doc.items.slice(1)] };
    await mustReject(JSON.stringify(bad), "invalid-shape");
  });

  it("rejects malformed JSON as a typed CorruptDocError, not a raw SyntaxError", async () => {
    await mustReject("{{{ not json at all", "not-an-object");
    await mustReject("", "not-an-object");
    await mustReject(" binary junk", "not-an-object");
  });

  it("rejects valid JSON that is not an object (an array, a string, null)", async () => {
    await mustReject("[]", "not-an-object");
    await mustReject('"a string"', "not-an-object");
    await mustReject("null", "not-an-object");
    await mustReject("42", "not-an-object");
  });

  it("rejects a document with no header at all", async () => {
    await mustReject(JSON.stringify({ items: [], deliverables: [] }), "wrong-kind");
  });

  it("leaves a corrupt import's error machine-readable, not a string to match on", () => {
    const { store } = rig();
    try {
      store.importJson(JSON.stringify({ ...createEmptyDoc(), schemaVersion: 99 }));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CorruptDocError);
      const err = e as CorruptDocError;
      expect(err.reason).toBe("unknown-version");
      expect(err.name).toBe("CorruptDocError");
      expect(Array.isArray(err.issues)).toBe(true);
    }
  });
});

describe("migrate() and schemaVersion", () => {
  it("accepts a current-version document and stamps it with SCHEMA_VERSION", () => {
    const doc = createEmptyDoc("Current");
    const out = migrate(JSON.parse(JSON.stringify(doc)));
    expect(out.schemaVersion).toBe(SCHEMA_VERSION);
    expect(out.kind).toBe(DOC_KIND);
  });

  it("REFUSES a document from a newer build rather than silently downgrading it", () => {
    // The dangerous case: a v2 doc opened by a v1 build. If we parsed it and
    // saved it back, every v2-only field would be dropped on write — the user
    // loses data by opening a file. So: refuse, and tell them to update.
    const future = { ...createEmptyDoc("From the future"), schemaVersion: SCHEMA_VERSION + 1 };
    let thrown: unknown;
    try {
      migrate(JSON.parse(JSON.stringify(future)));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CorruptDocError);
    expect((thrown as CorruptDocError).reason).toBe("unknown-version");
    expect((thrown as CorruptDocError).message).toMatch(/newer version/i);
  });

  it("refuses a nonsense schemaVersion (0, negative, fractional, absent, non-numeric)", () => {
    const base = createEmptyDoc("Weird");
    for (const schemaVersion of [0, -1, 1.5, "1", null, undefined]) {
      const raw = JSON.parse(JSON.stringify({ ...base, schemaVersion }));
      expect(() => migrate(raw), `schemaVersion=${String(schemaVersion)}`).toThrow(
        CorruptDocError,
      );
    }
  });

  it("hydrate() surfaces a corrupt/unknown-version document instead of overwriting it", async () => {
    // The migration path the user actually meets: bytes already on disk.
    const future = JSON.stringify({
      ...createEmptyDoc("Newer"),
      schemaVersion: SCHEMA_VERSION + 1,
    });
    const adapter = new MemoryAdapter({ initial: future });
    const store = createBoardStore({ adapter, debounceMs: 1 });

    const result = await store.hydrate();
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") throw new Error("unreachable");
    expect(result.error.reason).toBe("unknown-version");
    // `raw` is handed back so the UI can offer download-before-discard.
    expect(result.raw).toBe(future);

    // Autosave is suspended: we do not write over bytes we could not read.
    expect(store.getStatus().suspended).toBe(true);
    tick();
    await store.flush();
    expect(adapter.writes).toHaveLength(0);
    expect(adapter.peek()).toBe(future);
  });
});
