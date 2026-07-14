/**
 * The two-timestamp rule, enforced across EVERY mutation on the store's surface.
 *
 * Rule: an effective mutation bumps the entity's `updatedAt` **and** the
 * document's. The workspace picker sorts boards on `doc.updatedAt`, so a board
 * that changed and didn't say so sorts as if it hadn't — the user's most recent
 * work quietly falls down the list.
 *
 * Corollary, equally load-bearing: a mutation that changes **nothing** must NOT
 * bump either. Otherwise merely *opening* a board reshuffles the picker.
 *
 * This is table-driven on purpose. The failure mode it exists to catch is not "a
 * bump is wrong" — it's "someone adds a 20th mutation next month and forgets".
 * A new method that isn't in this table is a missing test, and the exhaustiveness
 * check at the bottom makes that a compile error rather than a silent gap.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { BoardStore } from "../lib/store/store";
import type { BoardDoc } from "../lib/types";
import { rig, tick } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Everything on `BoardStore` that is NOT a mutation. Deriving the mutation list
 * by subtraction (rather than listing it) is what makes `CASES` below a
 * *compile-time* exhaustiveness check: add a 20th mutation to the store and this
 * file stops compiling until it has a test.
 */
type NonMutation =
  | "subscribe"
  | "getSnapshot"
  | "getServerSnapshot"
  | "getStatus"
  | "attachAdapter"
  | "hydrate"
  | "replaceDoc"
  | "flush"
  | "resumeSaving"
  | "destroy"
  | "exportJson"
  | "importJson";

type MutationName = Exclude<keyof BoardStore, NonMutation>;

interface Case {
  /** Build whatever the mutation needs. Runs BEFORE the clock is advanced. */
  setup?: (store: BoardStore) => Record<string, string>;
  /** The mutation under test. Runs AFTER the clock is advanced. */
  run: (store: BoardStore, ids: Record<string, string>) => void;
  /** The entity whose own `updatedAt` must also have moved (if any). */
  entity?: (doc: BoardDoc, ids: Record<string, string>) => { updatedAt: string };
}

function seedItem(store: BoardStore) {
  return { item: store.addItem({ title: "seed", category: "task" }).id };
}

function seedDeliverable(store: BoardStore) {
  return { deliverable: store.addDeliverable({ title: "seed" }).id };
}

const item = (doc: BoardDoc, ids: Record<string, string>) =>
  doc.items.find((i) => i.id === ids.item)!;
const deliverable = (doc: BoardDoc, ids: Record<string, string>) =>
  doc.deliverables.find((d) => d.id === ids.deliverable)!;

const CASES: Record<MutationName, Case> = {
  addItem: {
    run: (s) => void s.addItem({ title: "new", category: "task" }),
    entity: (doc) => doc.items[doc.items.length - 1]!,
  },
  updateItem: {
    setup: seedItem,
    run: (s, ids) => s.updateItem(ids.item!, { title: "renamed" }),
    entity: item,
  },
  deleteItem: {
    setup: seedItem,
    run: (s, ids) => s.deleteItem(ids.item!),
  },
  reorderItems: {
    setup: (s) => ({
      a: s.addItem({ title: "a", category: "task", sortOrder: 0 }).id,
      b: s.addItem({ title: "b", category: "task", sortOrder: 10 }).id,
    }),
    run: (s, ids) => s.reorderItems("pending", [ids.b!, ids.a!]),
    entity: (doc, ids) => doc.items.find((i) => i.id === ids.a)!,
  },
  bulkUpdateStatus: {
    setup: seedItem,
    run: (s, ids) => s.bulkUpdateStatus([ids.item!], "in_progress"),
    entity: item,
  },
  clearDone: {
    setup: (s) => ({
      item: s.addItem({ title: "done", category: "task", status: "done" }).id,
    }),
    run: (s) => s.clearDone(),
  },
  addNote: {
    setup: seedItem,
    // A note has no `updatedAt` of its own — its PARENT ITEM is the entity that
    // must move, or a comment added to a card leaves the card looking stale.
    run: (s, ids) => void s.addNote(ids.item!, "hello"),
    entity: item,
  },
  updateNote: {
    setup: (s) => {
      const i = s.addItem({ title: "seed", category: "task" }).id;
      return { item: i, note: s.addNote(i, "before").id };
    },
    run: (s, ids) => s.updateNote(ids.item!, ids.note!, "after"),
    entity: item,
  },
  deleteNote: {
    setup: (s) => {
      const i = s.addItem({ title: "seed", category: "task" }).id;
      return { item: i, note: s.addNote(i, "doomed").id };
    },
    run: (s, ids) => s.deleteNote(ids.item!, ids.note!),
    entity: item,
  },
  addDeliverable: {
    run: (s) => void s.addDeliverable({ title: "new" }),
    entity: (doc) => doc.deliverables[doc.deliverables.length - 1]!,
  },
  updateDeliverable: {
    setup: seedDeliverable,
    run: (s, ids) => s.updateDeliverable(ids.deliverable!, { scopeMd: "# scope" }),
    entity: deliverable,
  },
  deleteDeliverable: {
    setup: seedDeliverable,
    run: (s, ids) => s.deleteDeliverable(ids.deliverable!),
  },
  reorderDeliverables: {
    setup: (s) => ({
      deliverable: s.addDeliverable({ title: "a", sortOrder: 0 }).id,
      other: s.addDeliverable({ title: "b", sortOrder: 10 }).id,
    }),
    run: (s, ids) => s.reorderDeliverables("backlog", [ids.other!, ids.deliverable!]),
    entity: deliverable,
  },
  addQuestion: {
    setup: seedDeliverable,
    run: (s, ids) => void s.addQuestion(ids.deliverable!, { questionMd: "why?" }),
    entity: deliverable,
  },
  updateQuestion: {
    setup: (s) => {
      const d = s.addDeliverable({ title: "seed" }).id;
      return { deliverable: d, question: s.addQuestion(d, { questionMd: "why?" }).id };
    },
    run: (s, ids) =>
      s.updateQuestion(ids.deliverable!, ids.question!, { answerMd: "because" }),
    entity: (doc, ids) =>
      deliverable(doc, ids).questions.find((q) => q.id === ids.question)!,
  },
  deleteQuestion: {
    setup: (s) => {
      const d = s.addDeliverable({ title: "seed" }).id;
      return { deliverable: d, question: s.addQuestion(d, { questionMd: "doomed" }).id };
    },
    run: (s, ids) => s.deleteQuestion(ids.deliverable!, ids.question!),
    entity: deliverable,
  },
  reorderQuestions: {
    setup: (s) => {
      const d = s.addDeliverable({ title: "seed" }).id;
      return {
        deliverable: d,
        a: s.addQuestion(d, { questionMd: "a", sortOrder: 0 }).id,
        b: s.addQuestion(d, { questionMd: "b", sortOrder: 10 }).id,
      };
    },
    run: (s, ids) => s.reorderQuestions(ids.deliverable!, [ids.b!, ids.a!]),
    entity: (doc, ids) =>
      deliverable(doc, ids).questions.find((q) => q.id === ids.a)!,
  },
  renameBoard: {
    run: (s) => s.renameBoard("A New Name"),
  },
  updateSettings: {
    run: (s) => s.updateSettings({ clientName: "Acme" }),
  },
};

describe("every mutation bumps BOTH the entity's updatedAt and the document's", () => {
  const names = Object.keys(CASES) as MutationName[];

  it.each(names)("%s", (name) => {
    const testCase = CASES[name];
    const { store } = rig();

    const ids = testCase.setup?.(store) ?? {};
    const before = store.getSnapshot().updatedAt;

    // Without this the mutation lands in the same millisecond as the setup, and
    // "bumped" is indistinguishable from "didn't".
    tick(5000);
    testCase.run(store, ids);

    const doc = store.getSnapshot();
    expect(doc.updatedAt > before, `${name} did not bump doc.updatedAt`).toBe(true);

    if (testCase.entity) {
      const entity = testCase.entity(doc, ids);
      expect(entity, `${name}: entity not found`).toBeDefined();
      expect(entity.updatedAt, `${name} did not bump the entity`).toBe(doc.updatedAt);
    }
  });
});

describe("a mutation that changes nothing does NOT bump anything", () => {
  it("no-ops leave the document object identical", () => {
    const { store } = rig();
    const seeded = store.addItem({ title: "a", category: "task" });
    store.renameBoard("Stable");
    const before = store.getSnapshot();

    tick(5000);

    store.renameBoard("Stable"); // same name
    store.deleteItem("does-not-exist");
    store.updateItem("does-not-exist", { title: "x" });
    store.deleteNote(seeded.id, "does-not-exist");
    store.updateNote(seeded.id, "does-not-exist", "x");
    store.deleteDeliverable("does-not-exist");
    store.updateDeliverable("does-not-exist", { title: "x" });
    store.deleteQuestion("does-not-exist", "nope");
    store.updateQuestion("does-not-exist", "nope", { answerMd: "x" });
    store.reorderItems("pending", []);
    store.reorderDeliverables("backlog", []);
    store.reorderQuestions("does-not-exist", []);
    store.bulkUpdateStatus([seeded.id], "pending"); // already pending
    store.clearDone(); // nothing done

    // Object identity, not just an equal timestamp: no commit happened at all.
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().updatedAt).toBe(before.updatedAt);
  });

  it("the document timestamp is what the workspace picker sorts on", async () => {
    // Concretely: touch a board, and it must be able to claim the top of the list.
    const { store } = rig({ debounceMs: 1 });
    const first = store.getSnapshot().updatedAt;

    tick(60_000);
    store.addItem({ title: "later work", category: "task" });
    await store.flush();

    const persisted = JSON.parse(store.exportJson()) as BoardDoc;
    expect(persisted.updatedAt > first).toBe(true);
  });
});
