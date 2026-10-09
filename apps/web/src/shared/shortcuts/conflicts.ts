import {chordId, parseChord} from './chords';
import type {ShortcutDef} from './types';
import {MODAL_SCOPES} from './types';

function buildReserved(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const add = (chord: string, reason: string) => {
    map.set(chordId(parseChord(chord)), reason);
  };
  const both = (suffix: string, reason: string) => {
    add(`Mod+${suffix}`, reason);
    add(`Ctrl+${suffix}`, reason);
  };
  for (const k of 'NTW') {
    both(k, 'browser tab or window');
    both(`Shift+${k}`, 'browser tab or window');
  }
  both('Tab', 'browser tab switch');
  both('Shift+Tab', 'browser tab switch');
  for (let i = 1; i <= 9; i += 1) both(String(i), 'browser tab switch');
  both('L', 'browser address bar');
  both('R', 'browser reload');
  add('F5', 'browser reload');
  add('F11', 'browser full screen');
  add('F12', 'browser developer tools');
  for (const k of 'IJC') both(`Shift+${k}`, 'browser developer tools');
  both('P', 'browser print');
  both('=', 'browser zoom');
  both('+', 'browser zoom');
  both('-', 'browser zoom');
  both('0', 'browser zoom');
  add('Alt+F4', 'close window');
  add('Alt+ArrowLeft', 'browser back');
  add('Alt+ArrowRight', 'browser forward');
  // macOS Cmd+Q/H/M and Cmd+Option+H (Hide Others). `Mod` is Cmd on macOS, so the
  // platform-neutral forms are reserved too (spec 009 REQ-UX-015, PM 2026-10-09).
  for (const k of 'QHM') {
    add(`Meta+${k}`, 'macOS system shortcut');
    add(`Mod+${k}`, 'macOS system shortcut');
  }
  add('Meta+Alt+H', 'macOS Hide Others');
  add('Mod+Alt+H', 'macOS Hide Others');
  return map;
}

/** Chords the browser or OS reserves (REQ-UX-015), canonical chord to reason. */
export const RESERVED_CHORDS: ReadonlyMap<string, string> = buildReserved();

/** One problem found by {@link checkRegistry}. */
export interface RegistryIssue {
  readonly kind:
    | 'duplicate'
    | 'unshadowed-global'
    | 'reserved'
    | 'unknown-shadow'
    | 'invalid-chord';
  readonly message: string;
}

/**
 * The CI conflict check (REQ-UX-013, 015): a chord bound twice in one scope, bound in
 * `global` and in a region or modal scope without `shadows`, or reserved.
 */
export function checkRegistry(defs: readonly ShortcutDef[]): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const bound = new Map<string, ShortcutDef[]>(); // `${scope}|${chord}`
  const ids = new Set(defs.map(def => def.commandId));
  for (const def of defs) {
    if (def.shadows !== undefined && !ids.has(def.shadows)) {
      issues.push({
        kind: 'unknown-shadow',
        message: `${def.commandId} shadows unknown command ${def.shadows}`,
      });
    }
    for (const key of def.keys) {
      let id: string;
      try {
        id = chordId(parseChord(key));
      } catch (error) {
        issues.push({
          kind: 'invalid-chord',
          message: `${def.commandId}: ${(error as Error).message}`,
        });
        continue;
      }
      const reserved = RESERVED_CHORDS.get(id);
      if (reserved !== undefined) {
        issues.push({
          kind: 'reserved',
          message: `Reserved chord: ${reserved} (${key} on ${def.commandId})`,
        });
      }
      const slot = `${def.scope}|${id}|${def.when ?? ''}`;
      const list = bound.get(slot) ?? [];
      list.push(def);
      bound.set(slot, list);
    }
  }
  for (const [slot, list] of bound) {
    if (list.length > 1) {
      issues.push({
        kind: 'duplicate',
        message: `${slot.split('|')[1]} is bound twice in ${slot.split('|')[0]}: ${list.map(d => d.commandId).join(', ')}`,
      });
    }
  }
  const globals = new Map<string, ShortcutDef>();
  for (const def of defs) {
    if (def.scope !== 'global') continue;
    for (const key of def.keys) {
      try {
        globals.set(chordId(parseChord(key)), def);
      } catch {
        // reported above
      }
    }
  }
  for (const def of defs) {
    if (def.scope === 'global') continue;
    for (const key of def.keys) {
      let id: string;
      try {
        id = chordId(parseChord(key));
      } catch {
        continue;
      }
      const global = globals.get(id);
      if (global && def.shadows === undefined) {
        issues.push({
          kind: 'unshadowed-global',
          message: `${key} in ${def.scope} (${def.commandId}) collides with global ${global.commandId} without shadows`,
        });
      }
    }
  }
  return issues;
}

/** True for the scopes that outrank focused regions. */
export function isModalScope(scope: string): boolean {
  return (MODAL_SCOPES as readonly string[]).includes(scope);
}
