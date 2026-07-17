import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown, type Block } from "./markdown";

const para = (text: string): Block => ({
  kind: "paragraph",
  inline: [{ kind: "text", text }],
});

describe("parseMarkdown blocks", () => {
  it("plain text is one paragraph, newlines preserved inside it", () => {
    expect(parseMarkdown("line one\nline two")).toEqual([
      para("line one\nline two"),
    ]);
  });

  it("blank lines split paragraphs", () => {
    expect(parseMarkdown("one\n\ntwo")).toEqual([para("one"), para("two")]);
  });

  it("headings h1-h3; #### is not a heading", () => {
    const blocks = parseMarkdown("# A\n## B\n### C\n#### D");
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({ kind: "heading", level: 2 });
    expect(blocks[2]).toMatchObject({ kind: "heading", level: 3 });
    expect(blocks[3]!.kind).toBe("paragraph");
  });

  it("bullet list groups consecutive items", () => {
    const blocks = parseMarkdown("- a\n- b\n* c");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "list",
      ordered: false,
    });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it("ordered list is separate from unordered", () => {
    const blocks = parseMarkdown("- a\n1. b\n2) c");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
  });

  it("checkboxes carry state; plain bullets carry null", () => {
    const blocks = parseMarkdown("- [ ] open\n- [x] done\n- plain");
    const items = (blocks[0] as { items: { checked: boolean | null }[] }).items;
    expect(items.map((i) => i.checked)).toEqual([false, true, null]);
  });

  it("fenced code keeps its contents verbatim, markdown and all", () => {
    const blocks = parseMarkdown("```\n# not a heading\n**not bold**\n```");
    expect(blocks).toEqual([
      { kind: "codeblock", text: "# not a heading\n**not bold**" },
    ]);
  });

  it("an unclosed fence swallows the rest", () => {
    const blocks = parseMarkdown("before\n```\ncode forever");
    expect(blocks[1]).toEqual({ kind: "codeblock", text: "code forever" });
  });

  it("a one-line fence keeps its content and does not eat the document", () => {
    const blocks = parseMarkdown("```npm install```\nMore text");
    expect(blocks).toEqual([
      { kind: "codeblock", text: "npm install" },
      { kind: "paragraph", inline: [{ kind: "text", text: "More text" }] },
    ]);
  });

  it("a language-tagged opening fence still opens a block", () => {
    const blocks = parseMarkdown("```js\nconst x = 1;\n```");
    expect(blocks).toEqual([{ kind: "codeblock", text: "const x = 1;" }]);
  });

  it("a list line ends a paragraph and vice versa", () => {
    const blocks = parseMarkdown("intro\n- a\noutro");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "list", "paragraph"]);
  });
});

describe("parseInline", () => {
  it("bold, italic, code", () => {
    expect(parseInline("**b** *i* `c`")).toEqual([
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "italic", text: "i" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
    ]);
  });

  it("markdown inside inline code is literal", () => {
    expect(parseInline("`**x**`")).toEqual([{ kind: "code", text: "**x**" }]);
  });

  it("links keep http, https and mailto", () => {
    expect(parseInline("[docs](https://example.com)")).toEqual([
      { kind: "link", text: "docs", href: "https://example.com" },
    ]);
    expect(parseInline("[me](mailto:a@b.c)")).toEqual([
      { kind: "link", text: "me", href: "mailto:a@b.c" },
    ]);
  });

  it("a javascript: link is rendered as its text, payload dropped", () => {
    const nodes = parseInline("[click](javascript:alert(1))");
    expect(nodes.some((n) => n.kind === "link")).toBe(false);
    expect(nodes[0]).toEqual({ kind: "text", text: "click" });
    expect(JSON.stringify(nodes)).not.toContain("javascript");
  });

  it("bare URLs autolink", () => {
    expect(parseInline("see https://example.com/x for more")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "https://example.com/x", href: "https://example.com/x" },
      { kind: "text", text: " for more" },
    ]);
  });

  it("autolink leaves trailing sentence punctuation out of the href", () => {
    expect(parseInline("read https://example.com/docs.")).toEqual([
      { kind: "text", text: "read " },
      { kind: "link", text: "https://example.com/docs", href: "https://example.com/docs" },
      { kind: "text", text: "." },
    ]);
  });

  it("a hostile pile of brackets parses in bounded time", () => {
    // The uncapped link regex was O(n^2): 300KB of "[" took 34 SECONDS.
    // The {1,500}/{1,2000} caps make it linear. Generous threshold so slow
    // CI never flakes; the pre-fix behavior missed it by two orders.
    const hostile = "[".repeat(100_000);
    const t0 = performance.now();
    parseInline(hostile);
    parseInline("[a](b".repeat(20_000));
    expect(performance.now() - t0).toBeLessThan(2_000);
  });

  it("HTML is inert text — the parser never emits markup", () => {
    const nodes = parseInline('<script>alert("xss")</script>');
    expect(nodes).toEqual([
      { kind: "text", text: '<script>alert("xss")</script>' },
    ]);
  });

  it("spaced stars are arithmetic, not emphasis", () => {
    expect(parseInline("2 * 3 = 6 and a ** alone")).toEqual([
      { kind: "text", text: "2 * 3 = 6 and a ** alone" },
    ]);
  });

  it("flanking still allows single-character emphasis", () => {
    expect(parseInline("*i* and **b**")).toEqual([
      { kind: "italic", text: "i" },
      { kind: "text", text: " and " },
      { kind: "bold", text: "b" },
    ]);
  });
});
