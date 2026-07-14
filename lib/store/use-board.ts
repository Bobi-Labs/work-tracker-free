"use client";

/**
 * React bindings — `useSyncExternalStore` over the in-memory document.
 *
 * ⚠️ The single rule that makes a static export work:
 *
 *   **`getServerSnapshot()` must never touch `window` or `localStorage`.**
 *
 * `output: 'export'` does not mean "no server rendering" — it means the server
 * rendering happens on *your machine, at build time*. Every component here is
 * prerendered into `out/index.html` by Node, where `localStorage` does not
 * exist. Reading it during render is either a build-time crash or, worse, a
 * hydration mismatch that React papers over by silently re-rendering with the
 * wrong tree.
 *
 * So the server snapshot is a frozen, empty, referentially-stable document, the
 * first client render matches it exactly, and the real data arrives from
 * `hydrate()` inside an effect — one frame later, after hydration is complete.
 */

import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { BoardDoc, WorkspaceIndex } from "../types";
import type { BoardStore, StoreStatus } from "./store";
import type { Workspace } from "./workspace";

/* ─────────────────────────────── Board ─────────────────────────────── */

export function useBoard(store: BoardStore): BoardDoc {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}

/**
 * Save state — `saving` / `saved` / `error`. Render the error. A tool whose
 * pitch is "your data never leaves your machine" that fails to write and says
 * nothing is worse than one that never claimed it.
 *
 * `getStatus` is safe as the server snapshot: it reads no browser API, and the
 * store freezes each status object so the reference only changes when the status
 * actually does (which is what `useSyncExternalStore` compares).
 */
export function useBoardStatus(store: BoardStore): StoreStatus {
  return useSyncExternalStore(store.subscribe, store.getStatus, store.getStatus);
}

/* ───────────────────────────── Workspace ───────────────────────────── */

export function useWorkspaceIndex(workspace: Workspace): WorkspaceIndex {
  return useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getServerSnapshot,
  );
}

/* ────────────────────────────── Context ────────────────────────────── */

const BoardStoreContext = createContext<BoardStore | null>(null);
const WorkspaceContext = createContext<Workspace | null>(null);

export interface StoreProviderProps {
  store: BoardStore;
  workspace: Workspace;
  children: ReactNode;
}

/**
 * `createElement` rather than JSX so this stays a `.ts` file — the store layer
 * has exactly one React dependency and no markup.
 */
export function StoreProvider({
  store,
  workspace,
  children,
}: StoreProviderProps) {
  return createElement(
    WorkspaceContext.Provider,
    { value: workspace },
    createElement(BoardStoreContext.Provider, { value: store }, children),
  );
}

export function useBoardStore(): BoardStore {
  const store = useContext(BoardStoreContext);
  if (!store) {
    throw new Error("useBoardStore must be used inside <StoreProvider>.");
  }
  return store;
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used inside <StoreProvider>.");
  }
  return workspace;
}

/** The active document, from context. The common case. */
export function useBoardDoc(): BoardDoc {
  return useBoard(useBoardStore());
}
