import {fail, ok} from './types';
import type {Result} from './types';

/** IndexedDB database name (REQ-UX-025). */
export const DB_NAME = 'csg';
/** IndexedDB schema version. */
export const DB_VERSION = 1;

/** Object store names of the `csg` database. */
export const STORES = {
  projects: 'projects',
  snapshots: 'project-snapshots',
  homeFrames: 'home-frames',
  userAssets: 'user-assets',
  boneMapPresets: 'bone-map-presets',
} as const;

/** An open `csg` database. */
export interface CsgDatabase {
  readonly db: IDBDatabase;
}

/** Awaits an IDB request. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'));
  });
}

/** Resolves when a transaction commits; rejects when it aborts or errors. */
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB error'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
  });
}

/**
 * Opens (and on first use creates) the `csg` database.
 *
 * @param idb The factory; defaults to `indexedDB`.
 * @returns The database, or `UX_STORAGE_UNAVAILABLE` when IndexedDB is missing, blocked or fails.
 */
export async function openCsgDatabase(
  idb: IDBFactory | undefined = globalThis.indexedDB,
): Promise<Result<CsgDatabase>> {
  const unavailable = (detail: string) =>
    fail({
      code: 'UX_STORAGE_UNAVAILABLE' as const,
      message: `Local storage is unavailable: ${detail}`,
    });
  if (idb === undefined) return unavailable('IndexedDB is not supported');
  try {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(STORES.projects, {keyPath: 'meta.projectId'});
      db.createObjectStore(STORES.snapshots, {keyPath: ['projectId', 'seq']});
      db.createObjectStore(STORES.homeFrames, {keyPath: 'key'});
      db.createObjectStore(STORES.userAssets, {keyPath: 'id'});
      db.createObjectStore(STORES.boneMapPresets, {keyPath: 'id'});
    };
    return ok({db: await request(req)});
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : 'open failed');
  }
}
