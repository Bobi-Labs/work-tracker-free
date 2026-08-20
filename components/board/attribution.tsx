"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight, MoveRight } from "lucide-react";
import {
  MAKER_NAME,
  MAKER_URL,
  REPO_URL,
  WORK_WITH_US_URL,
} from "@/lib/app-config";

/* ───────────────────────────── Attribution ─────────────────────────────
 * A vertical stack of equal-width pills (operator's layout call: the mixed
 * pill-plus-icon row looked ragged): Built by · Our GitHub · whatever the
 * host surface appends via `children` (the banner adds its Feedback button).
 *
 * "Built by …" points at the product's HOME PAGE, not at the repository.
 * Sending a general user to a git repo is sending them somewhere they did
 * not ask to go. The repo gets its own labelled pill for the people who do
 * want it.
 *
 * Rendered in two places, which is why it lives in its own file:
 *   - the board banner, absolutely positioned opposite the title
 *   - the first-run screen, the one surface a brand-new visitor always sees
 *
 * Both links are driven by lib/app-config.ts and either can be `null`, in
 * which case it simply is not rendered. A fork owes us nothing.
 */

/** Shared by the appended pills (e.g. the banner's Feedback button) so the
 *  stack stays visually one unit. */
/** The emerald halo that marks the stack's primary outbound link. Kept
 *  separate from the pill so it can move without rewriting either. Emerald
 *  rather than the indigo primary, so it reads as its own thing in light,
 *  dim and dark. */
export const glowClass =
  "border-emerald-500/40 text-foreground shadow-[0_0_10px_rgba(16,185,129,0.35)] transition-all hover:border-emerald-400/70 hover:shadow-[0_0_16px_rgba(16,185,129,0.55)]";

export const attributionPillClass =
  "flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground";

export default function Attribution({
  className,
  prompt,
  children,
}: {
  className?: string;
  /** Sales line rendered to the LEFT of the "Work with us" button, on wide
   *  viewports only. Opt-in per surface: the board banner has the width for
   *  it, the first-run screen is a narrow column and passes nothing. */
  prompt?: string;
  children?: React.ReactNode;
}) {
  if (!MAKER_URL && !REPO_URL && !WORK_WITH_US_URL && !children) return null;

  return (
    // items-end, not a fixed width, so the prompt row can extend LEFT past the
    // pill stack while the stack itself stays 9rem. The banner positions this
    // absolutely against the right edge, so growth has to go leftward.
    <div className={cn("flex flex-col items-end gap-1", className)}>
      {WORK_WITH_US_URL && (
        <div className="flex w-max items-center gap-2">
          {prompt && (
            // Hidden below xl on purpose. The line is ~55 characters; on a
            // narrower banner it either collides with the board title or wraps
            // into the stack. The BUTTON is always there, so nothing is lost
            // but the pitch.
            <span className="hidden items-center gap-2 whitespace-nowrap text-xs font-semibold text-foreground xl:flex">
              {prompt}
              <MoveRight aria-hidden className="h-4 w-4 shrink-0 text-emerald-400/80" />
            </span>
          )}
          <a
            href={WORK_WITH_US_URL}
            target="_blank"
            rel="noopener noreferrer"
            // Same pill as the rest of the stack, plus the emerald glow that
            // used to sit on "Built by". The glow marks the PRIMARY way out of
            // the app, and that is no longer attribution: it is this.
            className={cn(attributionPillClass, "w-36 font-semibold", glowClass)}
          >
            <ArrowUpRight className="h-3 w-3" />
            Work with us
          </a>
        </div>
      )}

      <div className="flex w-36 flex-col items-stretch gap-1">
        {MAKER_NAME && MAKER_URL && (
          <a
            href={MAKER_URL}
            target="_blank"
            rel="noopener noreferrer"
            // Plain pill. It carried the emerald glow while it was the only way
            // out of the app; it is not any more, and two glowing pills in one
            // stack cancel each other out. The glow moved to "Work with us",
            // which is the link that now matters most.
            className={attributionPillClass}
          >
            Built by&nbsp;
            <span className="font-semibold text-foreground">{MAKER_NAME}</span>
          </a>
        )}

        {REPO_URL && (
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={attributionPillClass}
          >
            {/* Inline mark. Lucide has no GitHub glyph, and a remote image would
                break the offline promise. */}
            <svg
              viewBox="0 0 16 16"
              aria-hidden
              className="h-3 w-3"
              fill="currentColor"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            Our GitHub
          </a>
        )}

        {children}
      </div>
    </div>
  );
}
