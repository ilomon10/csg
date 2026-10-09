import {useSyncExternalStore} from 'react';
import type {CharacterSpec} from '@csg/parts-schema';

const EMPTY: ReadonlySet<string> = new Set();

/** Refs of a character that the renderer must have attached (body and every equipped part). */
export function characterRefs(spec: CharacterSpec): readonly string[] {
  return [spec.body.ref, ...Object.values(spec.parts).map(p => p.ref)];
}

/**
 * Which part refs are between "equipped" and "attached by the renderer" (REQ-UX-067,
 * AC-CMP-004.2). The engine has no load-state API, so the viewport derives it: the refs of a
 * character that the renderer has not attached before are busy while `setCharacter` runs. The
 * previous part stays attached meanwhile. Serializable state only (ref strings).
 */
export interface PartLoadStore {
  /** The busy refs (a new set whenever it changes). */
  get(): ReadonlySet<string>;
  /** Replaces the busy set. */
  set(refs: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
}

/** Creates a part-load store. */
export function createPartLoadStore(): PartLoadStore {
  let busy: ReadonlySet<string> = EMPTY;
  const listeners = new Set<() => void>();
  return {
    get: () => busy,
    set(refs) {
      const next = new Set(refs);
      if (next.size === 0 && busy.size === 0) return;
      busy = next.size === 0 ? EMPTY : next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The store the one mounted viewport reports to (Easy and Pro never show together). */
export const partLoadStore: PartLoadStore = createPartLoadStore();

/** The refs whose part is loading, for `busyRefs` of the tile groups and the part library. */
export function useBusyRefs(
  store: PartLoadStore = partLoadStore,
): ReadonlySet<string> {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
