import {describe, expect, it} from 'vitest';
import {STORES, request} from './database';
import {createHomeFramesRepository} from './home-frames-repository';
import {freshDatabase} from './test-helpers';
import type {HomeFramesRecord} from './types';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A PNG signature plus a 24-byte IHDR prefix declaring the size; the rest is absent. */
const png = (width = 64, height = 64) => {
  const bytes = new Uint8Array(24);
  bytes.set(PNG, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes]);
};
const key = (n: number) => n.toString(16).padStart(64, '0');
const rec = (
  n: number,
  extra: Partial<HomeFramesRecord> = {},
): HomeFramesRecord => ({
  format: 'sprite-home-frames',
  version: 1,
  key: key(n),
  frameCount: 2,
  fps: 8,
  strip: png(128),
  avatar: png(),
  lastUsed: n,
  ...extra,
});
// The decoder reports the size the header declares.
const decode = async (blob: Blob) => {
  const view = new DataView(await blob.arrayBuffer());
  return {width: view.getUint32(16), height: view.getUint32(20)};
};

const count = async (db: IDBDatabase) =>
  request(
    db.transaction(STORES.homeFrames).objectStore(STORES.homeFrames).count(),
  );

describe('home frames repository', () => {
  it('AC-UX-082.1: an oversized non-PNG strip is deleted and returns null', async () => {
    const {db} = await freshDatabaseWrap();
    const repo = createHomeFramesRepository({db});
    const jpeg = new Blob([new Uint8Array(2 * 1024 * 1024)]);
    // bypass put()'s own check to simulate a tampered store
    const tx = db.transaction(STORES.homeFrames, 'readwrite');
    tx.objectStore(STORES.homeFrames).put(rec(1, {strip: jpeg}));
    await new Promise(r => (tx.oncomplete = () => r(null)));
    expect(await repo.get(key(1), decode)).toBeNull();
    expect(await count(db)).toBe(0);
  });

  it('AC-UX-082.1: wrong decoded dimensions delete the record; a valid one is returned', async () => {
    const {db} = await freshDatabaseWrap();
    const repo = createHomeFramesRepository({db});
    const good = rec(2);
    await repo.put(good);
    const ok = await repo.get(key(2), decode);
    expect(ok?.strip.width).toBe(128);
    // bad: the strip decodes 64 wide where 128 is expected
    await repo.put(rec(3, {strip: png(64)}));
    expect(await repo.get(key(3), decode)).toBeNull();
    expect(await count(db)).toBe(1);
  });

  it('AC-UX-082.1: an IHDR declaring a huge size is rejected before decode runs', async () => {
    const {db} = await freshDatabaseWrap();
    const repo = createHomeFramesRepository({db});
    const tx = db.transaction(STORES.homeFrames, 'readwrite');
    tx.objectStore(STORES.homeFrames).put(rec(4, {strip: png(65535, 65535)}));
    await new Promise(r => (tx.oncomplete = () => r(null)));
    let decoded = 0;
    const counting = async (blob: Blob) => {
      decoded++;
      return decode(blob);
    };
    expect(await repo.get(key(4), counting)).toBeNull();
    expect(decoded).toBe(0);
    expect(await count(db)).toBe(0);
  });

  it('AC-UX-082.2: 80 unreferenced records are capped at 64, least recently used first', async () => {
    const {db} = await freshDatabaseWrap();
    const repo = createHomeFramesRepository({db});
    for (let i = 1; i <= 80; i++) await repo.put(rec(i));
    const removed = await repo.evictUnreferenced(new Set());
    expect(removed).toBe(16);
    const keys = (await request(
      db
        .transaction(STORES.homeFrames)
        .objectStore(STORES.homeFrames)
        .getAllKeys(),
    )) as string[];
    expect(keys).toHaveLength(64);
    expect(keys).not.toContain(key(16)); // the 16 oldest are gone
    expect(keys).toContain(key(17));
    expect(keys).toContain(key(80));
  });
});

async function freshDatabaseWrap() {
  return freshDatabase();
}
