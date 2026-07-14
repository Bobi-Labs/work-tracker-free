"use client";

/**
 * Board picker — the pill group from the private app's `board-switcher.tsx`,
 * with its entire model thrown away.
 *
 * What went: the `company | team | personal` Scope union, SCOPE_LABELS, the
 * `owner_id === currentUserProfileId` preference (there is one user, and it is
 * you), and `router.push('/tracker/' + id)`.
 *
 * What replaced it: a flat, unbounded list of the boards in the Workspace.
 *
 * ⚠️ THERE IS NO DYNAMIC ROUTE, AND THERE CANNOT BE ONE.
 * Board ids are runtime UUIDs, so `generateStaticParams()` can never enumerate
 * them, and `output: 'export'` refuses to build a `[boardId]` segment it cannot
 * enumerate. The active board is application state; the URL carries it only as a
 * `#board=<id>` hash. A hash never reaches a server, so it cannot 404 — which is
 * exactly what a static host, a `file://` open, and a Tauri window all need.
 *
 * ⚠️ BOARDS ARE UNLIMITED. No cap here, no cap in `workspace.ts`, no cap ever.
 *
 * ── The contract with board-app ──────────────────────────────────────────────
 * This component commits the *workspace* half of a switch — `setActiveBoard()`
 * plus the hash — and nothing else. It never touches the BoardStore, because
 * loading a document is asynchronous and can come back `corrupt`, and only
 * board-app can render that.
 *
 * So board-app MUST react to `activeBoardId`:
 *
 *   const index = useWorkspaceIndex(workspace);
 *   useEffect(() => {
 *     const id = index.activeBoardId;
 *     if (!id) return;
 *     store.attachAdapter(workspace.adapterFor(id));
 *     void store.hydrate().then((r) => { ... handle 'corrupt' / 'error' ... });
 *   }, [index.activeBoardId]);
 *
 * That one effect covers selecting a board, creating a board, importing over a
 * board, and deleting a board (the workspace re-points `activeBoardId` at the
 * next survivor on its own). If it is missing, the picker highlights the new
 * pill and the board underneath never changes — it renders perfectly and is
 * silently wrong.
 *
 * On first mount, board-app should seed the workspace from the hash so a
 * deep link opens the right board:
 *
 *   const fromHash = readBoardHash();
 *   if (fromHash && index.boards.some((b) => b.id === fromHash)) {
 *     workspace.setActiveBoard(fromHash);
 *   }
 *
 * (Guard it on the board actually existing — a stale link to a deleted board
 * must fall back to the workspace's own active board, not blank the app.)
 */

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StoreError } from "@/lib/store";
import { useWorkspace, useWorkspaceIndex } from "@/lib/store/use-board";
import type { BoardRef } from "@/lib/types";

/* ───────────────────────────────── The hash ─────────────────────────────────
 * The only piece of routing this app has. Exported so board-app can read it on
 * mount without importing the picker's internals.
 */

export const BOARD_HASH_PREFIX = "#board=";

/** The board id in the URL hash, or `null`. Safe to call during prerender. */
export function readBoardHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith(BOARD_HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(BOARD_HASH_PREFIX.length));
  return id === "" ? null : id;
}

/**
 * Write the board id into the URL.
 *
 * `history.replaceState` rather than `location.hash = …` on purpose: assigning
 * to `location.hash` pushes a history entry AND fires `hashchange`, so a Back
 * press would walk a trail of board ids and any `hashchange` listener would
 * echo a switch the app has already made. Replacing does neither — the link is
 * copy-pasteable, and that is all it is for.
 */
export function writeBoardHash(id: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = id === null ? "" : `board=${encodeURIComponent(id)}`;
  window.history.replaceState(null, "", url.toString());
}

/* ─────────────────────────────── Component ─────────────────────────────── */

interface Props {
  className?: string;
}

export function BoardPicker({ className }: Props) {
  const workspace = useWorkspace();
  const index = useWorkspaceIndex(workspace);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Most-recently-updated first — same ordering `workspace.list()` uses. Sorted
  // here (not by calling `list()`) so the memo keys off the snapshot React is
  // actually subscribed to.
  const boards = useMemo(
    () => [...index.boards].sort(byUpdatedAtDesc),
    [index.boards],
  );

  const select = (id: string) => {
    if (id === index.activeBoardId) return;
    setError(null);
    workspace.setActiveBoard(id);
    writeBoardHash(id);
    // The document load is board-app's, keyed on `activeBoardId`. See the note
    // at the top of this file.
  };

  const create = () => {
    setError(null);
    try {
      // `createBoard()` writes the document, adds the index entry, AND makes it
      // active — so board-app's `activeBoardId` effect picks it up with no
      // further help from us.
      const doc = workspace.createBoard(name.trim() || undefined);
      writeBoardHash(doc.id);
      setName("");
      setCreating(false);
    } catch (e) {
      // Quota. Real, and survivable only if we say so — a "New board" button
      // that silently does nothing is how a user loses faith in a local tool.
      setError(
        e instanceof StoreError
          ? e.message
          : "Could not create the board. Your browser may be out of storage.",
      );
    }
  };

  const cancelCreate = () => {
    setName("");
    setCreating(false);
    setError(null);
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1">
        {boards.map((board) => (
          <BoardPill
            key={board.id}
            board={board}
            active={board.id === index.activeBoardId}
            onSelect={select}
          />
        ))}

        {creating ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelCreate();
                }
              }}
              placeholder="Board name"
              aria-label="New board name"
              className="h-9 w-44"
            />
            <Button size="sm" onClick={create}>
              <Check className="h-4 w-4" />
              Create
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={cancelCreate}
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-4 w-4" />
            New board
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────── The pill ─────────────────────────────── */

interface PillProps {
  board: BoardRef;
  active: boolean;
  onSelect: (id: string) => void;
}

function BoardPill({ board, active, onSelect }: PillProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(board.id)}
      aria-current={active ? "true" : undefined}
      title={board.name}
      className={`flex max-w-[14rem] items-center justify-center gap-1.5 truncate rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className="truncate">{board.name || "Untitled board"}</span>
    </button>
  );
}

function byUpdatedAtDesc(a: BoardRef, b: BoardRef): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}
