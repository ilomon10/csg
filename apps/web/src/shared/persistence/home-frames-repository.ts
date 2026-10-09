import {STORES, request, transactionDone} from './database';
import type {CsgDatabase} from './database';
import {devWarn} from './types';
import type {
  DecodedImage,
  HomeFramesRecord,
  ImageDecoder,
  ValidHomeFrames,
} from './types';

/** Largest stored strip (REQ-UX-082). */
export const MAX_STRIP_BYTES = 512 * 1024;
/** Largest stored avatar (REQ-UX-082). */
export const MAX_AVATAR_BYTES = 64 * 1024;
/** Cap of preset and orphaned records (AC-UX-082.2). */
export const HOME_FRAMES_CAP = 64;
/** Home frame cell size in px (spec 014 `HOME_RENDER_PROFILE`). */
const CELL_PX = 64;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Repository of home frames and avatars (REQ-UX-082). Every record is untrusted. */
export interface HomeFramesRepository {
  /** The record when every check passes; otherwise deletes it and returns `null`. */
  get(key: string, decode: ImageDecoder): Promise<ValidHomeFrames | null>;
  put(record: HomeFramesRecord): Promise<void>;
  touch(key: string): Promise<void>;
  /** Keeps at most `cap` records outside `liveKeys`, least recently used removed first. */
  evictUnreferenced(
    liveKeys: ReadonlySet<string>,
    cap?: number,
  ): Promise<number>;
}

async function hasPngMagic(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return PNG_MAGIC.every((byte, i) => head[i] === byte);
}

/**
 * Reads width and height from the PNG IHDR chunk (big-endian, bytes 16..23) so a decode bomb is
 * rejected before any decoder runs. `null` when the header is too short.
 */
async function readPngSize(
  blob: Blob,
): Promise<{width: number; height: number} | null> {
  const head = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  if (head.length < 24) return null;
  const view = new DataView(head.buffer);
  return {width: view.getUint32(16), height: view.getUint32(20)};
}

/** Cheap structural checks; returns the failed check or null. */
function shapeProblem(raw: unknown, key: string): string | null {
  if (typeof raw !== 'object' || raw === null) return 'not an object';
  const r = raw as Record<string, unknown>;
  if (r['format'] !== 'sprite-home-frames' || r['version'] !== 1)
    return 'format';
  if (r['key'] !== key || !/^[0-9a-f]{64}$/.test(key)) return 'key';
  const {frameCount, fps} = r;
  if (
    !Number.isInteger(frameCount) ||
    (frameCount as number) < 1 ||
    (frameCount as number) > 32
  )
    return 'frameCount';
  if (!Number.isInteger(fps) || (fps as number) < 1 || (fps as number) > 30)
    return 'fps';
  if (!(r['strip'] instanceof Blob)) return 'strip is not a Blob';
  if (!(r['avatar'] instanceof Blob)) return 'avatar is not a Blob';
  if (r['strip'].size > MAX_STRIP_BYTES) return 'strip size';
  if (r['avatar'].size > MAX_AVATAR_BYTES) return 'avatar size';
  if (typeof r['lastUsed'] !== 'number') return 'lastUsed';
  return null;
}

/** Creates the home-frames repository over an open database. */
export function createHomeFramesRepository(
  database: CsgDatabase,
  now: () => number = () => Date.now(),
): HomeFramesRepository {
  const {db} = database;
  const store = (mode: IDBTransactionMode = 'readonly') =>
    db.transaction(STORES.homeFrames, mode).objectStore(STORES.homeFrames);

  async function drop(key: string): Promise<void> {
    const tx = db.transaction(STORES.homeFrames, 'readwrite');
    tx.objectStore(STORES.homeFrames).delete(key);
    await transactionDone(tx);
  }

  return {
    async get(key, decode) {
      const raw = await request(store().get(key) as IDBRequest<unknown>);
      if (raw === undefined) return null;
      const reject = async (why: string) => {
        devWarn(`home-frames record ${key.slice(0, 8)} rejected: ${why}`);
        await drop(key);
        return null;
      };
      const problem = shapeProblem(raw, key);
      if (problem !== null) return reject(problem);
      const record = raw as HomeFramesRecord;
      if (!(await hasPngMagic(record.strip)))
        return reject('strip is not a PNG');
      if (!(await hasPngMagic(record.avatar)))
        return reject('avatar is not a PNG');
      const stripSize = await readPngSize(record.strip);
      if (
        stripSize?.width !== CELL_PX * record.frameCount ||
        stripSize.height !== CELL_PX
      )
        return reject('strip header dimensions');
      const avatarSize = await readPngSize(record.avatar);
      if (avatarSize?.width !== CELL_PX || avatarSize.height !== CELL_PX)
        return reject('avatar header dimensions');
      let strip: DecodedImage | null = null;
      let avatar: DecodedImage | null = null;
      try {
        strip = await decode(record.strip);
        avatar = await decode(record.avatar);
      } catch {
        strip?.close?.();
        return reject('image decode failed');
      }
      if (
        strip.width !== CELL_PX * record.frameCount ||
        strip.height !== CELL_PX
      ) {
        strip.close?.();
        avatar.close?.();
        return reject('strip dimensions');
      }
      if (avatar.width !== CELL_PX || avatar.height !== CELL_PX) {
        strip.close?.();
        avatar.close?.();
        return reject('avatar dimensions');
      }
      return {record, strip, avatar};
    },

    async put(record) {
      const problem = shapeProblem(record, record.key);
      if (problem !== null) {
        devWarn(`home-frames record not stored: ${problem}`);
        return;
      }
      const tx = db.transaction(STORES.homeFrames, 'readwrite');
      tx.objectStore(STORES.homeFrames).put(record);
      await transactionDone(tx);
    },

    async touch(key) {
      const tx = db.transaction(STORES.homeFrames, 'readwrite');
      const s = tx.objectStore(STORES.homeFrames);
      const raw = (await request(s.get(key) as IDBRequest<unknown>)) as
        {lastUsed?: number} | undefined;
      if (raw !== undefined) s.put({...raw, lastUsed: now()});
      await transactionDone(tx);
    },

    async evictUnreferenced(liveKeys, cap = HOME_FRAMES_CAP) {
      const tx = db.transaction(STORES.homeFrames, 'readwrite');
      const s = tx.objectStore(STORES.homeFrames);
      const rows = (await request(s.getAll())) as Array<{
        key?: unknown;
        lastUsed?: unknown;
      }>;
      const orphans = rows
        .filter(row => typeof row.key === 'string' && !liveKeys.has(row.key))
        .map(row => ({
          key: row.key as string,
          lastUsed: typeof row.lastUsed === 'number' ? row.lastUsed : 0,
        }))
        .sort((a, b) => a.lastUsed - b.lastUsed);
      const excess = orphans.slice(0, Math.max(0, orphans.length - cap));
      for (const row of excess) s.delete(row.key);
      await transactionDone(tx);
      return excess.length;
    },
  };
}
