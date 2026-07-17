/**
 * A deliberately small markdown parser: text in, a typed block tree out.
 *
 * Why hand-rolled: boards are imported from untrusted files, so whatever
 * renders descriptions is an XSS surface. This parser NEVER emits HTML — it
 * emits data, and the renderer maps that data to React elements, so there is
 * no `dangerouslySetInnerHTML` anywhere in the pipeline and no sanitizer to
 * keep patched. `<script>` in a description is just seven characters of text.
 *
 * Supported, and nothing else:
 *   blocks:  paragraphs · # ## ### headings · - / * bullets · 1. numbered ·
 *            - [ ] / - [x] checkboxes · ``` fenced code
 *   inline:  **bold** · *italic* · `code` · [text](https://…) · bare URLs
 *
 * Links only keep http/https/mailto. Anything else ([x](javascript:…)) is
 * rendered as its visible text, payload dropped. No raw HTML, no images
 * (an <img src> is a network beacon — same reason banner URLs never render),
 * no nesting inside inline runs. Additions should preserve all three rules.
 */

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export interface ListItem {
  inline: InlineNode[];
  /** null = a plain bullet; boolean = a checkbox and its state. */
  checked: boolean | null;
}

export type Block =
  | { kind: "paragraph"; inline: InlineNode[] }
  | { kind: "heading"; level: 1 | 2 | 3; inline: InlineNode[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "codeblock"; text: string };

const SAFE_HREF = /^(https?:|mailto:)/i;
const BARE_URL = /https?:\/\/[^\s<>"')\]]+/g;

/** Split a plain-text run into text nodes and autolinked bare URLs.
 *  Trailing sentence punctuation stays outside the link — "see
 *  https://example.com/docs." should not 404 on a URL ending in a period. */
function autolink(text: string, out: InlineNode[]): void {
  let last = 0;
  for (const m of text.matchAll(BARE_URL)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const url = m[0].replace(/[.,;:!?]+$/, "");
    out.push({ kind: "link", text: url, href: url });
    if (url.length < m[0].length)
      out.push({ kind: "text", text: m[0].slice(url.length) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
}

// Bold/italic content must start and end on non-whitespace (CommonMark's
// flanking rule, simplified) — otherwise "2 * 3 = 6 and 4 * 5" italicises
// the arithmetic between the stars.
//
// ⚠️ The {1,500} / {1,2000} caps on the link branch are a DoS bound, not a
// style choice. Uncapped, `[^\]\n]+` backtracks at every `[` and a crafted
// 300KB description of "[[[[…" freezes the tab for half a minute — measured,
// not theoretical. Boards import from untrusted files; the caps make the
// worst case linear. A 500-char link text un-formats gracefully instead.
const INLINE_TOKEN =
  /(`[^`\n]+`)|(\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})\))|(\*\*(\S(?:[^*\n]*\S)?)\*\*)|(\*(\S(?:[^*\n]*\S)?)\*)/g;

export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let last = 0;

  for (const m of text.matchAll(INLINE_TOKEN)) {
    if (m.index! > last) autolink(text.slice(last, m.index), out);

    if (m[1]) {
      out.push({ kind: "code", text: m[1].slice(1, -1) });
    } else if (m[2]) {
      // Disallowed scheme → keep the visible text, drop the payload.
      if (SAFE_HREF.test(m[4]!)) {
        out.push({ kind: "link", text: m[3]!, href: m[4]! });
      } else {
        out.push({ kind: "text", text: m[3]! });
      }
    } else if (m[5]) {
      out.push({ kind: "bold", text: m[6]! });
    } else if (m[7]) {
      out.push({ kind: "italic", text: m[8]! });
    }

    last = m.index! + m[0].length;
  }

  if (last < text.length) autolink(text.slice(last), out);
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/;
const FENCE = /^\s{0,3}```/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");

  /** Paragraph lines buffer. Joined with \n — the renderer preserves the
   *  break, so plain-text descriptions written before markdown existed keep
   *  their exact shape. */
  let para: string[] = [];
  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push({ kind: "paragraph", inline: parseInline(para.join("\n")) });
    para = [];
  };

  let list: { ordered: boolean; items: ListItem[] } | null = null;
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ...list });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flushPara();
      flushList();
      // A fence that closes on its own line — ```npm install``` — is the
      // Slack/Discord one-liner habit. Without this branch the content would
      // vanish (treated as an info string) and the REST of the document would
      // be swallowed as an unclosed fence.
      const single = line.match(/^\s{0,3}```(.+?)```\s*$/);
      if (single) {
        blocks.push({ kind: "codeblock", text: single[1]! });
        continue;
      }
      const code: string[] = [];
      i++;
      // An unclosed fence swallows the rest — same as every real renderer.
      while (i < lines.length && !FENCE.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: "codeblock", text: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        inline: parseInline(heading[2]!),
      });
      continue;
    }

    const bullet = line.match(BULLET);
    const ordered = bullet ? null : line.match(ORDERED);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = !!ordered;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      let content = (bullet ? bullet[1] : ordered![1])!;
      let checked: boolean | null = null;
      const box = bullet ? content.match(CHECKBOX) : null;
      if (box) {
        checked = box[1] !== " ";
        content = box[2]!;
      }
      list.items.push({ inline: parseInline(content), checked });
      continue;
    }

    flushList();
    para.push(line);
  }

  flushPara();
  flushList();
  return blocks;
}
