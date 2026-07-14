/**
 * Item creation, ordering, and bulk operations.
 *
 * The defaults asserted here are the ones Postgres used to supply for free
 * (`DEFAULT 'pending'`, `DEFAULT 'medium'`, `DEFAULT 0`). `category` is the
 * exception and the reason this file leans on it hard: it was **NOT NULL with no
 * default**, so there is no value the store could invent that wouldn't be a
 * guess. The compiler now enforces what the constraint used to.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { CorruptDocError, migrate } from "../lib/schema";
import { createItem } from "../lib/store/board-doc";
import { statusOrder } from "../lib/types";
import { itemById, rig, tick } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("addItem defaults", () => {
  it("applies the defaults the database used to supply", () => {
    const { store } = rig();
    const item = store.addItem({ title: "minimal", category: "task" });

    expect(item.status).toBe("pending"); // DEFAULT 'pending'
    expect(item.priority).toBe("medium"); // DEFAULT 'medium'
    expect(item.sortOrder).toBe(0); // DEFAULT 0
    expect(item.description).toBeNull();
    expect(item.assignedTo).toBeNull();
    expect(item.dueDate).toBeNull();
    expect(item.completedAt).toBeNull();
    expect(item.notes).toEqual([]);
    expect(item.id).not.toBe("");
    expect(item.createdAt).toBe(item.updatedAt);
  });

  it("does not override anything the caller actually supplied", () => {
    const { store } = rig();
    const item = store.addItem({
      title: "explicit",
      category: "decision",
      priority: "low",
      status: "blocked",
      description: "",
      assignedTo: "",
      dueDate: "2026-01-01",
      sortOrder: 70,
    });

    expect(item.category).toBe("decision");
    expect(item.priority).toBe("low");
    expect(item.status).toBe("blocked");
    expect(item.sortOrder).toBe(70);
    // Empty string is a value, not an absence — `?? null` must not swallow it.
    expect(item.description).toBe("");
    expect(item.assignedTo).toBe("");
  });

  it("REQUIRES category — there is no default to fall back on", () => {
    const { store } = rig();

    // @ts-expect-error category is NOT NULL with no default; it must be supplied
    store.addItem({ title: "no category" });

    // Proof this matters, not just a compiler nicety: without the guard the row
    // reaches storage with `category: undefined`, which is dropped by
    // JSON.stringify — and the document then fails to load on the NEXT session,
    // long after the mistake, with no way to trace it back.
    const persisted = store.exportJson();
    let thrown: unknown;
    try {
      migrate(JSON.parse(persisted));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CorruptDocError);
    expect((thrown as CorruptDocError).reason).toBe("invalid-shape");
    expect((thrown as CorruptDocError).issues[0]!.path).toContain("category");
  });

  it("gives every item a distinct id", () => {
    const { store } = rig();
    const ids = new Set(
      Array.from({ length: 200 }, (_, i) =>
        store.addItem({ title: `#${i}`, category: "task" }).id,
      ),
    );
    expect(ids.size).toBe(200);
  });

  it("createItem() is the single source of the defaults (store and seed share it)", () => {
    const item = createItem({ title: "x", category: "feature" }, "2026-01-01T00:00:00.000Z");
    expect(item.status).toBe("pending");
    expect(item.priority).toBe("medium");
    expect(item.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("reorderItems", () => {
  it("assigns sortOrder = index * 10 across the destination column", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task", status: "pending" });
    const b = store.addItem({ title: "b", category: "task", status: "pending" });
    const c = store.addItem({ title: "c", category: "task", status: "pending" });
    const d = store.addItem({ title: "d", category: "task", status: "pending" });

    store.reorderItems("pending", [d.id, c.id, b.id, a.id]);

    const doc = store.getSnapshot();
    expect(itemById(doc, d.id).sortOrder).toBe(0);
    expect(itemById(doc, c.id).sortOrder).toBe(10);
    expect(itemById(doc, b.id).sortOrder).toBe(20);
    expect(itemById(doc, a.id).sortOrder).toBe(30);
    // The gap of 10 is the point: an insert between two cards needs somewhere to go.
  });

  it("moves an item that wasn't in the destination column, in ONE commit", () => {
    // The old kanban-view made two calls for a cross-column drag (onStatusChange
    // + onReorder): two writes, two updatedAt bumps, and a window in which the
    // card was in the new column with its old sort order. The store owns both
    // halves now, so the move is atomic.
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task" }); // pending
    const b = store.addItem({
      title: "b",
      category: "task",
      status: "in_progress",
      sortOrder: 99, // will be renumbered by the drop
    });

    tick();
    store.reorderItems("in_progress", [b.id, a.id]);

    const doc = store.getSnapshot();
    // The status change and the renumber landed together.
    expect(itemById(doc, a.id).status).toBe("in_progress");
    expect(itemById(doc, a.id).sortOrder).toBe(10);
    expect(itemById(doc, b.id).sortOrder).toBe(0);
    // One commit: every card the drop touched carries the same timestamp as the
    // document, so there is no window where the card is in the new column with
    // its old sort order.
    expect(itemById(doc, a.id).updatedAt).toBe(doc.updatedAt);
    expect(itemById(doc, b.id).updatedAt).toBe(doc.updatedAt);
  });

  it("does not touch a card whose position in the column did not actually change", () => {
    // The minimal-diff rule. A card already sitting at index 0 of the column it
    // was dropped into must not get a new `updatedAt` just because a *different*
    // card was dropped next to it.
    const { store } = rig();
    const settled = store.addItem({
      title: "settled",
      category: "task",
      status: "in_progress",
      sortOrder: 0,
    });
    const dropped = store.addItem({ title: "dropped", category: "task" });

    tick();
    store.reorderItems("in_progress", [settled.id, dropped.id]);

    const doc = store.getSnapshot();
    expect(itemById(doc, dropped.id).updatedAt).toBe(doc.updatedAt);
    expect(itemById(doc, settled.id).updatedAt).toBe(settled.updatedAt);
    expect(itemById(doc, settled.id)).toBe(settled); // same object, untouched
  });

  it("leaves items outside the ordered list completely alone", () => {
    const { store } = rig();
    const moved = store.addItem({ title: "moved", category: "task", sortOrder: 99 });
    const untouched = store.addItem({
      title: "untouched",
      category: "task",
      status: "blocked",
      sortOrder: 99,
    });

    tick();
    store.reorderItems("pending", [moved.id]);

    const doc = store.getSnapshot();
    expect(itemById(doc, moved.id).sortOrder).toBe(0);
    expect(itemById(doc, untouched.id).sortOrder).toBe(99);
    expect(itemById(doc, untouched.id).status).toBe("blocked");
    expect(itemById(doc, untouched.id).updatedAt).not.toBe(doc.updatedAt);
  });

  it("is a no-op when the order is already correct", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task", sortOrder: 0 });
    const b = store.addItem({ title: "b", category: "task", sortOrder: 10 });

    const before = store.getSnapshot();
    tick();
    store.reorderItems("pending", [a.id, b.id]);

    // Same object identity: no commit happened, so the board did not jump to the
    // top of the workspace picker just because someone looked at it.
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("clearDone", () => {
  it("removes exactly the done items and nothing else", () => {
    const { store } = rig();
    const kept = statusOrder
      .filter((s) => s !== "done")
      .map((status) => store.addItem({ title: status, category: "task", status }));
    const done = [
      store.addItem({ title: "done 1", category: "task", status: "done" }),
      store.addItem({ title: "done 2", category: "bug", status: "done" }),
    ];

    expect(store.getSnapshot().items).toHaveLength(kept.length + 2);

    tick();
    store.clearDone();

    const doc = store.getSnapshot();
    expect(doc.items).toHaveLength(kept.length);
    expect(doc.items.map((i) => i.id).sort()).toEqual(kept.map((i) => i.id).sort());
    for (const gone of done) {
      expect(doc.items.find((i) => i.id === gone.id)).toBeUndefined();
    }
    // survivors are untouched — clearDone is a delete, not a rewrite
    for (const item of kept) {
      expect(itemById(doc, item.id)).toEqual(item);
    }
  });

  it("does not bump the document when there is nothing done to clear", () => {
    const { store } = rig();
    store.addItem({ title: "a", category: "task" });
    const before = store.getSnapshot();

    tick();
    store.clearDone();
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("deleteItem / bulkUpdateStatus", () => {
  it("deletes exactly one item", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "task" });

    store.deleteItem(a.id);
    const doc = store.getSnapshot();
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0]!.id).toBe(b.id);
  });

  it("moves only the listed items", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "task" });

    store.bulkUpdateStatus([a.id], "in_progress");
    const doc = store.getSnapshot();
    expect(itemById(doc, a.id).status).toBe("in_progress");
    expect(itemById(doc, b.id).status).toBe("pending");
  });
});
