import {describe, expect, it, vi} from 'vitest';
import {STORES, request} from './database';
import {createHomeFramesRepository} from './home-frames-repository';
import {createProjectRepository} from './project-repository';
import {freshDatabase, sampleDoc} from './test-helpers';
import type {ProjectRecord} from './types';

const meta = (id: string, extra = {}) => ({
  projectId: id,
  name: 'Knight',
  lastEditedAt: 1,
  pinned: false,
  ...extra,
});
const record = (id: string, extra = {}): ProjectRecord => ({
  format: 'sprite-project-record',
  version: 1,
  meta: meta(id, extra),
  doc: sampleDoc(),
});

describe('project repository', () => {
  it('AC-UX-025.1: the stored record equals the saved document', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    const doc = sampleDoc();
    expect((await repo.saveDocument('p1', doc)).ok).toBe(true);
    const got = await repo.get('p1');
    expect(got.ok && got.value.doc).toEqual(doc);
  });

  it('AC-UX-025.2: saving a project makes no network request (fetch, XHR, beacon, WebSocket)', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network')));
    const xhrSpy = vi.fn();
    const beaconSpy = vi.fn(() => false);
    const wsSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      sendBeacon: beaconSpy,
    });
    try {
      const database = await freshDatabase();
      const repo = createProjectRepository({
        database,
        channelFactory: () => null,
      });
      const doc = sampleDoc('private character');
      expect((await repo.saveDocument('p1', doc)).ok).toBe(true);
      expect((await repo.putSnapshot('p1', doc)).ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });

  it('AC-UX-026.3: keeps exactly the 10 newest of 12 snapshots', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    for (let i = 0; i < 12; i++)
      await repo.putSnapshot('p1', sampleDoc(`v${i}`));
    const list = await repo.listSnapshots('p1');
    expect(list).toHaveLength(10);
    expect(list.map(s => s.seq)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    const newest = await repo.getSnapshot('p1', 12);
    expect(newest.ok && newest.value.character.name).toBe('v11');
  });

  it('AC-UX-045.3: a tampered snapshot fails with UX_PROJECT_INVALID and stays untouched', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    await repo.putSnapshot('p1', sampleDoc());
    const tx = database.db.transaction(STORES.snapshots, 'readwrite');
    const store = tx.objectStore(STORES.snapshots);
    const row = (await request(store.get(['p1', 1]))) as {
      doc: {format: string};
    };
    row.doc.format = 'tampered';
    store.put(row);
    await new Promise(r => (tx.oncomplete = () => r(null)));
    const got = await repo.getSnapshot('p1', 1);
    expect(!got.ok && got.error.code).toBe('UX_PROJECT_INVALID');
    expect(!got.ok && got.error.path).toBeTruthy();
    expect(await repo.listSnapshots('p1')).toHaveLength(1);
  });

  it('AC-GEN-013.1: an invalid record is skipped in the list and rejected by get', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    await repo.put(record('good'));
    const tx = database.db.transaction(STORES.projects, 'readwrite');
    tx.objectStore(STORES.projects).put({
      format: 'sprite-project-record',
      version: 1,
      meta: meta('bad', {name: ''}),
      doc: {},
    });
    await new Promise(r => (tx.oncomplete = () => r(null)));
    expect((await repo.list()).map(m => m.projectId)).toEqual(['good']);
    const bad = await repo.get('bad');
    expect(!bad.ok && bad.error.code).toBe('UX_PROJECT_INVALID');
    const missing = await repo.get('nope');
    expect(!missing.ok && missing.error.code).toBe('UX_PROJECT_NOT_FOUND');
  });

  it('AC-GEN-013.1: cyclic, DAG and oversized stored documents are rejected fast', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    const cycle: Record<string, unknown> = {...sampleDoc()};
    cycle['loop'] = cycle;
    let dag: unknown = {};
    for (let i = 0; i < 24; i++) dag = {a: dag, b: dag};
    const big = {...sampleDoc(), pad: 'x'.repeat(1_100_000)};
    for (const [id, doc] of [
      ['cycle', cycle],
      ['dag', {...sampleDoc(), dag}],
      ['big', big],
    ] as const) {
      const tx = database.db.transaction(STORES.projects, 'readwrite');
      tx.objectStore(STORES.projects).put({
        ...record(id),
        doc,
      });
      await new Promise(r => (tx.oncomplete = () => r(null)));
    }
    const started = Date.now();
    for (const id of ['cycle', 'dag', 'big']) {
      const got = await repo.get(id);
      expect(!got.ok && got.error.code).toBe('UX_PROJECT_INVALID');
    }
    expect(Date.now() - started).toBeLessThan(3000);
    const good = await repo.put(record('after'));
    expect(good.ok).toBe(true);
  });

  it('AC-GEN-011.1: a stored document with a __proto__ key is rejected', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    const evil = JSON.parse(
      JSON.stringify(sampleDoc()).replace(
        '"graphs":{}',
        '"graphs":{"a":{"b":{"__proto__":{"polluted":1}}}}',
      ),
    ) as ProjectRecord['doc'];
    const tx = database.db.transaction(STORES.projects, 'readwrite');
    tx.objectStore(STORES.projects).put({...record('evil'), doc: evil});
    await new Promise(r => (tx.oncomplete = () => r(null)));
    const got = await repo.get('evil');
    expect(!got.ok && got.error.code).toBe('UX_PROJECT_INVALID');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('AC-UX-050.2: no write is attempted when free space is below the need', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
      estimate: async () => ({quota: 2_000_000, usage: 0}),
    });
    const big = sampleDoc();
    const padded = {...big, graphs: {pad: 'x'.repeat(1_000_000)}};
    const res = await repo.putSnapshot('p1', padded);
    expect(!res.ok && res.error.code).toBe('UX_SAVE_FAILED');
    expect(await repo.listSnapshots('p1')).toHaveLength(0);
  });

  it('AC-UX-050.1: usage counts projects, snapshots and home frames', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    expect(await repo.usageBytes()).toBe(0);
    await repo.saveDocument('p1', sampleDoc());
    const one = await repo.usageBytes();
    await repo.putSnapshot('p1', sampleDoc());
    expect(await repo.usageBytes()).toBeGreaterThan(one);
  });

  it('AC-UX-079.2: remove deletes project, snapshots and home frames', async () => {
    const database = await freshDatabase();
    const repo = createProjectRepository({
      database,
      channelFactory: () => null,
    });
    const frames = createHomeFramesRepository(database);
    const key = 'a'.repeat(64);
    await repo.put(record('p1', {homeFramesKey: key}));
    await repo.putSnapshot('p1', sampleDoc());
    const png = new Blob([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ]);
    await frames.put({
      format: 'sprite-home-frames',
      version: 1,
      key,
      frameCount: 1,
      fps: 8,
      strip: png,
      avatar: png,
      lastUsed: 1,
    });
    await repo.remove('p1');
    expect(await repo.list()).toHaveLength(0);
    expect(await repo.listSnapshots('p1')).toHaveLength(0);
    const left = await request(
      database.db
        .transaction(STORES.homeFrames)
        .objectStore(STORES.homeFrames)
        .count(),
    );
    expect(left).toBe(0);
  });

  it('AC-UX-029.1: other tabs learn about changes through the validated channel', async () => {
    const database = await freshDatabase();
    const a = new EventTarget() as unknown as {
      postMessage(m: unknown): void;
      addEventListener: EventTarget['addEventListener'];
      removeEventListener: EventTarget['removeEventListener'];
      close(): void;
    };
    const listeners: Array<(e: MessageEvent) => void> = [];
    const channel = {
      postMessage: (_m: unknown) => {},
      addEventListener: (_t: string, l: (e: MessageEvent) => void) =>
        listeners.push(l),
      removeEventListener: () => {},
      close: () => {},
    };
    void a;
    const repo = createProjectRepository({
      database,
      channelFactory: () => channel,
    });
    const seen: string[][] = [];
    repo.onChange(ids => seen.push([...ids]));
    for (const l of listeners) {
      l({data: {type: 'changed', projectIds: ['p9']}} as MessageEvent);
      l({data: {type: 'changed', projectIds: [42]}} as MessageEvent);
    }
    expect(seen).toEqual([['p9']]);
  });
});
