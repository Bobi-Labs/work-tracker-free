/**
 * Notes and questions — the two embedded arrays.
 *
 * These were `tracker_notes` and `deliverable_questions`: separate tables with
 * foreign keys, which the database kept consistent. Now they are plain arrays
 * nested inside their parent, and *nothing* keeps them consistent except this
 * code. Two things can go wrong that a typecheck will never see: a child written
 * onto the wrong parent, and a child that survives in memory but does not
 * survive the JSON boundary. Both are tested here — every CRUD case asserts the
 * result AFTER a full export → import cycle, not just in memory.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryAdapter } from "../lib/store/adapters/memory";
import { createBoardStore } from "../lib/store/store";
import type { BoardDoc } from "../lib/types";
import { rig, tick } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

/** Push the store's document through JSON + validation and read it back. */
function roundTrip(json: string): BoardDoc {
  const other = createBoardStore({ adapter: new MemoryAdapter() });
  return other.importJson(json);
}

describe("notes", () => {
  it("add → update → delete, round-tripping through the embedded array each time", () => {
    const { store } = rig();
    const item = store.addItem({ title: "card", category: "task" });

    const note = store.addNote(item.id, "first note");
    expect(note.id).not.toBe("");
    expect(note.createdAt).not.toBe("");

    let doc = roundTrip(store.exportJson());
    expect(doc.items[0]!.notes).toHaveLength(1);
    expect(doc.items[0]!.notes[0]).toEqual(note);

    tick();
    store.updateNote(item.id, note.id, "edited note");
    doc = roundTrip(store.exportJson());
    expect(doc.items[0]!.notes[0]!.content).toBe("edited note");
    expect(doc.items[0]!.notes[0]!.id).toBe(note.id);
    // createdAt is immutable — it is when the comment was written, not when it was fixed
    expect(doc.items[0]!.notes[0]!.createdAt).toBe(note.createdAt);

    tick();
    store.deleteNote(item.id, note.id);
    doc = roundTrip(store.exportJson());
    expect(doc.items[0]!.notes).toEqual([]);
  });

  it("keeps notes in insertion order and attached to the right card", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "task" });

    store.addNote(a.id, "a1");
    store.addNote(b.id, "b1");
    store.addNote(a.id, "a2");

    const doc = roundTrip(store.exportJson());
    const items = new Map(doc.items.map((i) => [i.id, i]));
    expect(items.get(a.id)!.notes.map((n) => n.content)).toEqual(["a1", "a2"]);
    expect(items.get(b.id)!.notes.map((n) => n.content)).toEqual(["b1"]);
  });

  it("deleting a card takes its notes with it (no orphans, since there is no FK)", () => {
    const { store } = rig();
    const item = store.addItem({ title: "doomed", category: "task" });
    store.addNote(item.id, "goes with it");

    store.deleteItem(item.id);
    const doc = roundTrip(store.exportJson());
    expect(doc.items).toEqual([]);
    expect(JSON.stringify(doc)).not.toContain("goes with it");
  });

  it("refuses loudly to attach a note to a card that does not exist", () => {
    const { store } = rig();
    expect(() => store.addNote("no-such-item", "orphan")).toThrow(/no item/);
    expect(store.getSnapshot().items).toEqual([]);
  });
});

describe("questions", () => {
  it("add → answer → clear → delete, round-tripping each time", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });

    const q = store.addQuestion(d.id, { questionMd: "Which bank feed?" });
    expect(q.status).toBe("open"); // DEFAULT 'open'
    expect(q.answeredAt).toBeNull();
    expect(q.sortOrder).toBe(0);

    let doc = roundTrip(store.exportJson());
    expect(doc.deliverables[0]!.questions[0]).toEqual(q);

    // Answer set → status flips to `answered` and the stamp lands. This coupling
    // is what the Questions tab's open-count badge is computed from.
    tick();
    store.updateQuestion(d.id, q.id, { answerMd: "The one from the CSV." });
    doc = roundTrip(store.exportJson());
    let stored = doc.deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("answered");
    expect(stored.answeredAt).toBe(stored.updatedAt); // stamped by the commit that answered it
    expect(stored.answeredAt! > q.createdAt).toBe(true);

    // Answer cleared → reverts to open, stamp cleared. An empty string is not an
    // answer; a question with `answerMd: ""` showing as answered is a silent lie.
    tick();
    store.updateQuestion(d.id, q.id, { answerMd: "" });
    stored = roundTrip(store.exportJson()).deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("open");
    expect(stored.answeredAt).toBeNull();

    tick();
    store.deleteQuestion(d.id, q.id);
    expect(roundTrip(store.exportJson()).deliverables[0]!.questions).toEqual([]);
  });

  it("whitespace is not an answer", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });
    const q = store.addQuestion(d.id, { questionMd: "?" });

    store.updateQuestion(d.id, q.id, { answerMd: "   \n  " });
    const stored = roundTrip(store.exportJson()).deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("open");
    expect(stored.answeredAt).toBeNull();
  });

  it("an explicit status wins over the answer derivation (that is how Dismiss works)", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });
    const q = store.addQuestion(d.id, { questionMd: "?" });

    store.updateQuestion(d.id, q.id, { answerMd: "n/a", status: "dismissed" });
    const stored = roundTrip(store.exportJson()).deliverables[0]!.questions[0]!;
    expect(stored.status).toBe("dismissed");
    expect(stored.answeredAt).not.toBeNull();
  });

  it("does not re-stamp answeredAt when an existing answer is merely edited", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });
    const q = store.addQuestion(d.id, { questionMd: "?" });

    store.updateQuestion(d.id, q.id, { answerMd: "v1" });
    const first = store.getSnapshot().deliverables[0]!.questions[0]!.answeredAt;

    tick(60_000);
    store.updateQuestion(d.id, q.id, { answerMd: "v2, a typo fix" });
    const stored = store.getSnapshot().deliverables[0]!.questions[0]!;
    expect(stored.answerMd).toBe("v2, a typo fix");
    expect(stored.answeredAt).toBe(first); // when it was answered, not when it was retyped
  });

  it("keeps questions attached to the right deliverable", () => {
    const { store } = rig();
    const a = store.addDeliverable({ title: "A" });
    const b = store.addDeliverable({ title: "B" });

    store.addQuestion(a.id, { questionMd: "a1" });
    store.addQuestion(b.id, { questionMd: "b1" });
    store.addQuestion(a.id, { questionMd: "a2" });

    const doc = roundTrip(store.exportJson());
    const byId = new Map(doc.deliverables.map((d) => [d.id, d]));
    expect(byId.get(a.id)!.questions.map((q) => q.questionMd)).toEqual(["a1", "a2"]);
    expect(byId.get(b.id)!.questions.map((q) => q.questionMd)).toEqual(["b1"]);
  });

  it("reorders questions as index * 10 within their deliverable", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });
    const q1 = store.addQuestion(d.id, { questionMd: "one" });
    const q2 = store.addQuestion(d.id, { questionMd: "two" });
    const q3 = store.addQuestion(d.id, { questionMd: "three" });

    store.reorderQuestions(d.id, [q3.id, q1.id, q2.id]);

    const questions = roundTrip(store.exportJson()).deliverables[0]!.questions;
    const order = new Map(questions.map((q) => [q.id, q.sortOrder]));
    expect(order.get(q3.id)).toBe(0);
    expect(order.get(q1.id)).toBe(10);
    expect(order.get(q2.id)).toBe(20);
  });

  it("deleting a deliverable takes its questions with it", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });
    store.addQuestion(d.id, { questionMd: "goes with it" });

    store.deleteDeliverable(d.id);
    const doc = roundTrip(store.exportJson());
    expect(doc.deliverables).toEqual([]);
    expect(JSON.stringify(doc)).not.toContain("goes with it");
  });

  it("refuses loudly to attach a question to a deliverable that does not exist", () => {
    const { store } = rig();
    expect(() => store.addQuestion("no-such-deliverable", { questionMd: "?" })).toThrow(
      /no deliverable/,
    );
    expect(store.getSnapshot().deliverables).toEqual([]);
  });
});

describe("deliverables", () => {
  it("applies the defaults the database used to supply", () => {
    const { store } = rig();
    const d = store.addDeliverable({ title: "D" });

    expect(d.tab).toBe("backlog");
    expect(d.status).toBe("pending");
    expect(d.sortOrder).toBe(0);
    expect(d.questions).toEqual([]);
    expect(d.scopeMd).toBeNull();
    expect(d.itemNumber).toBeNull();
  });

  it("moves a deliverable between tabs and renumbers the destination as index * 10", () => {
    const { store } = rig();
    const a = store.addDeliverable({ title: "a", tab: "backlog" });
    const b = store.addDeliverable({ title: "b", tab: "ongoing" });

    store.reorderDeliverables("ongoing", [b.id, a.id]);

    const doc = roundTrip(store.exportJson());
    const byId = new Map(doc.deliverables.map((d) => [d.id, d]));
    expect(byId.get(a.id)!.tab).toBe("ongoing");
    expect(byId.get(a.id)!.sortOrder).toBe(10);
    expect(byId.get(b.id)!.sortOrder).toBe(0);
  });
});
