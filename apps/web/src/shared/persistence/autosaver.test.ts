import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ProjectDocument} from '@csg/parts-schema';
import {createAutosaver} from './autosaver';
import type {AutosaveSource} from './autosaver';
import type {ProjectRepository} from './project-repository';
import {sampleDoc} from './test-helpers';
import type {Result} from './types';

function makeStore() {
  const state = {
    projectId: 'p1' as string | null,
    doc: sampleDoc() as ProjectDocument | null,
    revision: 0,
    savedRevision: 0,
    readOnly: false,
  };
  const listeners = new Set<() => void>();
  const store: AutosaveSource = {
    getState: () => state,
    subscribe: l => (listeners.add(l), () => listeners.delete(l)),
    markSaved: rev => {
      state.savedRevision = rev;
    },
  };
  const edit = () => {
    state.revision += 1;
    state.doc = sampleDoc(`rev ${state.revision}`);
    for (const l of listeners) l();
  };
  return {state, store, edit};
}

function makeRepo(fail = false) {
  const saves: Array<{id: string; doc: ProjectDocument}> = [];
  const snapshots: ProjectDocument[] = [];
  const result = (): Result<void> =>
    fail
      ? {ok: false, error: {code: 'UX_SAVE_FAILED', message: 'boom'}}
      : {ok: true, value: undefined};
  const repo = {
    saveDocument: async (id: string, doc: ProjectDocument) => (
      saves.push({id, doc}),
      result()
    ),
    putSnapshot: async (_id: string, doc: ProjectDocument) => (
      snapshots.push(doc),
      result()
    ),
  } as unknown as ProjectRepository;
  return {repo, saves, snapshots};
}

describe('autosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('AC-UX-026.1: a change at t=0 is stored by t=2.5 s', async () => {
    const {store, edit, state} = makeStore();
    const {repo, saves} = makeRepo();
    const saver = createAutosaver({store, repo});
    edit();
    expect(saver.status()).toBe('unsaved');
    expect(saver.needsConfirmOnUnload()).toBe(true);
    await vi.advanceTimersByTimeAsync(1900);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(saves).toHaveLength(1);
    expect(saver.status()).toBe('saved');
    expect(state.savedRevision).toBe(1);
    expect(saver.needsConfirmOnUnload()).toBe(false);
  });

  it('AC-UX-026.2: continuous editing every 500 ms still saves at least every 10 s', async () => {
    const {store, edit} = makeStore();
    const {repo, saves} = makeRepo();
    createAutosaver({store, repo});
    for (let t = 0; t < 30_000; t += 500) {
      edit();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(saves.length).toBeGreaterThanOrEqual(3);
  });

  it('AC-UX-030.1: no confirmation when everything is saved', async () => {
    const {store} = makeStore();
    const saver = createAutosaver({store, repo: makeRepo().repo});
    expect(saver.needsConfirmOnUnload()).toBe(false);
  });

  it('AC-UX-027.1: failing writes give status failed, notify once, and Retry works', async () => {
    const {store, edit} = makeStore();
    const failing = makeRepo(true);
    const saver = createAutosaver({store, repo: failing.repo});
    const seen: string[] = [];
    saver.subscribe(() => seen.push(saver.status()));
    edit();
    await vi.advanceTimersByTimeAsync(2100);
    expect(saver.status()).toBe('failed');
    expect(saver.lastError()?.code).toBe('UX_SAVE_FAILED');
    expect(seen.filter(s => s === 'failed')).toHaveLength(1);
    expect(saver.needsConfirmOnUnload()).toBe(true);
  });

  it('AC-UX-050.2: no write is attempted when free space is too small', async () => {
    const {store, edit} = makeStore();
    const {repo, saves, snapshots} = makeRepo();
    const saver = createAutosaver({
      store,
      repo,
      estimate: async () => ({quota: 2_000_000, usage: 1_999_000}),
    });
    edit();
    await vi.advanceTimersByTimeAsync(2100);
    expect(saves).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
    expect(saver.status()).toBe('failed');
  });

  it('AC-UX-025.1: Mod+S saves immediately without a snapshot', async () => {
    const {store, edit} = makeStore();
    const {repo, saves, snapshots} = makeRepo();
    const saver = createAutosaver({store, repo});
    edit();
    expect(await saver.saveNow()).toBe(true);
    expect(saves).toHaveLength(1);
    expect(snapshots).toHaveLength(0);
    expect(saver.status()).toBe('saved');
  });

  it('AC-UX-029.1: a read-only tab never saves', async () => {
    const {store, edit, state} = makeStore();
    const {repo, saves} = makeRepo();
    state.readOnly = true;
    createAutosaver({store, repo});
    edit();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(saves).toHaveLength(0);
  });
});
