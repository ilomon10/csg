import {detectPlatform, isSingleKey, matchEvent, parseChord} from './chords';
import type {CommandRegistry} from './command-registry';
import {isModalScope} from './conflicts';
import type {Chord, Platform, ShortcutDef, ShortcutScope} from './types';

/** A space tap shorter than this, without pointer movement, counts as a tap (006). */
export const TAP_MAX_MS = 200;

/** Options of {@link createShortcutDispatcher}. */
export interface DispatcherOptions {
  readonly registry: CommandRegistry;
  readonly shortcuts: readonly ShortcutDef[];
  /** Active modal and focused-region scopes; `global` is always implied. */
  readonly activeScopes: () => readonly ShortcutScope[];
  /** The "Single-key shortcuts" setting (REQ-UX-016). */
  readonly singleKeyEnabled: () => boolean;
  /** Evaluates a `when` name; a binding with an unknown `when` never fires. */
  readonly when?: (name: string) => boolean;
  readonly platform?: Platform;
  readonly now?: () => number;
  readonly onError?: (commandId: string, error: unknown) => void;
}

interface Compiled {
  readonly def: ShortcutDef;
  readonly chord: Chord;
  readonly single: boolean;
}

/** True while focus is in a field that takes typed text (REQ-UX-014). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return ![
      'checkbox',
      'radio',
      'button',
      'submit',
      'reset',
      'image',
      'file',
      'color',
      'range',
    ].includes(type);
  }
  if (target.isContentEditable) return true;
  const ce = target.getAttribute('contenteditable');
  if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
  const role = target.getAttribute('role');
  return role === 'textbox' || role === 'combobox' || role === 'spinbutton';
}

/** True for an element a Space or Enter press activates itself (button, link, `role=button`). */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('button, a[href], [role="button"]') !== null;
}

/**
 * The only global `keydown` listener of the editor (REQ-UX-011). Resolves scope precedence
 * modal > focused region > global (REQ-UX-012); only the highest tier with a matching
 * binding fires and unbound keys are left to the browser.
 */
export function createShortcutDispatcher(options: DispatcherOptions): {
  attach(target: Window): () => void;
  /** Resolves an event to the binding that would fire, without running it. */
  resolve(e: KeyboardEvent): ShortcutDef | undefined;
} {
  const compiled: Compiled[] = options.shortcuts.flatMap(def =>
    def.keys.map(key => {
      const chord = parseChord(key);
      return {def, chord, single: isSingleKey(chord)};
    }),
  );
  const platform = options.platform ?? detectPlatform();
  const now = options.now ?? (() => Date.now());

  const tierOf = (scope: ShortcutScope): number =>
    scope === 'global' ? 0 : isModalScope(scope) ? 2 : 1;

  function resolve(e: KeyboardEvent): ShortcutDef | undefined {
    if (e.isComposing) return undefined;
    const editable = isEditableTarget(e.target);
    const activatable = isActivatableTarget(e.target);
    const active = new Set<ShortcutScope>(options.activeScopes());
    active.add('global');
    const order = [...active];
    let best: {entry: Compiled; tier: number; rank: number} | undefined;
    for (const entry of compiled) {
      const {def} = entry;
      if (!active.has(def.scope)) continue;
      if (editable && !def.allowInInput) continue;
      if (entry.single && !options.singleKeyEnabled()) continue;
      // A tap binding (Space) must not swallow the click of a focused button (Firefox).
      if (def.when === 'tap' && entry.single && activatable) continue;
      if (!matchEvent(e, entry.chord, platform)) continue;
      if (def.when !== undefined && def.when !== 'tap') {
        if (!options.when?.(def.when)) continue;
      }
      const tier = tierOf(def.scope);
      const rank = order.indexOf(def.scope);
      if (
        !best ||
        tier > best.tier ||
        (tier === best.tier && rank < best.rank)
      ) {
        best = {entry, tier, rank};
      }
    }
    return best?.entry.def;
  }

  function run(def: ShortcutDef): void {
    options.registry.run(def.commandId).catch((error: unknown) => {
      options.onError?.(def.commandId, error);
    });
  }

  return {
    resolve,
    attach(target) {
      let pending: {
        def: ShortcutDef;
        code: string;
        at: number;
        moved: boolean;
      } | null = null;
      const onKeyDown = (e: KeyboardEvent) => {
        const def = resolve(e);
        if (!def) return;
        if (!options.registry.get(def.commandId)) return;
        e.preventDefault();
        if (def.when === 'tap') {
          if (
            !e.repeat &&
            (pending === null || now() - pending.at >= TAP_MAX_MS)
          ) {
            pending = {def, code: e.code, at: now(), moved: false};
          }
          return;
        }
        run(def);
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (!pending || pending.code !== e.code) return;
        const {def, at, moved} = pending;
        pending = null;
        if (!moved && now() - at < TAP_MAX_MS) run(def);
      };
      const onPointerMove = () => {
        if (pending) pending.moved = true;
      };
      target.addEventListener('keydown', onKeyDown);
      target.addEventListener('keyup', onKeyUp);
      target.addEventListener('pointermove', onPointerMove);
      return () => {
        target.removeEventListener('keydown', onKeyDown);
        target.removeEventListener('keyup', onKeyUp);
        target.removeEventListener('pointermove', onPointerMove);
      };
    },
  };
}
