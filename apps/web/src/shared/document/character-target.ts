import type {CharacterSpec} from '@csg/parts-schema';
import type {CommandCatalog} from './catalog-port';
import type {CharacterCommand, CharacterEdit} from './character-commands';
import type {DocumentStore} from './types';

/** What composer and anatomy widgets edit: the project character or the wizard draft. */
export interface CharacterTarget {
  getSpec(): CharacterSpec;
  subscribe(listener: () => void): () => void;
  apply(cmd: CharacterCommand): CharacterEdit;
}

/** A target with no history that can report and undo its own changes (REQ-UX-100). */
export interface DraftTarget extends CharacterTarget {
  isPristine(): boolean;
  /** Restore fields to their initial value: top-level spec keys or `parts.<slot>`. */
  reset(fields: readonly string[]): void;
}

/** Binds a target to the open project: every command becomes one entry of the shared history. */
export function projectCharacterTarget(
  store: DocumentStore,
  catalog: () => CommandCatalog,
): CharacterTarget {
  const getSpec = (): CharacterSpec => {
    const doc = store.getState().doc;
    if (!doc) throw new Error('No project is open');
    return doc.character;
  };
  return {
    getSpec,
    subscribe: store.subscribe,
    apply(cmd) {
      let result: CharacterEdit | null = null;
      store.dispatch({
        label: cmd.label,
        feature: cmd.feature,
        ...(cmd.context ? {context: cmd.context} : {}),
        ...(cmd.coalesceKey ? {coalesceKey: cmd.coalesceKey} : {}),
        apply(doc) {
          const edit = cmd.run(doc.character, catalog());
          if (!edit || edit.spec === doc.character) return null;
          result = edit;
          return {...doc, character: edit.spec};
        },
      });
      return result ?? {spec: getSpec(), removed: []};
    },
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    key =>
      Object.hasOwn(b, key) &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
  );
}

/** The wizard's draft: same command surface, no history and no autosave (REQ-UX-100). */
export function createDraftTarget(
  initial: CharacterSpec,
  catalog: () => CommandCatalog,
): DraftTarget {
  let spec = initial;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    getSpec: () => spec,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply(cmd) {
      const edit = cmd.run(spec, catalog());
      if (!edit || edit.spec === spec) return {spec, removed: []};
      spec = edit.spec;
      emit();
      return edit;
    },
    isPristine: () => deepEqual(spec, initial),
    reset(fields) {
      let next: CharacterSpec = spec;
      for (const field of fields) {
        if (field.startsWith('parts.')) {
          const slot = field.slice('parts.'.length);
          const parts = {...next.parts};
          const original = initial.parts[slot];
          if (original) parts[slot] = original;
          else delete parts[slot];
          next = {...next, parts};
        } else if (field in initial) {
          next = {
            ...next,
            [field]: (initial as unknown as Record<string, unknown>)[field],
          };
        }
      }
      if (next !== spec) {
        spec = next;
        emit();
      }
    },
  };
}
