"use client";

/**
 * The whole app. One route, and there can only ever be one.
 *
 * `output: 'export'` + a dynamic `[boardId]` segment is impossible: board ids are
 * runtime UUIDs, so `generateStaticParams()` can never enumerate them and the
 * build refuses. The active board is application state, carried in the URL as a
 * `#board=<id>` hash — a hash never reaches a server, so it cannot 404 on a static
 * host, from `file://`, or inside a desktop shell. See `board-picker.tsx`.
 *
 * ⚠️ THE HYDRATION RULE. `output: 'export'` does not mean "no server render" — it
 * means the server render happens on the build machine, in Node, where
 * `localStorage` does not exist. So:
 *
 *   - Nothing on the first render pass may touch `window` or `localStorage`.
 *   - `workspace.hydrate()` (sync, reads localStorage) and `store.hydrate()`
 *     (async) both run inside `useEffect`, never during render.
 *   - Until `booted`, we render a skeleton that is byte-identical on the
 *     prerender and the first client pass.
 *
 * Constructing the store and workspace during render IS safe, and deliberately so:
 * `createBoardStore()` guards its lifecycle listeners on `typeof document`, and
 * `browserKV()` only builds closures — neither reads a browser API until called.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, Sparkles, Trash2 } from "lucide-react";

import Attribution from "@/components/board/attribution";
import { BoardApp } from "@/components/board/board-app";
import { readBoardHash, writeBoardHash } from "@/components/board/board-picker";
import { Button } from "@/components/ui/button";
import { APP_NAME, APP_TAGLINE } from "@/lib/app-config";
import { createSampleBoard } from "@/lib/seed/sample-board";
import {
  StoreError,
  StoreProvider,
  browserKV,
  createBoardStore,
  createEmptyDoc,
  createWorkspace,
  type BoardStore,
  type Workspace,
} from "@/lib/store";
import { useWorkspace, useWorkspaceIndex } from "@/lib/store/use-board";

/* ─────────────────────────────── Load state ─────────────────────────────── */

type BoardState =
  /** No board is active — first run, or the last board was just deleted. */
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ready" }
  /** The persisted bytes did not parse. Autosave is suspended; `raw` is preserved. */
  | { kind: "corrupt"; message: string; raw: string }
  /** The adapter itself failed — storage disabled, private mode, permissions. */
  | { kind: "error"; message: string };

/* ─────────────────────────────── Page ─────────────────────────────── */

export default function Page() {
  // Created once, on the first render, and never replaced. Both are prerender-safe
  // (see the header note) — but neither may be *used* until the mount effect runs.
  const [store] = useState<BoardStore>(() => createBoardStore());
  const [workspace] = useState<Workspace>(() => createWorkspace(browserKV()));

  return (
    <StoreProvider store={store} workspace={workspace}>
      <Shell store={store} />
    </StoreProvider>
  );
}

/**
 * Split from `Page` so it can consume the workspace through the same context the
 * board picker does — the picker commits a switch by calling
 * `workspace.setActiveBoard()`, and the effect below is the only thing that turns
 * that into a loaded document. One effect covers select, create, import-over, and
 * delete (the workspace re-points `activeBoardId` at the next survivor itself).
 */
function Shell({ store }: { store: BoardStore }) {
  const workspace = useWorkspace();
  const index = useWorkspaceIndex(workspace);
  const activeBoardId = index.activeBoardId;

  const [booted, setBooted] = useState(false);
  const [board, setBoard] = useState<BoardState>({ kind: "none" });

  /* ── mount: read the workspace index, then honour a deep link ── */
  useEffect(() => {
    // Best-effort plea against browser-initiated eviction: Safari deletes
    // script-writable storage after 7 days without a visit, and any browser
    // may evict under storage pressure. persist() exempts the origin where
    // the browser honours it; a denial changes nothing. Export and
    // file-attach remain the real safety net either way.
    navigator.storage?.persist?.().catch(() => {});

    workspace.hydrate();

    const fromHash = readBoardHash();
    // Guarded on the board still existing. A stale link to a board that was
    // deleted must fall back to the workspace's own active board, not blank the
    // app on a board id that no longer resolves to anything.
    if (fromHash && workspace.list().some((b) => b.id === fromHash)) {
      workspace.setActiveBoard(fromHash);
    }

    setBooted(true);

    // No `store.destroy()` cleanup on purpose. React Strict Mode double-invokes
    // effects in dev; `destroy()` is permanent (it latches `destroyed` and drops
    // every listener), so a cleanup here would leave the second mount holding a
    // dead store that renders fine and never saves. The store lives as long as the
    // page does, and the page IS the app.
  }, [workspace]);

  /* ── the active board: attach its adapter and load it ── */
  useEffect(() => {
    if (!booted) return;

    if (!activeBoardId) {
      setBoard({ kind: "none" });
      return;
    }

    let cancelled = false;
    setBoard({ kind: "loading" });
    writeBoardHash(activeBoardId);
    store.attachAdapter(workspace.adapterFor(activeBoardId));

    void store.hydrate().then((result) => {
      if (cancelled) return;

      switch (result.status) {
        case "loaded":
          setBoard({ kind: "ready" });
          break;

        case "empty": {
          // The index knows this board; storage does not have it. (Another tab
          // cleared the key, or a write was lost.) Heal in place, KEEPING THE ID —
          // the store is bound to a storage key derived from it, and minting a new
          // one would orphan the index entry. Non-destructive: there was nothing
          // to lose, and we delete nothing.
          const ref = index.boards.find((b) => b.id === activeBoardId);
          store.replaceDoc({
            ...createEmptyDoc(ref?.name ?? "My Board"),
            id: activeBoardId,
          });
          setBoard({ kind: "ready" });
          break;
        }

        case "corrupt":
          // The store has already SUSPENDED autosave. We will not write over bytes
          // we could not read — that is how you eat someone's data.
          setBoard({
            kind: "corrupt",
            message: result.error.message,
            raw: result.raw,
          });
          break;

        case "error":
          setBoard({ kind: "error", message: result.error.message });
          break;
      }
    });

    return () => {
      cancelled = true;
    };
    // `index.boards` is read only inside the `empty` branch, as a name lookup —
    // re-running this effect whenever any board's name changes would pointlessly
    // re-hydrate the open board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, activeBoardId, store, workspace]);

  /* Keeping the workspace index in step with the live document is BoardApp's job,
   * not this component's. Shell subscribes to the workspace index only — it does
   * not subscribe to the board doc, so it does not re-render when an item changes,
   * and an index-sync effect here would simply never fire. See board-app.tsx. */

  /* ── render ── */

  if (!booted) return <Skeleton />;

  if (index.boards.length === 0) {
    return <FirstRun workspace={workspace} />;
  }

  if (board.kind === "corrupt") {
    return (
      <CorruptBoard
        message={board.message}
        raw={board.raw}
        boardId={activeBoardId}
        store={store}
        workspace={workspace}
        onRecovered={() => setBoard({ kind: "ready" })}
      />
    );
  }

  if (board.kind === "error") return <LoadError message={board.message} />;

  if (board.kind !== "ready") return <Skeleton />;

  return <BoardApp />;
}

/* ─────────────────────────────── Skeleton ───────────────────────────────
 * Static markup, no client-only state — byte-identical on the prerender and the
 * first client pass, which is the entire point.
 */

function Skeleton() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-4 md:px-6">
      <div className="h-[168px] w-full animate-pulse rounded-lg border border-border bg-card/60" />
      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg border border-border bg-card/60"
          />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-border bg-card/60"
          />
        ))}
      </div>
      <div className="mt-4 h-64 animate-pulse rounded-lg border border-border bg-card/60" />
      <span className="sr-only">Loading your board…</span>
    </main>
  );
}

/* ─────────────────────────────── First run ─────────────────────────────── */

function FirstRun({ workspace }: { workspace: Workspace }) {
  const [error, setError] = useState<string | null>(null);

  // Both paths write the document to storage AND set it active, so the Shell's
  // `activeBoardId` effect picks it up and hydrates it. One code path, no
  // special-casing of "the board we just made".
  const startEmpty = useCallback(() => {
    setError(null);
    try {
      workspace.createBoard();
    } catch (e) {
      setError(messageFor(e, "Could not create the board."));
    }
  }, [workspace]);

  const loadSample = useCallback(() => {
    setError(null);
    try {
      workspace.addBoard(createSampleBoard());
    } catch (e) {
      setError(messageFor(e, "Could not create the sample board."));
    }
  }, [workspace]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {APP_NAME}
          </h1>
          <p className="mt-3 text-balance text-muted-foreground">{APP_TAGLINE}</p>
        </div>

        {/* The first-run screen is the only thing a brand-new visitor sees before
            they commit to anything, so it is the one surface the attribution
            cannot be missing from. The banner copy carries it once a board
            exists; this carries it before one does. */}
        <Attribution className="shrink-0" />
      </div>

      <div className="hover-card-lift rounded-lg border border-border bg-card p-6">
        <h2 className="text-base font-semibold text-card-foreground">
          Start your first board
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything you add is saved in this browser, on this device. No account,
          no server, nothing to sign up for.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button onClick={startEmpty} className="sm:flex-1">
            Start empty
          </Button>
          <Button variant="outline" onClick={loadSample} className="sm:flex-1">
            <Sparkles className="h-4 w-4" />
            Load sample board
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          The sample board is a fictional project with 15 items and a handful of
          deliverables, a fast way to see what the tool does. You can delete it at
          any time, and it never touches the network.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-1.5 text-sm text-red-400"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </main>
  );
}

/* ─────────────────────────────── Corrupt ───────────────────────────────
 * The one screen in this app where the user can lose data, so it is the one screen
 * that must not be clever. Autosave is already suspended by the store. We offer the
 * damaged bytes back to them FIRST, and only then offer to overwrite.
 */

function CorruptBoard({
  message,
  raw,
  boardId,
  store,
  workspace,
  onRecovered,
}: {
  message: string;
  raw: string;
  boardId: string | null;
  store: BoardStore;
  workspace: Workspace;
  onRecovered: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);

  const download = () => {
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `damaged-board-${boardId ?? "unknown"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const startOver = () => {
    if (!boardId) return;
    // `replaceDoc` clears the suspension and lets autosave overwrite the damaged
    // bytes — BECAUSE THE USER ASKED IT TO, having been offered the file first.
    const ref = workspace.list().find((b) => b.id === boardId);
    store.replaceDoc({
      ...createEmptyDoc(ref?.name ?? "My Board"),
      id: boardId,
    });
    onRecovered();
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-red-400">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          This board could not be read
        </h1>

        <p className="mt-3 text-sm text-muted-foreground">{message}</p>

        <p className="mt-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Nothing has been deleted.</strong>{" "}
          Saving is paused so that the damaged data is not overwritten. Download it
          first: a broken file can often be repaired by hand, and it is the only
          copy that exists.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button onClick={download} className="sm:flex-1">
            <Download className="h-4 w-4" />
            Download the damaged file
          </Button>

          {confirmReset ? (
            <Button
              variant="destructive"
              onClick={startOver}
              className="sm:flex-1"
            >
              <Trash2 className="h-4 w-4" />
              Yes, erase it and start over
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setConfirmReset(true)}
              className="sm:flex-1"
            >
              Discard and start over
            </Button>
          )}
        </div>

        {confirmReset && (
          <p className="mt-3 text-xs text-muted-foreground">
            This permanently replaces the damaged board with an empty one. It cannot
            be undone.
          </p>
        )}
      </div>
    </main>
  );
}

/* ─────────────────────────────── Load error ─────────────────────────────── */

function LoadError({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-red-400">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          Could not open this board
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {APP_NAME} stores boards in this browser’s local storage. If you are in a
          private window, or site data is blocked for this page, there is nowhere for
          it to read from or write to.
        </p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 shrink-0" />
          Reload the page after enabling site data to try again.
        </p>
      </div>
    </main>
  );
}

/* ─────────────────────────────── Bits ─────────────────────────────── */

function messageFor(e: unknown, fallback: string): string {
  if (e instanceof StoreError) return e.message;
  return `${fallback} Your browser may be out of storage.`;
}
