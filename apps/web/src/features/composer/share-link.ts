import type {CharacterSpec} from '@csg/parts-schema';
import {encodeShareFragment} from '../../shared/share';

/** Slots of `spec` that hold a `user:` part: those are not included in a share link (REQ-CMP-026). */
export function userPartSlots(
  spec: CharacterSpec,
): Array<{readonly slot: string; readonly ref: string}> {
  return Object.entries(spec.parts)
    .filter(([, selection]) => selection.ref.startsWith('user:'))
    .map(([slot, selection]) => ({slot, ref: selection.ref}));
}

/** `spec` without its `user:` parts (REQ-CMP-026, "Share without it"). */
export function withoutUserParts(spec: CharacterSpec): CharacterSpec {
  const parts: CharacterSpec['parts'] = {};
  for (const [slot, selection] of Object.entries(spec.parts)) {
    if (!selection.ref.startsWith('user:')) parts[slot] = selection;
  }
  return {...spec, parts};
}

/**
 * The share URL of a character: the current page with `#c=<fragment>` (REQ-CMP-025). Encoding
 * is local; nothing is requested from any server (P-03).
 */
export async function buildShareUrl(
  spec: CharacterSpec,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): Promise<string> {
  return `${location.origin}${location.pathname}#c=${await encodeShareFragment(spec)}`;
}

/** The `#c=` payload of a location hash, or null (REQ-CMP-035). */
export function readShareFragment(hash: string): string | null {
  const match = /^#c=([A-Za-z0-9_-]+)$/.exec(hash);
  return match?.[1] ?? null;
}

/**
 * Removes the fragment from the address bar after the share was opened or declined, so a reload
 * does not ask again. `replaceState` adds no history entry (AC-CMP-035.3).
 */
export function clearShareFragment(
  win: Pick<Window, 'history' | 'location'> = window,
): void {
  win.history.replaceState(
    win.history.state,
    '',
    `${win.location.pathname}${win.location.search}`,
  );
}
