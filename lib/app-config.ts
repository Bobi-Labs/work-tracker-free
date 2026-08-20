/**
 * Single source of truth for the product's public identity.
 *
 * Name confirmed by the operator (2026-07-13): "Bobi Tracker" — deliberately
 * brand-carrying, because the free tool is the top of the funnel for Bobi Labs'
 * bespoke work. The TAGLINE does the explaining, so the name doesn't have to.
 *
 * Every UI string, <title>, README heading and export filename imports from
 * here, so renaming the product remains a one-line change.
 */

export const APP_NAME = "Bobi Tracker";

export const APP_TAGLINE =
  "A kanban board that lives in your browser. No account, no server, no tracking: your work stays on your machine.";

/**
 * Attribution shown in the app banner.
 *
 * FORKING THIS? These two constants are the whole of it. Retarget them at your
 * own site and repo, or set either to `null` to hide that link entirely — the
 * banner adapts. Nothing else in the codebase mentions the maker, and the MIT
 * licence does not require you to keep them.
 *
 * `MAKER_URL` is the product's home page — the canonical place to send someone,
 * and deliberately NOT the repository. A repo is a destination for developers;
 * the home page is where everyone else should land.
 */
export const MAKER_NAME: string | null = "Bobi Labs";
export const MAKER_URL: string | null = "https://bobilabs.dev/worktracker";
export const REPO_URL: string | null =
  "https://github.com/Bobi-Labs/work-tracker-free";

/**
 * Where the banner's Feedback button goes: a page on the maker's site with a
 * real form behind it. A link, not a POST — this app makes zero network
 * calls (the CSP enforces it), so feedback intake lives OFF the app, on a
 * site with normal web rules. The first cut used mailto: instead; it died
 * on contact with reality, because desktop mail-client defaults are
 * somebody's unloved Outlook, not their actual inbox.
 *
 * Forks: point at your own form or set `null` to remove the button.
 */
export const FEEDBACK_URL: string | null =
  "https://bobilabs.dev/worktracker/feedback";

/**
 * Where "Work with us" goes: the maker's link tree.
 *
 * This is the one commercial ask in the whole app, and it exists because the
 * free tool is the top of the funnel for bespoke work. It is a plain link, so
 * the app still makes zero network calls.
 *
 * Forks: retarget it, or set `null` to remove the button and its prompt
 * entirely. The banner and the first-run screen both adapt.
 */
export const WORK_WITH_US_URL: string | null = "https://bobilabs.dev/links";

/** The sales line shown beside that button on surfaces wide enough for it.
 *  Rendered only where a host passes it (the board banner does; the first-run
 *  screen deliberately does not, since it is a narrow column).
 *
 *  It deliberately stops at the question. The operator's original line ended
 *  "…Work with us ------>", which the button then repeated; the arrow does
 *  that pointing now, so the phrase lives in one place. */
export const WORK_WITH_US_PROMPT =
  "Need something custom built, a problem fixed?";
