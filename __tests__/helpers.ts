/**
 * Shared test rig.
 *
 * Not a `*.test.ts` file, so vitest does not collect it.
 *
 * The one thing worth reading here is `tick()`. Every timestamp in this app is
 * `new Date().toISOString()` — millisecond resolution. Two mutations in the same
 * test land in the same millisecond, which means "the stamp was preserved" and
 * "the stamp was rewritten" produce the *identical string*. A test that does not
 * advance the clock between writes cannot fail, no matter what the store does.
 * Every timestamp assertion in this suite is separated by a `tick()`.
 */

import { expect, vi } from "vitest";

import { MemoryAdapter } from "../lib/store/adapters/memory";
import { createEmptyDoc } from "../lib/store/board-doc";
import { createBoardStore, type BoardStore } from "../lib/store/store";
import type { BoardDoc, Item } from "../lib/types";

export interface Rig {
  store: BoardStore;
  adapter: MemoryAdapter;
}

/** A store bound to a MemoryAdapter with a loaded (non-empty) board. */
export function rig(options: { debounceMs?: number; initial?: string } = {}): Rig {
  const adapter = new MemoryAdapter(
    options.initial === undefined ? {} : { initial: options.initial },
  );
  const store = createBoardStore({
    adapter,
    debounceMs: options.debounceMs ?? 400,
  });
  store.replaceDoc(createEmptyDoc("Test Board"));
  return { store, adapter };
}

/** Advance the mocked system clock. See the note at the top of this file. */
export function tick(ms = 1000): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

export function itemById(doc: BoardDoc, id: string): Item {
  const item = doc.items.find((i) => i.id === id);
  expect(item, `no item "${id}" in the document`).toBeDefined();
  return item!;
}

/** Only the fields a persisted document is expected to carry across a boundary. */
export function contentOf(doc: BoardDoc) {
  return {
    kind: doc.kind,
    schemaVersion: doc.schemaVersion,
    name: doc.name,
    createdAt: doc.createdAt,
    settings: doc.settings,
    items: doc.items,
    deliverables: doc.deliverables,
  };
}
