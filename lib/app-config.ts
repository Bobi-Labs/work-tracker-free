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
  "A kanban board that lives in your browser. No account, no server, no tracking — your work stays on your machine.";

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
 * Where the in-app Feedback button sends bug reports and ideas.
 *
 * There is no server to POST to (that is the whole product), so "sending"
 * means composing: the button opens the user's own mail client via mailto:,
 * or a prefilled GitHub issue via REPO_URL. Set to `null` to remove the
 * email option; if REPO_URL is also null, the Feedback button disappears
 * entirely. Forks: point this at your own inbox or null it out.
 */
export const FEEDBACK_EMAIL: string | null = "hello@bobilabs.dev";
