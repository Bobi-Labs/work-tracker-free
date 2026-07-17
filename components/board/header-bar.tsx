"use client";

/**
 * The board header — banner, view toggle, and the right-hand utility cell.
 *
 * Ported from the private app's `header-card.tsx` and gutted. What went, and why:
 *
 *  - **Files tab.** There is no file backend. The toggle is 3 columns, not 4.
 *  - **Refresh button.** It called `queryClient.invalidateQueries()`. There is no
 *    server cache to invalidate — the store IS the data, synchronously. A refresh
 *    button here would be a button that does nothing.
 *  - **Chat button + `<TrackerUserMenu />`.** No chat, no accounts, no auth.
 *  - **`<BoardSwitcher>`** (which took `projects` / `currentProjectId` /
 *    `currentUserProfileId` and routed) → `<BoardPicker />`, which reads the
 *    workspace from context. One board = one document; there is no route to push.
 *  - **`project.banner_url` `<img>`** → a CSS gradient. See `safeAccent` below.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Check,
  Kanban,
  List,
  Loader2,
  Moon,
  Package,
  PlugZap,
  Settings,
  Sun,
  SunDim,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-config";
import { safeBannerImage } from "@/lib/banner-image";
import Attribution from "@/components/board/attribution";
import type { StoreStatus } from "@/lib/store/store";
import type { BoardSettings } from "@/lib/types";
import { BoardPicker } from "./board-picker";

/** `files` is gone for good. The other three are the whole app. */
export type ViewMode = "kanban" | "list" | "deliverables";

const VIEWS = [
  { key: "kanban", label: "Board", Icon: Kanban },
  { key: "list", label: "List", Icon: List },
  { key: "deliverables", label: "Deliverables", Icon: Package },
] as const;

/* ─────────────────────────────── Banner ─────────────────────────────── */

/**
 * Used when a board has no `accent`, or has one we refuse to render.
 * Network-free by construction.
 */
const DEFAULT_ACCENT =
  "linear-gradient(120deg, rgb(var(--primary-rgb) / 0.55) 0%, rgb(var(--primary-rgb) / 0.18) 55%, rgb(var(--primary-rgb) / 0.06) 100%)";

const GRADIENT_PREFIXES = [
  "linear-gradient(",
  "radial-gradient(",
  "conic-gradient(",
  "repeating-linear-gradient(",
  "repeating-radial-gradient(",
];

/**
 * `settings.accent` is applied to a `style` prop verbatim, and a BoardDoc can
 * arrive from an **imported file the user did not write**. `lib/types.ts` flags
 * this precise hazard and says to gate it "at the render site" — this is that
 * site.
 *
 * Unsanitised, `accent: "url(https://evil/x.png)"` turns opening a shared board
 * into a network beacon that silently leaks the user's IP and open-time. That is
 * a total inversion of the product's one promise ("your work stays on your
 * machine"), and it would look like a perfectly normal banner. So: an allowlist
 * of gradient functions, all of which paint offline. Anything else falls back.
 *
 * `bannerUrl` has its own gate with the same duty: `safeBannerImage` renders
 * `data:image/…` URIs only. A data URI travels inside the document, so it works
 * offline, from `file://`, and in a desktop build — a REMOTE image url would be
 * both a broken image in all of those and a network beacon in the browser, so
 * it still refuses to render. See `lib/banner-image.ts`.
 */
function safeAccent(accent: string | null): string {
  if (!accent) return DEFAULT_ACCENT;
  const value = accent.trim();
  if (!GRADIENT_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return DEFAULT_ACCENT;
  }
  // Belt and braces: `url()` inside a gradient is not valid CSS, so this should
  // be unreachable — but "should be unreachable" is not a security boundary.
  if (/url\s*\(/i.test(value)) return DEFAULT_ACCENT;
  return value;
}

/* ──────────────────────────── Save status ──────────────────────────── */

/**
 * The whole reason `BoardStore` surfaces `status.error` instead of swallowing it.
 *
 * A tool that promises "your data never leaves your machine" and then fails to
 * write it — quota exhausted, Safari private mode, a corrupt document that
 * suspended autosave, a file whose permission was withdrawn — while showing a
 * calm "Saved" is worse than one that never made the promise. The user is typing
 * into a void and will not find out until the session is gone. So the failure
 * state is LOUD, red, and tells them the one action that always saves their work:
 * export.
 *
 * The success state NAMES THE SINK — "Saved · browser storage" or "Saved ·
 * board.wtboard.json". A bare "Saved" is the bug this replaces: with two possible
 * destinations, a user who attached a file and a user who never did see exactly
 * the same word, and one of them is wrong about where their work is. `sinkLabel`
 * is derived from `status.adapterId` (the store's live adapter), not from the
 * UI's own idea of what it attached, so it cannot drift.
 */
function SaveStatus({
  status,
  sinkLabel,
  onOpenSettings,
}: {
  status: StoreStatus;
  sinkLabel: string;
  onOpenSettings: () => void;
}) {
  const broken = status.error !== null || status.suspended;

  if (broken) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        title={
          status.error?.message ??
          "Autosave is halted because the saved board could not be read."
        }
        className="flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/15 px-2.5 py-1.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/25"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>NOT SAVING — export now</span>
      </button>
    );
  }

  // `pending` is set the instant a mutation commits, before the debounce fires.
  // Folding it in with `saving` keeps the indicator honest during that window
  // rather than showing a stale "Saved" over changes that are still only in RAM.
  if (status.state === "saving" || status.pending) {
    return (
      <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (status.state === "saved" || status.lastSavedAt !== null) {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground"
        title={
          status.lastSavedAt
            ? `Last saved ${new Date(status.lastSavedAt).toLocaleTimeString()} — to ${sinkLabel}`
            : undefined
        }
      >
        <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
        <span className="truncate">
          Saved · <span className="text-foreground">{sinkLabel}</span>
        </span>
      </span>
    );
  }

  // Nothing written, nothing pending — a board that has not been touched yet.
  // Claiming "Saved" here would be a lie during prerender, when no adapter is
  // even attached.
  return null;
}

/**
 * A file is remembered for this board but the browser dropped its permission on
 * reload, so the board is saving to localStorage only. Not an error — nothing is
 * lost, nothing is failing — but the user believes their file is being kept up to
 * date, and it is not. That gap is the whole reason this pill exists.
 *
 * It cannot request the permission itself (well, a click *is* a gesture — but the
 * reconnect flow reads the file, may replace the board, and can fail; that
 * belongs next to its own explanation). So it opens the sheet, where the button
 * lives.
 */
function ReconnectPill({
  name,
  onOpenSettings,
}: {
  name: string;
  onOpenSettings: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpenSettings}
      title={`“${name}” is not being updated — browsers forget file permission on reload. Click to reconnect it.`}
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-orange-500/40 bg-orange-500/10 px-2 py-1 text-xs font-semibold text-orange-500 transition-colors hover:bg-orange-500/20"
    >
      <PlugZap className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[10rem] truncate">Reconnect {name}</span>
    </button>
  );
}

/* ──────────────────────────── Theme toggle ──────────────────────────── */

/**
 * Cycles light → dim → dark. The icon shows the CURRENT theme; the title says
 * where the next click goes, so three states stay discoverable from one button.
 *
 * `next-themes` cannot know the resolved theme until it has read the DOM, so the
 * server render and the first client render MUST NOT depend on it. Rendering the
 * icon straight from `resolvedTheme` is the classic hydration mismatch: the
 * prerender emits a sun, the client wants a moon, and React quietly swaps the
 * tree.
 *
 * Until mounted we render a same-size inert placeholder — deterministic on both
 * passes, and it reserves the space so the header does not shift when the real
 * button arrives.
 */
const THEME_CYCLE = ["light", "dim", "dark"] as const;
type ThemeName = (typeof THEME_CYCLE)[number];

const THEME_ICONS: Record<ThemeName, typeof Sun> = {
  light: Sun,
  dim: SunDim,
  dark: Moon,
};

function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-8 w-8" aria-hidden />;

  // `resolvedTheme` is "light" or "dark" when following the system, and the
  // literal theme name otherwise — so "dim" arrives here as itself.
  const current: ThemeName = (THEME_CYCLE as readonly string[]).includes(
    resolvedTheme ?? "",
  )
    ? (resolvedTheme as ThemeName)
    : "light";
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
  const Icon = THEME_ICONS[current];
  const label = `Theme: ${current}. Switch to ${next}.`;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      title={label}
      aria-label={label}
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

/* ───────────────────────────── HeaderBar ───────────────────────────── */

interface Props {
  /** The live document's `name`. Falls back to APP_NAME so the banner is never blank. */
  boardName: string;
  settings: BoardSettings;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  /** From `useBoardStatus(store)`. Drives the save indicator — including its failure state. */
  status: StoreStatus;
  /**
   * Where saves are actually going, in words: `"browser storage"` or the file
   * name. Derived from the store's live `adapterId`, so it tells the truth even
   * if the UI's own file state is mid-flight.
   */
  sinkLabel: string;
  /**
   * A file this board remembers but is NOT currently writing to (permission was
   * dropped on reload). `null` in every other case, including the happy one.
   */
  reconnectFile: string | null;
  /** Opens the settings sheet, which owns rename / file / Export JSON / Import JSON / delete. */
  onOpenSettings: () => void;
  /** Opens the archive sheet. The button carries a count badge when non-zero. */
  onOpenArchive: () => void;
  archivedCount: number;
}

export function HeaderBar({
  boardName,
  settings,
  view,
  onViewChange,
  status,
  sinkLabel,
  reconnectFile,
  onOpenSettings,
  onOpenArchive,
  archivedCount,
}: Props) {
  const title = boardName.trim() || APP_NAME;
  const subtitle =
    settings.clientName && settings.phase
      ? `${settings.clientName} · ${settings.phase}`
      : (settings.clientName ?? settings.phase ?? null);

  return (
    <div className="space-y-4">
      {/* Banner with the board title overlaid (opaque card, top-left). The overlay
          floats over the gradient so a long board name auto-sizes its own card
          without resizing any of the layout cells below. */}
      <div
        className="relative w-full overflow-hidden rounded-lg border border-border"
        style={{ aspectRatio: "40 / 7" }}
      >
        {(() => {
          // A custom image wins over the gradient; both gates fall back safely.
          const image = safeBannerImage(settings.bannerUrl);
          return (
            <div
              className="h-full w-full"
              style={
                image
                  ? {
                      backgroundImage: `url("${image}")`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : { backgroundImage: safeAccent(settings.accent) }
              }
            />
          );
        })()}
        <div className="absolute left-4 top-4 inline-block rounded-lg border border-border bg-card px-4 py-2">
          <h1 className="text-base font-bold tracking-tight text-foreground">
            {title}
          </h1>
          {subtitle && (
            <span className="block text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>

        <Attribution className="absolute right-3 top-3" />
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        {/* Cell 1 — board picker */}
        <div className="flex items-center rounded-lg border border-border bg-card/60 p-2">
          <BoardPicker />
        </div>

        {/* Cell 2 — view toggle, stretches to fill the cell */}
        <div className="flex items-center rounded-lg border border-border bg-card/60 p-2">
          <div className="grid w-full grid-cols-3 gap-1">
            {VIEWS.map(({ key, label, Icon }) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onViewChange(key)}
                  aria-pressed={active}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors ${
                    active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : // The private app used `text-amber-400` here. It is dark-only;
                        // this app ships light + dark, and amber-400 on a white card is
                        // unreadable. Re-keyed to theme tokens, matching stats-card.
                        "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cell 3 — save status, theme, settings */}
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border bg-card/60 px-4 py-3">
          {reconnectFile && (
            <ReconnectPill name={reconnectFile} onOpenSettings={onOpenSettings} />
          )}
          <SaveStatus
            status={status}
            sinkLabel={sinkLabel}
            onOpenSettings={onOpenSettings}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenArchive}
            title={
              archivedCount > 0
                ? `Archive (${archivedCount} card${archivedCount === 1 ? "" : "s"})`
                : "Archive"
            }
            aria-label="Open the archive"
            className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Archive className="h-4 w-4" />
            {archivedCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
                {archivedCount > 99 ? "99+" : archivedCount}
              </span>
            )}
          </Button>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenSettings}
            title="Board settings"
            aria-label="Board settings"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
