import {
  PREFS_KEY,
  defaultPrefs,
  loadPrefs,
  savePrefs,
} from '../../shared/persistence';
import type {UiPrefs} from '../../shared/persistence';

/** Observable UI preferences backed by localStorage (REQ-UX-047). */
export interface PrefsStore {
  get(): UiPrefs;
  /** Merges a patch, persists it and re-applies theme and motion to the document. */
  set(patch: Partial<UiPrefs>): void;
  subscribe(listener: () => void): () => void;
}

/** Reads `localStorage`, or `null` when access throws (blocked storage). */
export function safeLocalStorage(win: Window): Storage | null {
  try {
    return win.localStorage;
  } catch {
    return null;
  }
}

/**
 * Applies theme and reduce-motion to `<html>` (REQ-UX-034, REQ-UX-038). `public/theme-boot.js`
 * does the same before first paint; this keeps the document in sync afterwards.
 */
export function applyPrefsToDocument(prefs: UiPrefs, root: HTMLElement): void {
  root.setAttribute('data-theme', prefs.theme);
  root.setAttribute(
    'data-reduce-motion',
    prefs.reduceMotion === 'system' ? 'system' : String(prefs.reduceMotion),
  );
}

/** True when motion should be reduced: the in-app setting, or the OS setting for `system`. */
export function motionReduced(prefs: UiPrefs, win: Window): boolean {
  if (prefs.reduceMotion !== 'system') return prefs.reduceMotion;
  return win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Creates the preferences store. A new profile gets the Dark default of REQ-UX-034 (the shared
 * default is `system`) and opens in Easy (REQ-UX-054).
 */
export function createPrefsStore(win: Window): PrefsStore {
  const storage = safeLocalStorage(win);
  let fresh = true;
  try {
    fresh = storage?.getItem(PREFS_KEY) === null;
  } catch {
    fresh = true;
  }
  let prefs = loadPrefs(storage, fresh);
  if (fresh) prefs = {...defaultPrefs('easy'), theme: 'dark'};
  const listeners = new Set<() => void>();
  applyPrefsToDocument(prefs, win.document.documentElement);
  return {
    get: () => prefs,
    set(patch) {
      prefs = {...prefs, ...patch};
      savePrefs(storage, prefs);
      applyPrefsToDocument(prefs, win.document.documentElement);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
