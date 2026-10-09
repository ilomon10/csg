import {describe, expect, it} from 'vitest';
import {createDocumentStore} from './document-store';
import {createDraftTarget, projectCharacterTarget} from './character-target';
import {equipPart, setTint} from './character-commands';
import {createTestCatalog, testDocument, testRef} from './test-catalog';
import type {DocCommand} from './types';
import type {ProjectDocument} from '@csg/parts-schema';

const rename = (name: string, extra: Partial<DocCommand> = {}): DocCommand => ({
  label: `Name ${name}`,
  feature: 'composer',
  apply: (doc: ProjectDocument) => ({
    ...doc,
    character: {...doc.character, name},
  }),
  ...extra,
});

function openStore(options?: Parameters<typeof createDocumentStore>[0]) {
  const store = createDocumentStore(options);
  store.open('p1', testDocument());
  return store;
}

describe('document store', () => {
  it('AC-UX-022.1: undo reverts commands from different features in reverse order', () => {
    const store = openStore();
    store.dispatch(rename('a'));
    store.dispatch({...rename('b'), feature: 'graph'});
    store.dispatch({...rename('c'), feature: 'anatomy'});
    expect(store.undo()?.label).toBe('Name c');
    expect(store.undo()?.label).toBe('Name b');
    expect(store.undo()?.label).toBe('Name a');
    expect(store.getState().doc?.character.name).toBe('New character');
  });

  it('AC-UX-022.2: keeps 200 entries; further undos are no-ops', () => {
    const store = openStore();
    for (let i = 0; i < 250; i += 1) store.dispatch(rename(`n${i}`));
    let undone = 0;
    while (store.undo()) undone += 1;
    expect(undone).toBe(200);
    expect(store.getState().undo).toBeNull();
    expect(store.undo()).toBeNull();
  });

  it('AC-UX-023.1: a gesture of 40 changes is one entry', () => {
    const store = openStore({now: () => 0});
    store.dispatch(rename('before'));
    store.beginGesture('drag');
    for (let i = 0; i < 40; i += 1) store.dispatch(rename(`v${i}`));
    store.endGesture();
    expect(store.getState().historyLength).toBe(2);
    store.undo();
    expect(store.getState().doc?.character.name).toBe('before');
  });

  it('AC-UX-023.2: five keyboard steps under 500 ms apart coalesce; a pause splits', () => {
    let t = 0;
    const store = openStore({now: () => t});
    for (let i = 0; i < 5; i += 1) {
      t += 100;
      store.dispatch(rename(`s${i}`, {coalesceKey: 'slider'}));
    }
    expect(store.getState().historyLength).toBe(1);
    t += 600;
    store.dispatch(rename('later', {coalesceKey: 'slider'}));
    expect(store.getState().historyLength).toBe(2);
    store.undo();
    expect(store.getState().doc?.character.name).toBe('s4');
  });

  it('AC-UX-024.1: a new command clears redo; undo restores recorded selection and context', () => {
    const store = openStore();
    store.dispatch(
      rename('a', {
        context: {
          inspectorTab: 'colors',
          selection: ['hair'],
          focusKey: 'swatch-3',
        },
      }),
    );
    store.setSelection(['legs']);
    const entry = store.undo();
    expect(entry?.context).toMatchObject({
      inspectorTab: 'colors',
      focusKey: 'swatch-3',
    });
    expect(store.getState().selection).toEqual(['hair']);
    expect(store.getState().redo?.label).toBe('Name a');
    store.dispatch(rename('b'));
    expect(store.getState().redo).toBeNull();
  });

  it('AC-UX-024.1: selection and viewport-like state changes are not history', () => {
    const store = openStore();
    store.setSelection(['x']);
    expect(store.getState().historyLength).toBe(0);
    expect(store.getState().revision).toBe(1);
  });

  it('AC-UX-051.1 and AC-UX-052.1: history and document are untouched by observing the store', () => {
    const store = openStore();
    store.dispatch(rename('a'));
    const before = store.getState();
    store.subscribe(() => undefined)();
    expect(store.getState()).toBe(before);
  });

  it('AC-UX-022.1: a command that returns null records nothing; read-only blocks edits', () => {
    const store = openStore();
    store.dispatch({label: 'noop', feature: 'composer', apply: () => null});
    expect(store.getState().historyLength).toBe(0);
    store.setReadOnly(true);
    store.dispatch(rename('x'));
    expect(store.getState().historyLength).toBe(0);
  });

  it('AC-CMP-028.1 and AC-CMP-028.2: equip, tint, then undo x2 restores the initial spec byte for byte', () => {
    const store = openStore();
    const catalog = createTestCatalog();
    const target = projectCharacterTarget(store, () => catalog);
    const initial = JSON.stringify(target.getSpec());
    target.apply(equipPart('hair', testRef('hair-2')));
    target.apply(setTint('hair', '#ABCDEF'));
    const after = JSON.stringify(target.getSpec());
    store.undo();
    store.undo();
    expect(JSON.stringify(target.getSpec())).toBe(initial);
    store.redo();
    store.redo();
    expect(JSON.stringify(target.getSpec())).toBe(after);
  });

  it('AC-UX-100.1: a draft target has no history and tracks pristine state', () => {
    const catalog = createTestCatalog();
    const draft = createDraftTarget(testDocument().character, () => catalog);
    expect(draft.isPristine()).toBe(true);
    draft.apply(equipPart('hair', testRef('hair-2')));
    expect(draft.isPristine()).toBe(false);
    draft.reset(['parts.hair']);
    expect(draft.isPristine()).toBe(true);
  });
});
