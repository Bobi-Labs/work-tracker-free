"use client";

/**
 * Renders `lib/markdown.ts` block trees as React elements.
 *
 * The safety property lives in the split: the parser emits DATA, this file
 * maps data to JSX, and React escapes everything by construction. There is no
 * `dangerouslySetInnerHTML` in this pipeline; keep it that way.
 *
 * Used by item descriptions and the deliverables panel's *Md fields — the
 * fields were named `scopeMd` / `guideMd` / `buildNotesMd` from day one, but
 * until this component existed they rendered as plain text.
 */

import { useMemo } from "react";
import { Square, SquareCheckBig } from "lucide-react";

import {
  parseMarkdown,
  type Block,
  type InlineNode,
  type ListItem,
} from "@/lib/markdown";
import { cn } from "@/lib/utils";

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case "bold":
            return (
              <strong key={i} className="font-semibold text-foreground">
                {n.text}
              </strong>
            );
          case "italic":
            return <em key={i}>{n.text}</em>;
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-accent px-1 py-0.5 font-mono text-[0.85em]"
              >
                {n.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                // The description box is click-to-edit; following a link
                // must not also open the editor underneath it.
                onClick={(e) => e.stopPropagation()}
              >
                {n.text}
              </a>
            );
          default:
            return <span key={i}>{n.text}</span>;
        }
      })}
    </>
  );
}

function ListItemRow({ item }: { item: ListItem }) {
  if (item.checked === null) {
    return (
      <li>
        <Inline nodes={item.inline} />
      </li>
    );
  }
  return (
    // `list-none` per item, so a list mixing checkboxes and plain bullets
    // keeps discs on the plain ones instead of stripping markers wholesale.
    <li className="flex list-none items-start gap-1.5">
      {item.checked ? (
        <SquareCheckBig className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      ) : (
        <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={item.checked ? "text-muted-foreground line-through" : ""}>
        <Inline nodes={item.inline} />
      </span>
    </li>
  );
}

const headingClass: Record<1 | 2 | 3, string> = {
  1: "text-base font-semibold text-foreground",
  2: "text-sm font-semibold text-foreground",
  3: "text-[13px] font-semibold text-foreground",
};

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading":
      return (
        <div className={headingClass[block.level]}>
          <Inline nodes={block.inline} />
        </div>
      );
    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-0.5 pl-5">
          {block.items.map((item, i) => (
            <ListItemRow key={i} item={item} />
          ))}
        </ol>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5">
          {block.items.map((item, i) => (
            <ListItemRow key={i} item={item} />
          ))}
        </ul>
      );
    case "codeblock":
      return (
        <pre className="overflow-x-auto rounded-md bg-accent p-2 font-mono text-xs leading-relaxed">
          {block.text}
        </pre>
      );
    default:
      return (
        <p className="whitespace-pre-wrap">
          <Inline nodes={block.inline} />
        </p>
      );
  }
}

export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  // Parsing is capped-linear but not free; boards can hold long documents and
  // this component re-renders with every board mutation.
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}
