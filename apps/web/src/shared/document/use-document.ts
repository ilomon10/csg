import {useSyncExternalStore} from 'react';
import type {DocumentState, DocumentStore} from './types';

/**
 * Subscribes a component to a slice of the document state. `select` must return a stable
 * value (a field of the state, not a fresh object), as with any external-store selector.
 */
export function useDocument<T>(
  store: DocumentStore,
  select: (state: DocumentState) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}
