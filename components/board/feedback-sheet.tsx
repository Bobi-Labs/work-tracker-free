"use client";

/**
 * The "report a bug / share an idea" panel.
 *
 * There is no server, so there is no submit endpoint — and the CSP would
 * block one anyway (`form-action 'none'` on the hosted copy is not an
 * accident). Instead, the two actions COMPOSE: a mailto: opens the user's
 * own mail client, and the GitHub link opens a prefilled new-issue page.
 * Plain anchor navigations, no fetch, no form action. The user sees the
 * full text (including the environment line) before anything leaves their
 * machine, which is the same transparency contract as the rest of the app.
 *
 * Renders nothing when both FEEDBACK_EMAIL and REPO_URL are null, so a
 * fork that wants no feedback channel deletes two constants, not this file.
 */

import { useMemo, useState } from "react";
import { Bug, Github, Lightbulb, Mail } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { APP_NAME, FEEDBACK_EMAIL, REPO_URL } from "@/lib/app-config";
import {
  buildFeedbackIssueUrl,
  buildFeedbackMailto,
  type FeedbackKind,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";
import pkg from "@/package.json";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackSheet({ open, onOpenChange }: Props) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");

  // Browser + version, shown to the user verbatim before composing. Kept
  // deliberately thin: no screen size, no locale, nothing they would have
  // to think about before deciding it is fine to send.
  const context = useMemo(() => {
    const browser =
      typeof navigator === "undefined"
        ? "unknown"
        : (navigator.userAgent.match(
            /(Firefox|Edg|OPR|Chrome|Safari)\/[\d.]+/,
          )?.[0] ?? "unknown browser");
    return `${APP_NAME} v${pkg.version} · ${browser.replace("Edg/", "Edge/")}`;
  }, []);

  const draft = { kind, summary, details, context };
  const ready = summary.trim().length > 0;

  const kindButton = (value: FeedbackKind, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
        kind === value
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );

  const actionClass = (enabled: boolean) =>
    cn(
      "flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors",
      enabled
        ? "text-foreground hover:bg-accent"
        : "pointer-events-none opacity-40",
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Send feedback</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="flex gap-2">
            {kindButton("bug", <Bug className="h-3.5 w-3.5" />, "Report a bug")}
            {kindButton("idea", <Lightbulb className="h-3.5 w-3.5" />, "Share an idea")}
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Summary
            </label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={kind === "bug" ? "What broke?" : "What should exist?"}
              className="h-9"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Details
            </label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={
                kind === "bug"
                  ? "What did you do, what did you expect, what happened instead?"
                  : "What problem would it solve for you?"
              }
              rows={5}
              className="resize-none"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {FEEDBACK_EMAIL && (
              <a
                href={ready ? buildFeedbackMailto(FEEDBACK_EMAIL, draft) : undefined}
                aria-disabled={!ready}
                className={cn(actionClass(ready), "sm:flex-1")}
              >
                <Mail className="h-3.5 w-3.5" />
                Send by email
              </a>
            )}
            {REPO_URL && (
              <a
                href={ready ? buildFeedbackIssueUrl(REPO_URL, draft) : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!ready}
                className={cn(actionClass(ready), "sm:flex-1")}
              >
                <Github className="h-3.5 w-3.5" />
                Open a GitHub issue
              </a>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            This app has no server, so nothing is sent from the page itself.
            The buttons open your own email app or GitHub with the text above
            prefilled{kind === "bug" && (
              <>
                {" "}plus one line of context:{" "}
                <span className="font-mono text-[10px]">{context}</span>
              </>
            )}. You press send, not us.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
