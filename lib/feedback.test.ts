import { describe, expect, it } from "vitest";

import { buildFeedbackIssueUrl, buildFeedbackMailto } from "./feedback";

const bug = {
  kind: "bug" as const,
  summary: "Drag drops the card",
  details: "Steps:\n1. Drag a card\n2. It vanishes",
  context: "Bobi Tracker v0.1.0 · Chrome 138",
};

describe("buildFeedbackMailto", () => {
  it("composes subject, body, and context for a bug", () => {
    const url = buildFeedbackMailto("hello@example.dev", bug);
    expect(url.startsWith("mailto:hello@example.dev?subject=")).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("[Bobi Tracker Bug] Drag drops the card");
    expect(decoded).toContain("1. Drag a card");
    expect(decoded).toContain("Chrome 138");
  });

  it("ideas do not carry the environment context", () => {
    const url = buildFeedbackMailto("a@b.c", { ...bug, kind: "idea" });
    expect(decodeURIComponent(url)).toContain("[Bobi Tracker Idea]");
    expect(decodeURIComponent(url)).not.toContain("Chrome 138");
  });

  it("special characters survive the round trip", () => {
    const url = buildFeedbackMailto("a@b.c", {
      kind: "idea",
      summary: "Support & encourage #tags?",
      details: 'Line with "quotes" and\nnewlines',
    });
    // Raw & or # in the query would truncate subject/body in mail clients.
    // The only legal & is the one separating subject from body; # never
    // appears raw because encodeURIComponent turns it into %23.
    expect(url.split("&")).toHaveLength(2);
    expect(url).not.toContain("#");
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("Support & encourage #tags?");
    expect(decoded).toContain('"quotes"');
  });
});

describe("buildFeedbackIssueUrl", () => {
  it("targets the repo's new-issue page with prefilled title and body", () => {
    const url = buildFeedbackIssueUrl("https://github.com/o/r", bug);
    expect(url.startsWith("https://github.com/o/r/issues/new?title=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("[Bobi Tracker Bug]");
    expect(decodeURIComponent(url)).toContain("It vanishes");
  });
});
