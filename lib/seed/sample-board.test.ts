import { describe, expect, it } from "vitest";

import { migrate } from "../schema";
import { createSampleBoard } from "./sample-board";

describe("sample board", () => {
  it("survives a JSON round-trip through the real validator", () => {
    const doc = createSampleBoard();
    const parsed = migrate(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
  });

  it("mints fresh ids each call", () => {
    const a = createSampleBoard();
    const b = createSampleBoard();
    expect(a.id).not.toEqual(b.id);
    const ids = [
      ...a.items.map((i) => i.id),
      ...a.items.flatMap((i) => i.notes.map((n) => n.id)),
      ...a.deliverables.map((d) => d.id),
      ...a.deliverables.flatMap((d) => d.questions.map((q) => q.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(b.items[0]!.id);
  });

  it("holds the completedAt invariant", () => {
    for (const i of createSampleBoard().items) {
      if (i.status === "done") expect(i.completedAt).not.toBeNull();
      else expect(i.completedAt).toBeNull();
    }
  });

  it("covers every status and tab, with a live spread", () => {
    const doc = createSampleBoard();
    expect(new Set(doc.items.map((i) => i.status)).size).toBe(5);
    expect(new Set(doc.deliverables.map((d) => d.tab)).size).toBe(3);

    // sortOrder is idx*10 dense within each status column.
    const byStatus = new Map<string, number[]>();
    for (const i of doc.items) {
      byStatus.set(i.status, [...(byStatus.get(i.status) ?? []), i.sortOrder]);
    }
    for (const orders of byStatus.values()) {
      expect(orders).toEqual(orders.map((_, idx) => idx * 10));
    }

    // Exactly one overdue item; the rest of the dated ones are in the future.
    const today = new Date().toISOString().slice(0, 10);
    const dated = doc.items.filter((i) => i.dueDate);
    expect(dated.filter((i) => i.dueDate! < today)).toHaveLength(1);

    const qs = doc.deliverables.flatMap((d) => d.questions);
    expect(qs.filter((q) => q.status === "open")).toHaveLength(3);
    const answered = qs.filter((q) => q.status === "answered");
    expect(answered).toHaveLength(1);
    expect(answered[0]!.answeredAt).not.toBeNull();

    // No board carries a remote banner — that is the whole point of `accent`.
    expect(doc.settings.bannerUrl).toBeNull();
    expect(doc.settings.accent).toMatch(/^linear-gradient\(/);
    expect(JSON.stringify(doc)).not.toContain("http");
  });
});
