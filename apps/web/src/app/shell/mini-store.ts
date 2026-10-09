import {useSyncExternalStore} from 'react';

/** A tiny observable value holder (serializable state only). */
export interface MiniStore<T> {
  get(): T;
  set(next: T): void;
  update(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

/** Creates a {@link MiniStore}. `set` and `update` notify only when the value changes. */
export function createMiniStore<T extends object>(initial: T): MiniStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const publish = (next: T) => {
    value = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => value,
    set(next) {
      if (next !== value) publish(next);
    },
    update(patch) {
      const keys = Object.keys(patch) as Array<keyof T>;
      if (keys.every(k => Object.is(patch[k], value[k]))) return;
      publish({...value, ...patch});
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribes a component to a slice of a {@link MiniStore}. */
export function useMiniStore<T extends object, S>(
  store: MiniStore<T>,
  select: (value: T) => S,
): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
