import {useSyncExternalStore, type ReactElement} from 'react';

/** Politeness of a screen-reader announcement. */
export type AnnouncePoliteness = 'polite' | 'assertive';

interface AnnouncerState {
  readonly polite: string;
  readonly assertive: string;
}

let state: AnnouncerState = {polite: '', assertive: ''};
const NBSP = String.fromCharCode(160);
let flip = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Announces `message` through the mounted {@link Announcer}. Repeating the same text still
 * re-announces (a trailing no-break space alternates).
 */
export function announce(
  message: string,
  politeness: AnnouncePoliteness = 'polite',
): void {
  flip = !flip;
  state = {...state, [politeness]: flip ? message : `${message}${NBSP}`};
  for (const l of listeners) l();
}

/** Clears both regions (tests and teardown). */
export function resetAnnouncer(): void {
  state = {polite: '', assertive: ''};
  for (const l of listeners) l();
}

/** Mount once in the shell. Hosts the polite and assertive live regions used by `announce`. */
export function Announcer(): ReactElement {
  const s = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  return (
    <>
      <div
        className="csg-sr"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {s.polite}
      </div>
      <div
        className="csg-sr"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {s.assertive}
      </div>
    </>
  );
}
