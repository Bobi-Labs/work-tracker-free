/**
 * Feedback "submission" without a server.
 *
 * The app's contract is zero network calls, enforced by CSP, so a feedback
 * form cannot POST anywhere. Instead the form COMPOSES: a mailto: URL that
 * opens the user's own mail client, or a prefilled new-issue URL on the
 * public repo. Both are navigations, not requests — the page itself still
 * never talks to the network, and the user sees exactly what leaves their
 * machine before they choose to send it.
 *
 * Pure functions so the URL shapes are unit-testable. Keep them free of
 * window/document access.
 */

// Relative on purpose: vitest resolves no "@/" alias, and this is a value
// import (the type-only "@/" imports elsewhere in lib/ erase at runtime).
import { APP_NAME } from "./app-config";

export type FeedbackKind = "bug" | "idea";

export interface FeedbackDraft {
  kind: FeedbackKind;
  summary: string;
  details: string;
  /**
   * Environment line appended to bug reports (browser + app version). The
   * form shows it to the user before composing — nothing is attached that
   * they have not seen.
   */
  context?: string;
}

const kindLabel: Record<FeedbackKind, string> = {
  bug: "Bug",
  idea: "Idea",
};

function subjectFor(draft: FeedbackDraft): string {
  return `[${APP_NAME} ${kindLabel[draft.kind]}] ${draft.summary.trim()}`;
}

function bodyFor(draft: FeedbackDraft): string {
  const parts = [draft.details.trim()];
  if (draft.kind === "bug" && draft.context) {
    parts.push("", "---", draft.context);
  }
  return parts.join("\n");
}

export function buildFeedbackMailto(email: string, draft: FeedbackDraft): string {
  const subject = encodeURIComponent(subjectFor(draft));
  const body = encodeURIComponent(bodyFor(draft));
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

/** `repoUrl` is REPO_URL from app-config, no trailing slash. */
export function buildFeedbackIssueUrl(
  repoUrl: string,
  draft: FeedbackDraft,
): string {
  const title = encodeURIComponent(subjectFor(draft));
  const body = encodeURIComponent(bodyFor(draft));
  return `${repoUrl}/issues/new?title=${title}&body=${body}`;
}
