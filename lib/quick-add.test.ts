import { describe, expect, it } from "vitest";

import { parseQuickAdd } from "./quick-add";

// A fixed Wednesday, so weekday math is deterministic. 2026-07-15 is a Wednesday.
const WED = new Date(2026, 6, 15);

describe("parseQuickAdd", () => {
  it("returns plain text untouched", () => {
    const r = parseQuickAdd("fix the invoice page", WED);
    expect(r).toEqual({
      title: "fix the invoice page",
      priority: null,
      category: null,
      assignedTo: null,
      dueDate: null,
    });
  });

  it("parses priority and strips the token", () => {
    const r = parseQuickAdd("fix invoice !high", WED);
    expect(r.priority).toBe("high");
    expect(r.title).toBe("fix invoice");
  });

  it("accepts priority aliases, case-insensitively", () => {
    expect(parseQuickAdd("x !HI", WED).priority).toBe("high");
    expect(parseQuickAdd("x !med", WED).priority).toBe("medium");
    expect(parseQuickAdd("x !LO", WED).priority).toBe("low");
  });

  it("leaves unknown ! tokens in the title", () => {
    const r = parseQuickAdd("this is !important stuff", WED);
    expect(r.priority).toBeNull();
    expect(r.title).toBe("this is !important stuff");
  });

  it("parses every real category", () => {
    for (const c of ["task", "bug", "feature", "question", "decision"]) {
      expect(parseQuickAdd(`x #${c}`, WED).category).toBe(c);
    }
  });

  it("maps data-needed spellings onto data_needed", () => {
    expect(parseQuickAdd("x #data_needed", WED).category).toBe("data_needed");
    expect(parseQuickAdd("x #data-needed", WED).category).toBe("data_needed");
    expect(parseQuickAdd("x #dataneeded", WED).category).toBe("data_needed");
    expect(parseQuickAdd("x #data", WED).category).toBe("data_needed");
  });

  it("leaves unknown # tokens in the title", () => {
    const r = parseQuickAdd("ship #launch post", WED);
    expect(r.category).toBeNull();
    expect(r.title).toBe("ship #launch post");
  });

  it("parses assignee, preserving case; last one wins", () => {
    const r = parseQuickAdd("review PR @Sam @Alex", WED);
    expect(r.assignedTo).toBe("Alex");
    expect(r.title).toBe("review PR");
  });

  it("does not treat a bare @ as an assignee", () => {
    const r = parseQuickAdd("meet @ noon", WED);
    expect(r.assignedTo).toBeNull();
    expect(r.title).toBe("meet @ noon");
  });

  it("due:today and due:tomorrow", () => {
    expect(parseQuickAdd("x due:today", WED).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x due:tomorrow", WED).dueDate).toBe("2026-07-16");
    expect(parseQuickAdd("x due:tom", WED).dueDate).toBe("2026-07-16");
  });

  it("weekday means the next occurrence, counting today", () => {
    // From Wednesday: fri = +2, mon = +5, wed = today.
    expect(parseQuickAdd("x due:fri", WED).dueDate).toBe("2026-07-17");
    expect(parseQuickAdd("x due:mon", WED).dueDate).toBe("2026-07-20");
    expect(parseQuickAdd("x due:wed", WED).dueDate).toBe("2026-07-15");
    expect(parseQuickAdd("x due:thurs", WED).dueDate).toBe("2026-07-16");
  });

  it("due:+N adds days", () => {
    expect(parseQuickAdd("x due:+10", WED).dueDate).toBe("2026-07-25");
  });

  it("ISO dates pass through, impossible ones do not parse", () => {
    expect(parseQuickAdd("x due:2027-01-05", WED).dueDate).toBe("2027-01-05");
    // Past ISO is explicit and allowed.
    expect(parseQuickAdd("x due:2020-01-05", WED).dueDate).toBe("2020-01-05");
    const bad = parseQuickAdd("x due:2026-02-31", WED);
    expect(bad.dueDate).toBeNull();
    expect(bad.title).toBe("x due:2026-02-31");
  });

  it("M/D uses this year, rolling forward once past", () => {
    expect(parseQuickAdd("x due:12/1", WED).dueDate).toBe("2026-12-01");
    // January has passed by mid-July, so 1/5 means next January.
    expect(parseQuickAdd("x due:1/5", WED).dueDate).toBe("2027-01-05");
    // Today itself does not roll.
    expect(parseQuickAdd("x due:7/15", WED).dueDate).toBe("2026-07-15");
  });

  it("unparseable due tokens stay in the title", () => {
    const r = parseQuickAdd("x due:whenever", WED);
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe("x due:whenever");
  });

  it("all token kinds together, anywhere in the string", () => {
    const r = parseQuickAdd("!high fix invoice #bug due:fri @sam totals", WED);
    expect(r).toEqual({
      title: "fix invoice totals",
      priority: "high",
      category: "bug",
      assignedTo: "sam",
      dueDate: "2026-07-17",
    });
  });

  it("a token-only input leaves an empty title", () => {
    const r = parseQuickAdd("!high #bug", WED);
    expect(r.title).toBe("");
    expect(r.priority).toBe("high");
    expect(r.category).toBe("bug");
  });

  it("tokens must be whole words", () => {
    const r = parseQuickAdd("wow!high #bug!", WED);
    expect(r.priority).toBeNull();
    expect(r.category).toBeNull();
    expect(r.title).toBe("wow!high #bug!");
  });
});
