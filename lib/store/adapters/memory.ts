/**
 * In-memory adapter — tests and SSR.
 *
 * During prerender (`output: 'export'` still prerenders at build time) there is
 * no `window`, so the store is constructed with this adapter and simply holds a
 * frozen empty document. The real adapter is attached in a `useEffect`.
 */

import type { StorageAdapter } from "./types";

export interface MemoryAdapterOptions {
  /** Pre-seed the adapter, as if a previous session had written this. */
  initial?: string | null;
  id?: string;
  label?: string;
}

export class MemoryAdapter implements StorageAdapter {
  readonly id: string;
  readonly label: string;

  private value: string | null;

  /** Every `save()` ever made, in order. Tests assert on debounce/flush behaviour. */
  readonly writes: string[] = [];

  constructor(options: MemoryAdapterOptions = {}) {
    this.id = options.id ?? "memory";
    this.label = options.label ?? "Memory";
    this.value = options.initial ?? null;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async load(): Promise<string | null> {
    return this.value;
  }

  async save(json: string): Promise<void> {
    this.value = json;
    this.writes.push(json);
  }

  async clear(): Promise<void> {
    this.value = null;
  }

  /** Test-only synchronous peek. Not part of `StorageAdapter`. */
  peek(): string | null {
    return this.value;
  }
}
