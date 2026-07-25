"use client";

/**
 * Board settings — a Sheet, deliberately, and NOT a route.
 *
 * ⚠️ `output: 'export'` + a second route = a 404 on hard-refresh. A static host
 * serves `/settings/` only if a `settings/index.html` exists, and a Tauri window
 * loading from `file://` has no server to ask at all. Every affordance in this
 * app lives on one page. Do not "promote this to /settings" — it will work in
 * `next dev` and break for every real user.
 *
 * Contents: rename, client/phase, accent, **where this board saves**, Export JSON,
 * Import JSON, delete, and the honest note about where the data actually lives.
 * Those last two are a requirement, not decoration — the whole pitch of this tool
 * is that nothing leaves the machine, and the cost of that promise is that
 * clearing site data erases the board. A user who was never told is a user we
 * lied to. The same rule is why the file section states plainly, in both
 * configurations, which sink the next keystroke lands in.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  FileJson,
  FilePlus2,
  HardDrive,
  ImagePlus,
  Link2Off,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { APP_NAME } from "@/lib/app-config";
import { processBannerImage, safeBannerImage } from "@/lib/banner-image";
import { CorruptDocError } from "@/lib/schema";
import {
  useBoardDoc,
  useBoardStatus,
  useBoardStore,
  useWorkspace,
} from "@/lib/store/use-board";

/* ─────────────────────────────── Banner ───────────────────────────────
 * Two kinds, one policy: everything renders offline.
 *
 * Gradients are CSS values; a custom image is a local file downscaled on a
 * canvas and stored INSIDE the document as a `data:image/…` URI (see
 * `lib/banner-image.ts`). A *remote* image URL is still deliberately
 * unsupported — it renders as a broken box the moment the user is offline,
 * opens the export as `file://`, or runs the Tauri build, i.e. in exactly the
 * situations this app exists for; and on an imported board it would be a
 * network beacon.
 */

export interface AccentOption {
  id: string;
  label: string;
  /** A CSS `background-image` value, or `null` for no accent. */
  value: string | null;
}

export const ACCENTS: AccentOption[] = [
  { id: "none", label: "None", value: null },
  {
    id: "indigo",
    label: "Indigo",
    value: "linear-gradient(120deg, #6366f1 0%, #8b5cf6 45%, #0ea5e9 100%)",
  },
  {
    id: "ember",
    label: "Ember",
    value: "linear-gradient(120deg, #f59e0b 0%, #f43f5e 100%)",
  },
  {
    id: "forest",
    label: "Forest",
    value: "linear-gradient(120deg, #10b981 0%, #0d9488 55%, #0f766e 100%)",
  },
  {
    id: "dusk",
    label: "Dusk",
    value: "linear-gradient(120deg, #7c3aed 0%, #db2777 100%)",
  },
  {
    id: "graphite",
    label: "Graphite",
    value: "linear-gradient(120deg, #334155 0%, #64748b 100%)",
  },
];

/**
 * `settings.accent` is applied verbatim to a `style` prop at the render site,
 * and an *imported* board can contain anything at all — including
 * `url(https://tracker.example/pixel.png)`, which would turn opening a board
 * into a network beacon in an app whose entire promise is that it makes no
 * requests. Gate every render of `accent` on this.
 */
export function safeAccent(accent: string | null | undefined): string | null {
  if (!accent) return null;
  return accent.startsWith("linear-gradient(") ? accent : null;
}

/* ──────────────────────── Where this board saves ────────────────────────
 * The state machine lives in `board-app.tsx` (it is the only component that
 * survives the board's whole lifetime and owns the store's adapter). The types
 * live HERE, with the UI that renders them, so that `board-app → settings-sheet`
 * stays a one-way import — the reverse direction would be a cycle.
 */

export type BoardFileState =
  /** No File System Access API — Firefox, Safari. A supported configuration, not an error. */
  | { kind: "unsupported" }
  /** The API exists; this board has no file. localStorage only. */
  | { kind: "none" }
  /** Saving to both this browser and the named file. */
  | { kind: "attached"; name: string }
  /** A file is remembered, but the browser dropped its permission on reload. Only a click can restore it. */
  | { kind: "needs-reconnect"; name: string }
  /** The user refused the permission prompt. */
  | { kind: "denied"; name: string };

export interface BoardFileControls {
  state: BoardFileState;
  /** A picker or a file read is in flight. Disables the buttons; they are all destructive-ish. */
  busy: boolean;
  error: string | null;
  notice: string | null;
  /**
   * A file the user picked with "Open a board file…" whose contents would
   * REPLACE this board. Held unapplied until they confirm — same rule as import.
   */
  pendingOpen: { name: string } | null;
  /** True while an attached file is failing to save for want of permission. */
  needsReconnect: boolean;
  saveToFile: () => void;
  openFile: () => void;
  confirmOpen: () => void;
  cancelOpen: () => void;
  reconnect: () => void;
  detach: () => void;
}

/* ─────────────────────────────── Component ─────────────────────────────── */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** From `useBoardFile()` in board-app. Drives the "Where this board saves" section. */
  file: BoardFileControls;
}

/** A staged, not-yet-applied import. Held so the user can confirm the overwrite. */
interface StagedImport {
  filename: string;
  text: string;
}

export function SettingsSheet({ open, onOpenChange, file }: Props) {
  const store = useBoardStore();
  const workspace = useWorkspace();
  const doc = useBoardDoc();
  const status = useBoardStatus(store);

  const [name, setName] = useState(doc.name);
  const [clientName, setClientName] = useState(doc.settings.clientName ?? "");
  const [phase, setPhase] = useState(doc.settings.phase ?? "");

  const [staged, setStaged] = useState<StagedImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);

  // Re-seed the local fields whenever the sheet opens, or the board underneath
  // changes. The inputs are uncontrolled-ish (local state, committed on blur) so
  // without this they would keep showing the *previous* board's name.
  useEffect(() => {
    if (!open) return;
    setName(doc.name);
    setClientName(doc.settings.clientName ?? "");
    setPhase(doc.settings.phase ?? "");
    setStaged(null);
    setImportError(null);
    setImported(false);
    setConfirmDelete(false);
    setBannerError(null);
    // Intentionally keyed on the board identity, not on every doc mutation —
    // re-seeding mid-typing would fight the user for the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc.id]);

  const activeAccent = useMemo(
    () => safeAccent(doc.settings.accent),
    [doc.settings.accent],
  );

  const bannerImage = useMemo(
    () => safeBannerImage(doc.settings.bannerUrl),
    [doc.settings.bannerUrl],
  );

  const handleBannerFile = async (picked: File) => {
    setBannerBusy(true);
    setBannerError(null);
    try {
      const dataUrl = await processBannerImage(picked);
      store.updateSettings({ bannerUrl: dataUrl });
    } catch (e) {
      setBannerError(
        e instanceof Error ? e.message : "That image could not be used.",
      );
    } finally {
      setBannerBusy(false);
    }
  };

  /**
   * The file name **only when the file is genuinely receiving writes**. An
   * attached-but-unpermitted file is not a second copy of anything, and telling
   * the user "your work is also on disk" while every write to it fails is exactly
   * the false comfort this whole section exists to prevent.
   */
  const fileAttached =
    file.state.kind === "attached" && !file.needsReconnect
      ? file.state.name
      : null;

  /* ── name + settings ── */

  const commitName = () => {
    const next = name.trim();
    if (next === "" || next === doc.name) {
      setName(doc.name); // reject a blank rename rather than persist a nameless board
      return;
    }
    store.renameBoard(next);
    // The workspace index caches the name for the picker. Rename without this
    // and the board pill keeps the old label until the next full rebuild.
    workspace.syncFromDoc(store.getSnapshot());
  };

  const commitClientName = () => {
    const next = clientName.trim() || null;
    if (next === doc.settings.clientName) return;
    store.updateSettings({ clientName: next });
  };

  const commitPhase = () => {
    const next = phase.trim() || null;
    if (next === doc.settings.phase) return;
    store.updateSettings({ phase: next });
  };

  /* ── export ── */

  const handleExport = () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(doc.name)}.wtboard.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ── import ── */

  const handleFile = async (file: File) => {
    setImportError(null);
    setImported(false);
    try {
      // Staged, not applied. Import REPLACES this board, so it gets a confirm.
      setStaged({ filename: file.name, text: await file.text() });
    } catch {
      setStaged(null);
      setImportError("Could not read that file.");
    }
  };

  const applyImport = () => {
    if (!staged) return;
    try {
      store.importJson(staged.text);
      workspace.syncFromDoc(store.getSnapshot());
      setStaged(null);
      setImported(true);
    } catch (e) {
      // `importJson` parses → checks `kind` → checks version → migrates →
      // validates, and throws before it reaches `replaceDoc`. So the board on
      // screen is untouched, and CorruptDocError's message already says which of
      // the four things went wrong. Show it verbatim; do not flatten it to
      // "Import failed".
      setImportError(
        e instanceof CorruptDocError || e instanceof Error
          ? e.message
          : "That file is not a board.",
      );
      setStaged(null);
    }
  };

  /* ── delete ── */

  const handleDelete = () => {
    // Removes the document AND the index entry, and re-points `activeBoardId` at
    // the next surviving board. board-app's `activeBoardId` effect loads it.
    workspace.deleteBoard(doc.id);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Board settings</SheetTitle>
          <SheetDescription>
            Everything here applies to “{doc.name}” only.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-8">
          {/* ── Details ── */}
          <section className="flex flex-col gap-3">
            <Field label="Board name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="My Board"
              />
            </Field>

            <Field label="Client" hint="Optional">
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                onBlur={commitClientName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="—"
              />
            </Field>

            <Field label="Phase" hint="Optional">
              <Input
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                onBlur={commitPhase}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="—"
              />
            </Field>
          </section>

          {/* ── Banner ── */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">Banner</h3>

            {bannerImage ? (
              <div className="flex flex-col gap-2">
                <div
                  className="h-16 w-full rounded-md border border-border"
                  role="img"
                  aria-label="Current banner image"
                  style={{
                    backgroundImage: `url("${bannerImage}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bannerBusy}
                    onClick={() => bannerInput.current?.click()}
                  >
                    <ImagePlus className="h-4 w-4" />
                    Replace image…
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={bannerBusy}
                    onClick={() => store.updateSettings({ bannerUrl: null })}
                  >
                    <X className="h-4 w-4" />
                    Remove image
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={bannerBusy}
                onClick={() => bannerInput.current?.click()}
              >
                <ImagePlus className="h-4 w-4" />
                {bannerBusy ? "Processing…" : "Use your own image…"}
              </Button>
            )}

            <input
              ref={bannerInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                // Reset, or re-picking the same file fires no change event.
                e.target.value = "";
                if (picked) void handleBannerFile(picked);
              }}
            />

            {bannerError && (
              <p role="alert" className="text-sm text-red-400">
                {bannerError}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              The image is resized and stored inside the board itself, so it
              travels with exports and never touches the network.
            </p>

            <div className="mt-1 flex flex-wrap gap-2">
              {ACCENTS.map((accent) => {
                const selected =
                  !bannerImage && (accent.value ?? null) === activeAccent;
                return (
                  <button
                    key={accent.id}
                    type="button"
                    // Picking a gradient is an explicit choice AGAINST the
                    // image — the image renders over the accent, so leaving it
                    // set would make every one of these swatches a dead button.
                    onClick={() =>
                      store.updateSettings({
                        accent: accent.value,
                        bannerUrl: null,
                      })
                    }
                    aria-pressed={selected}
                    title={accent.label}
                    className={`h-9 w-16 rounded-md border transition-all ${
                      selected
                        ? "border-primary ring-2 ring-primary/40"
                        : "border-border hover:border-primary/40"
                    } ${accent.value === null ? "bg-muted" : ""}`}
                    style={
                      accent.value
                        ? { backgroundImage: accent.value }
                        : undefined
                    }
                  >
                    {accent.value === null && (
                      <span className="text-xs text-muted-foreground">None</span>
                    )}
                    <span className="sr-only">{accent.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Where this board saves ── */}
          <FileSection file={file} />

          {/* ── Portability ── */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              Export &amp; import
            </h3>

            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Export board as JSON
            </Button>

            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Reset the input, or picking the SAME file twice fires no
                // change event and the second import silently does nothing.
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <Upload className="h-4 w-4" />
              Import board from JSON
            </Button>

            {staged && (
              <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
                <p className="font-semibold text-orange-400">
                  Replace this board?
                </p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-mono text-xs">{staged.filename}</span>{" "}
                  will replace everything in “{doc.name}”: items, notes and
                  deliverables. This cannot be undone. Export first if you want a
                  copy.
                </p>
                <p className="mt-1 text-muted-foreground">
                  If the file isn’t a valid board, nothing is written and your
                  current board is left exactly as it is.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="destructive" onClick={applyImport}>
                    Replace board
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setStaged(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {importError && (
              <div
                role="alert"
                className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm"
              >
                <p className="flex items-center gap-1.5 font-semibold text-red-400">
                  <AlertTriangle className="h-4 w-4" />
                  Import failed
                </p>
                <p className="mt-1 text-muted-foreground">{importError}</p>
                <p className="mt-1 text-muted-foreground">
                  Nothing was written. Your board is unchanged.
                </p>
              </div>
            )}

            {imported && (
              <p className="text-sm text-green-400">
                Board imported. Your previous board was replaced.
              </p>
            )}
          </section>

          {/* ── Where your data lives ──
           * Must stay true in BOTH configurations. With a file attached, "clearing
           * your browsing data erases it permanently" is no longer true — and
           * scaring a user who has a perfectly good copy on disk into thinking
           * otherwise is its own kind of lie. The copy that survives is named.
           */}
          <section className="rounded-md border border-border bg-muted/40 p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <HardDrive className="h-4 w-4 text-primary" />
              Where your data lives
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {APP_NAME} has no account and no server. Nothing you type here is
              sent anywhere. There is no request to send it in.
            </p>

            {fileAttached ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  This board is written to{" "}
                  <span className="font-mono text-xs text-foreground">
                    {fileAttached}
                  </span>{" "}
                  <strong className="text-foreground">and</strong> to this
                  browser&apos;s local storage, on every change. The file is the
                  copy that survives: clearing your browsing data would drop the
                  browser copy, and the file would still be sitting on your disk.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Back that file up like any other file: a synced folder, a repo,
                  a drive you actually back up. We have no copy of it, because we
                  never had one.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  This board is stored in{" "}
                  <strong className="text-foreground">
                    this browser, on this device
                  </strong>
                  , in its local storage. It is not synced, not backed up, and not
                  visible from any other browser or machine.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Clearing your browsing data, using private/incognito mode, or
                  uninstalling the browser{" "}
                  <strong className="text-foreground">
                    erases it permanently
                  </strong>
                  . There is no copy for us to restore, because we never had one.
                </p>
              </>
            )}

            <p className="mt-2 text-sm text-muted-foreground">
              <strong className="text-foreground">Export regularly.</strong> The
              exported <span className="font-mono text-xs">.wtboard.json</span>{" "}
              is the complete board. Keep it somewhere you back up.
            </p>

            {status.error && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-1.5 text-sm text-red-400"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {status.error.message} Recent changes may not have been saved.
                  Export this board now.
                </span>
              </p>
            )}
          </section>

          {/* ── Danger ── */}
          <section className="flex flex-col gap-2 border-t border-border pt-4">
            {confirmDelete ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <p className="font-semibold text-red-400">
                  Delete “{doc.name}” permanently?
                </p>
                <p className="mt-1 text-muted-foreground">
                  {doc.items.length} item{doc.items.length === 1 ? "" : "s"} and
                  everything on this board will be erased from this browser. This
                  cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="destructive" onClick={handleDelete}>
                    <Trash2 className="h-4 w-4" />
                    Delete board
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                className="justify-start text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Delete this board
              </Button>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ────────────────────────── Where this board saves ──────────────────────────
 * Every branch of this renders a sentence that says, in words, where the next
 * keystroke lands. There is no state in which the user has to infer it.
 *
 * On Firefox and Safari the two buttons are ABSENT, not disabled. A dead control
 * that the user cannot fix — because the fix is "use a different browser" — is
 * worse than no control at all; it reads as a bug in the app. They get a plain
 * sentence and a pointer at Export/Import, which works everywhere.
 */
function FileSection({ file }: { file: BoardFileControls }) {
  const { state } = file;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <FileJson className="h-4 w-4 text-primary" />
        Where this board saves
      </h3>

      {state.kind === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          This browser can&apos;t save a board straight to a file. Only Chrome and
          Edge (on desktop) can. Your board is saved in{" "}
          <strong className="text-foreground">this browser</strong>, and{" "}
          <strong className="text-foreground">Export</strong> below still gives you
          the complete board as a file you can keep, back up, and import anywhere.
        </p>
      )}

      {state.kind === "none" && (
        <>
          <p className="text-sm text-muted-foreground">
            Saving to{" "}
            <strong className="text-foreground">this browser&apos;s storage</strong>
            . Attach a file and every change is written to{" "}
            <strong className="text-foreground">both</strong>. The browser copy
            stays as it is, and the file is yours: keep it in a synced folder, a
            repo, anywhere you already back up.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={file.busy}
              onClick={file.saveToFile}
            >
              <FilePlus2 className="h-4 w-4" />
              Save to a file…
            </Button>
            <Button variant="outline" disabled={file.busy} onClick={file.openFile}>
              <FileJson className="h-4 w-4" />
              Open a board file…
            </Button>
          </div>
        </>
      )}

      {state.kind === "attached" && !file.needsReconnect && (
        <>
          <p className="text-sm text-muted-foreground">
            Saving to{" "}
            <span className="font-mono text-xs text-foreground">{state.name}</span>{" "}
            and to this browser, on every change. Deleting this board in the app{" "}
            <strong className="text-foreground">never</strong> deletes that file.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={file.busy}
              onClick={file.saveToFile}
            >
              <FilePlus2 className="h-4 w-4" />
              Save to a different file…
            </Button>
            <Button variant="ghost" disabled={file.busy} onClick={file.detach}>
              <Link2Off className="h-4 w-4" />
              Stop saving to this file
            </Button>
          </div>
        </>
      )}

      {/* Needs reconnecting: either the permission was dropped on reload, or a save
          to the attached file just failed for want of one. Same fix, same button —
          and it MUST be a button, because `requestPermission()` only runs inside a
          user gesture. There is no way to do this for them on mount. */}
      {(state.kind === "needs-reconnect" ||
        (state.kind === "attached" && file.needsReconnect)) && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
          <p className="font-semibold text-orange-400">
            Reconnect{" "}
            <span className="font-mono text-xs">
              {"name" in state ? state.name : "the file"}
            </span>
          </p>
          <p className="mt-1 text-muted-foreground">
            Browsers forget file permission every time the page reloads. This is
            the browser being careful, not something going wrong. Until you
            reconnect, this board is saving to{" "}
            <strong className="text-foreground">this browser only</strong>. Nothing
            has been lost, and the file on disk is untouched.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={file.busy} onClick={file.reconnect}>
              <RefreshCw className="h-4 w-4" />
              Reconnect {"name" in state ? state.name : "file"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={file.busy}
              onClick={file.detach}
            >
              Stop using it
            </Button>
          </div>
        </div>
      )}

      {state.kind === "denied" && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          <p className="font-semibold text-red-400">
            Permission to use{" "}
            <span className="font-mono text-xs">{state.name}</span> was denied
          </p>
          <p className="mt-1 text-muted-foreground">
            This board is still saving to{" "}
            <strong className="text-foreground">this browser</strong>. Nothing was
            lost. Try again, or pick a different file.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={file.busy} onClick={file.reconnect}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={file.busy}
              onClick={file.saveToFile}
            >
              Pick a different file…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={file.busy}
              onClick={file.detach}
            >
              Stop using it
            </Button>
          </div>
        </div>
      )}

      {/* Opening a file REPLACES this board with its contents. That is the same
          destruction as an import, so it gets the same confirmation — the file is
          read and validated first, and nothing is written until this is clicked. */}
      {file.pendingOpen && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
          <p className="font-semibold text-orange-400">Replace this board?</p>
          <p className="mt-1 text-muted-foreground">
            <span className="font-mono text-xs">{file.pendingOpen.name}</span> has a
            board in it. Opening it replaces everything currently on this board
            (items, notes and deliverables), and from then on this board saves to
            that file. This cannot be undone; export first if you want a copy.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={file.busy}
              onClick={file.confirmOpen}
            >
              Open and replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={file.busy}
              onClick={file.cancelOpen}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {file.error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm"
        >
          <p className="flex items-center gap-1.5 font-semibold text-red-400">
            <AlertTriangle className="h-4 w-4" />
            That didn&apos;t work
          </p>
          <p className="mt-1 text-muted-foreground">{file.error}</p>
        </div>
      )}

      {file.notice && <p className="text-sm text-green-400">{file.notice}</p>}
    </section>
  );
}

/* ─────────────────────────────── Bits ─────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {label}
        {hint && (
          <span className="text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

/** `My Board` → `my-board`. Never empty — a nameless file is a lost file. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "board";
}
