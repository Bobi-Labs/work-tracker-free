"use client";

import { cn } from "@/lib/utils";
import { MAKER_NAME, MAKER_URL, REPO_URL } from "@/lib/app-config";

/* ───────────────────────────── Attribution ─────────────────────────────
 * Two links: the maker's home page, and the source.
 *
 * "Built by …" points at the product's HOME PAGE, not at the repository.
 * Sending a general user to a git repo is sending them somewhere they did not
 * ask to go. The repo link is a separate, quieter icon for the people who do
 * want it.
 *
 * Rendered in two places, which is why it lives in its own file:
 *   - the board banner, absolutely positioned opposite the title
 *   - the first-run screen, which is the first thing a new visitor ever sees,
 *     and therefore the one surface that must never be missing it
 *
 * Both links are driven by lib/app-config.ts and either can be `null`, in
 * which case it simply is not rendered. A fork owes us nothing.
 */

export default function Attribution({ className }: { className?: string }) {
  if (!MAKER_URL && !REPO_URL) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {MAKER_NAME && MAKER_URL && (
        <a
          href={MAKER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-border bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          Built by{" "}
          <span className="font-semibold text-foreground">{MAKER_NAME}</span>
        </a>
      )}

      {REPO_URL && (
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Source on GitHub"
          aria-label="Source on GitHub"
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
        >
          {/* Inline mark. Lucide has no GitHub glyph, and a remote image would
              break the offline / file:// promise. */}
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className="h-3.5 w-3.5"
            fill="currentColor"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      )}
    </div>
  );
}
