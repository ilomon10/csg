import {useEffect} from 'react';
import type {RefObject} from 'react';
import {isModalScope} from './conflicts';
import type {ShortcutScope} from './types';

/** The set of scopes active right now: focused region and open modal scopes. */
export interface ScopeStack {
  active(): readonly ShortcutScope[];
  enter(scope: ShortcutScope): () => void;
  subscribe(listener: () => void): () => void;
}

/** Creates a scope stack. A scope entered twice stays active until left twice. */
export function createScopeStack(): ScopeStack {
  const counts = new Map<ShortcutScope, number>();
  const listeners = new Set<() => void>();
  let list: readonly ShortcutScope[] = [];
  const refresh = () => {
    list = [...counts.keys()];
    for (const listener of [...listeners]) listener();
  };
  return {
    active: () => list,
    enter(scope) {
      counts.set(scope, (counts.get(scope) ?? 0) + 1);
      refresh();
      let left = false;
      return () => {
        if (left) return;
        left = true;
        const next = (counts.get(scope) ?? 1) - 1;
        if (next <= 0) counts.delete(scope);
        else counts.set(scope, next);
        refresh();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app-wide stack the dispatcher reads by default. */
export const appScopeStack: ScopeStack = createScopeStack();

/**
 * Activates `scope`: a region scope while focus is inside `ref` (REQ-UX-012), a modal scope
 * while the component is mounted.
 */
export function useShortcutScope(
  scope: ShortcutScope,
  ref: RefObject<HTMLElement | null>,
  stack: ScopeStack = appScopeStack,
): void {
  useEffect(() => {
    if (isModalScope(scope)) return stack.enter(scope);
    const el = ref.current;
    if (!el) return undefined;
    let leave: (() => void) | null = null;
    const onIn = () => {
      leave ??= stack.enter(scope);
    };
    const onOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && el.contains(next)) return;
      leave?.();
      leave = null;
    };
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    if (el.contains(el.ownerDocument.activeElement)) onIn();
    return () => {
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
      leave?.();
    };
  }, [scope, ref, stack]);
}
