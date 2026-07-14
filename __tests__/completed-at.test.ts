/**
 * `completedAt` — the single highest-risk derivation in the store.
 *
 * In the private app this was NOT a database trigger. It was four lines inside a
 * React component (`dashboard.tsx:191-193`): set to `now` on a transition into
 * `done`, nulled on a transition to anything else. Delete the database and that
 * logic has exactly one home — the store — and nothing else in the system will
 * ever notice if it drifts. It does not throw, it does not fail a typecheck, it
 * does not render wrong. It just quietly makes "completed this week" a lie.
 *
 * So: both directions, the done→done no-op, and every path that can change an
 * item's status (updateItem, reorderItems across columns, bulkUpdateStatus,
 * addItem straight into Done).
 *
 * EVERY assertion here is separated by a `tick()`. Without it, "the stamp was
 * preserved" and "the stamp was rewritten at the same millisecond" are the same
 * string and the test cannot fail. I verified each of these fails when the rule
 * is broken.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ItemStatus } from "../lib/types";
import { itemById, rig, tick } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

const NOT_DONE: ItemStatus[] = ["pending", "in_progress", "blocked", "future_phase"];

describe("completedAt", () => {
  it("is null on a newly created item", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task" });
    expect(item.completedAt).toBeNull();
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBeNull();
  });

  it("is STAMPED on the transition into done", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task" });

    tick(60_000);
    store.updateItem(item.id, { status: "done" });

    const done = itemById(store.getSnapshot(), item.id);
    expect(done.status).toBe("done");
    // Stamped with the timestamp of the commit that completed it — not a
    // rounded date, not the creation date.
    expect(done.completedAt).toBe(done.updatedAt);
    expect(done.completedAt! > item.createdAt).toBe(true);
  });

  it("is stamped when an item is created straight into done", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task", status: "done" });
    expect(item.completedAt).not.toBeNull();
    expect(item.completedAt).toBe(item.createdAt);
  });

  it.each(NOT_DONE)("is CLEARED on the transition done → %s", (status) => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task", status: "done" });
    expect(itemById(store.getSnapshot(), item.id).completedAt).not.toBeNull();

    tick(60_000);
    store.updateItem(item.id, { status });

    const after = itemById(store.getSnapshot(), item.id);
    expect(after.status).toBe(status);
    expect(after.completedAt).toBeNull();
  });

  it("PRESERVES the stamp on a done → done no-op (dragging within the Done column)", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task" });
    store.updateItem(item.id, { status: "done" });
    const stamp = itemById(store.getSnapshot(), item.id).completedAt;
    expect(stamp).not.toBeNull();

    // A re-write with the same status, an hour later. The original stamped
    // unconditionally, which meant reordering the Done column silently reset
    // every card's completion date.
    tick(3_600_000);
    store.updateItem(item.id, { status: "done" });
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBe(stamp);

    // Same, via a drag within the column.
    tick(3_600_000);
    store.reorderItems("done", [item.id]);
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBe(stamp);

    // Same, via a bulk "mark done" that includes an already-done card.
    tick(3_600_000);
    store.bulkUpdateStatus([item.id], "done");
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBe(stamp);
  });

  it("preserves the stamp when a done item is edited without touching its status", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task", status: "done" });
    const stamp = itemById(store.getSnapshot(), item.id).completedAt;

    tick(60_000);
    store.updateItem(item.id, { title: "renamed", priority: "high" });

    const after = itemById(store.getSnapshot(), item.id);
    expect(after.title).toBe("renamed");
    expect(after.completedAt).toBe(stamp);
  });

  it("re-stamps a NEW completion after a done → pending → done round trip", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task", status: "done" });
    const first = itemById(store.getSnapshot(), item.id).completedAt;

    tick(60_000);
    store.updateItem(item.id, { status: "pending" });
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBeNull();

    tick(60_000);
    store.updateItem(item.id, { status: "done" });
    const second = itemById(store.getSnapshot(), item.id).completedAt;

    expect(second).not.toBeNull();
    expect(second).not.toBe(first); // reopened work completes again, later
    expect(second! > first!).toBe(true);
  });

  it("stamps and clears identically through a cross-column drag (reorderItems)", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "task" });

    tick();
    store.reorderItems("done", [a.id, b.id]); // dragged into Done
    for (const id of [a.id, b.id]) {
      const i = itemById(store.getSnapshot(), id);
      expect(i.status).toBe("done");
      expect(i.completedAt).not.toBeNull();
    }

    tick();
    store.reorderItems("in_progress", [a.id]); // dragged back out
    expect(itemById(store.getSnapshot(), a.id).completedAt).toBeNull();
    // …and the card left behind in Done keeps its stamp.
    expect(itemById(store.getSnapshot(), b.id).completedAt).not.toBeNull();
  });

  it("stamps and clears identically through bulkUpdateStatus", () => {
    const { store } = rig();
    const a = store.addItem({ title: "a", category: "task" });
    const b = store.addItem({ title: "b", category: "bug" });

    tick();
    store.bulkUpdateStatus([a.id, b.id], "done");
    for (const i of store.getSnapshot().items) expect(i.completedAt).not.toBeNull();

    tick();
    store.bulkUpdateStatus([a.id, b.id], "blocked");
    for (const i of store.getSnapshot().items) expect(i.completedAt).toBeNull();
  });

  it("cannot be set from outside the store — it is absent from ItemPatch", () => {
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task" });

    // The invariant is enforced by the type system, not by convention: there is
    // no code path anywhere in the app that can assign `completedAt` directly.
    // @ts-expect-error completedAt is derived, never assigned
    store.updateItem(item.id, { completedAt: "2020-01-01T00:00:00.000Z" });

    // …and if someone reaches past the compiler, the store still re-derives it
    // from the item's resulting status.
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBeNull();
  });

  it("heals a stale stamp carried in by a hand-edited import", () => {
    // zod has no cross-field refinement — `{status:'pending', completedAt:'…'}`
    // is a shape-valid document. It is accepted on import (we do not reject a
    // user's data over it) but self-heals on the first touch, rather than
    // poisoning "completed this week" forever.
    const { store } = rig();
    const item = store.addItem({ title: "a", category: "task" });
    const doc = store.getSnapshot();

    const tampered = JSON.stringify({
      ...doc,
      items: [
        {
          ...doc.items[0],
          status: "pending",
          completedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    });

    store.importJson(tampered);
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBe(
      "2020-01-01T00:00:00.000Z",
    );

    tick();
    store.updateItem(item.id, { title: "touched" });
    expect(itemById(store.getSnapshot(), item.id).completedAt).toBeNull();
  });
});
