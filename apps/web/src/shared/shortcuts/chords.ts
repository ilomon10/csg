import type {Chord, KeyboardEventLike, Platform} from './types';

const MODIFIERS = new Set(['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift']);

/** Parses a platform-neutral chord such as `Mod+Shift+Z`, `Alt+Shift+1`, `+` or `Mod++`. */
export function parseChord(chord: string): Chord {
  let rest = chord;
  let key: string;
  if (rest === '+') {
    key = '+';
    rest = '';
  } else if (rest.endsWith('+')) {
    key = '+';
    rest = rest.slice(0, -1);
    if (rest.endsWith('+')) rest = rest.slice(0, -1);
  } else {
    const parts = rest.split('+');
    key = parts.pop() ?? '';
    rest = parts.join('+');
  }
  const mods = new Set(rest === '' ? [] : rest.split('+'));
  for (const mod of mods) {
    if (!MODIFIERS.has(mod))
      throw new Error(`Unknown modifier "${mod}" in "${chord}"`);
  }
  if (key === '') throw new Error(`Empty key in chord "${chord}"`);
  return {
    mod: mods.has('Mod'),
    ctrl: mods.has('Ctrl'),
    meta: mods.has('Meta'),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    key: key.length === 1 && /[a-z]/.test(key) ? key.toUpperCase() : key,
  };
}

/** Canonical text of a chord, used for conflict detection. */
export function chordId(c: Chord): string {
  const parts: string[] = [];
  if (c.mod) parts.push('Mod');
  if (c.ctrl) parts.push('Ctrl');
  if (c.meta) parts.push('Meta');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  parts.push(c.key);
  return parts.join('+');
}

/** True for a chord that is a printable character without Ctrl/Alt/Cmd (REQ-UX-016). */
export function isSingleKey(c: Chord): boolean {
  if (c.mod || c.ctrl || c.meta || c.alt) return false;
  return c.key === 'Space' || c.key.length === 1;
}

/** Detects the platform from the user agent data or `navigator.platform`. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & {userAgentData?: {platform?: string}};
  const text = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad/i.test(text) ? 'mac' : 'other';
}

const MAC_KEYS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Backspace: '⌫',
  Delete: '⌦',
};
const OTHER_KEYS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
};

/** Display text per platform: `Ctrl+Shift+Z` or `⇧⌘Z` (REQ-UX-018). */
export function formatChord(c: Chord, platform: Platform): string {
  if (platform === 'mac') {
    const key = MAC_KEYS[c.key] ?? c.key;
    return (
      (c.ctrl ? '⌃' : '') +
      (c.alt ? '⌥' : '') +
      (c.shift ? '⇧' : '') +
      (c.mod || c.meta ? '⌘' : '') +
      key
    );
  }
  const parts: string[] = [];
  if (c.mod || c.ctrl) parts.push('Ctrl');
  if (c.meta) parts.push('Meta');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  parts.push(OTHER_KEYS[c.key] ?? c.key);
  return parts.join('+');
}

/** `KeyboardEvent.code` for a layout-independent key of a chord, if it has one. */
function codeFor(key: string, alt: boolean): string | undefined {
  if (key === 'Space') return 'Space';
  if (/^F\d{1,2}$/.test(key)) return key;
  // Option changes `key` on macOS ("π"), so Alt chords match physical keys (PM decision).
  if (alt && /^[A-Z]$/.test(key)) return `Key${key}`;
  if (alt && /^[0-9]$/.test(key)) return `Digit${key}`;
  return undefined;
}

/**
 * Does `e` press chord `c`? Characters match on `key`; `code` is used for Space, F-keys,
 * and letters and digits when Alt is held. Shift is ignored for non-letter characters
 * (`?`, `+`) because layouts need it to produce them.
 */
export function matchEvent(
  e: KeyboardEventLike,
  c: Chord,
  platform: Platform = detectPlatform(),
): boolean {
  const mac = platform === 'mac';
  const wantCtrl = c.ctrl || (c.mod && !mac);
  const wantMeta = c.meta || (c.mod && mac);
  if (e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta || e.altKey !== c.alt) {
    return false;
  }
  const isLetter = /^[A-Z]$/.test(c.key);
  const isSymbol = c.key.length === 1 && !isLetter && !/^[0-9]$/.test(c.key);
  if (!isSymbol && e.shiftKey !== c.shift) return false;
  if (isSymbol && c.shift && !e.shiftKey) return false;
  const code = codeFor(c.key, c.alt);
  if (code !== undefined) return e.code === code;
  if (c.key.length === 1) return e.key.toLowerCase() === c.key.toLowerCase();
  return e.key === c.key;
}
