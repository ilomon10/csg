import {
  MAX_PROJECT_JSON_BYTES,
  findForbiddenKey,
  parseProjectDocument,
} from '@csg/parts-schema';
import type {ProjectDocument} from '@csg/parts-schema';
import {z} from 'zod';
import {STORES, request, transactionDone} from './database';
import type {CsgDatabase} from './database';
import {createTabChannel} from './tab-message';
import type {ChannelFactory} from './tab-message';
import {devWarn, fail, ok} from './types';
import type {
  ProjectListMeta,
  ProjectRecord,
  Result,
  SnapshotMeta,
  StorageEstimateLike,
} from './types';

/** Autosave snapshots kept per project (REQ-UX-026). */
export const SNAPSHOT_RING_SIZE = 10;
/** BroadcastChannel name for project list changes. */
export const PROJECTS_CHANNEL = 'csg-projects';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const metaSchema = z
  .object({
    projectId: idSchema,
    name: z.string().min(1).max(64),
    lastEditedAt: z.number().finite(),
    pinned: z.boolean(),
    homeFramesKey: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

/** Validates one list meta read from storage. */
export function parseProjectListMeta(value: unknown): ProjectListMeta | null {
  const parsed = metaSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const invalid = (message: string, path?: string) =>
  fail({
    code: 'UX_PROJECT_INVALID' as const,
    message,
    ...(path === undefined ? {} : {path}),
  });

/** Validates a stored document with the same rules as a file import (REQ-GEN-013). */
function validateDoc(raw: unknown): Result<ProjectDocument> {
  const forbidden = findForbiddenKey(raw);
  if (forbidden !== null) {
    return invalid(`Forbidden key at ${forbidden}`, forbidden);
  }
  // Same limit as a file import (REQ-GEN-013); sizeOf is bounded by the structure guard above.
  if (sizeOf(raw) > MAX_PROJECT_JSON_BYTES) {
    return invalid('The stored project is larger than the 1 MB limit.');
  }
  const parsed = parseProjectDocument(raw);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    return invalid(first?.message ?? 'Invalid project', first?.path);
  }
  return ok(parsed.value);
}

function validateRecord(raw: unknown): Result<ProjectRecord> {
  if (typeof raw !== 'object' || raw === null) return invalid('Not a record');
  const r = raw as Record<string, unknown>;
  if (r['format'] !== 'sprite-project-record' || r['version'] !== 1) {
    return invalid('Unknown record format', 'format');
  }
  const meta = parseProjectListMeta(r['meta']);
  if (meta === null) return invalid('Invalid project metadata', 'meta');
  const doc = validateDoc(r['doc']);
  if (!doc.ok) return doc;
  return ok({
    format: 'sprite-project-record',
    version: 1,
    meta,
    doc: doc.value,
  });
}

/**
 * Serialized size of a document in bytes (UTF-16 length is a safe upper bound proxy). Data that
 * fails the structure guard (cycle, DAG, too deep or large) or cannot be serialized counts as
 * over the limit, so a hostile stored value never reaches an unbounded `JSON.stringify`.
 */
function sizeOf(value: unknown): number {
  try {
    if (findForbiddenKey(value) !== null) return MAX_PROJECT_JSON_BYTES + 1;
    return JSON.stringify(value).length;
  } catch {
    return MAX_PROJECT_JSON_BYTES + 1;
  }
}

/** Repository of projects and their autosave ring (REQ-UX-025, 026, 050). */
export interface ProjectRepository {
  /** Valid records only; invalid ones are skipped with a dev warning. Newest first. */
  list(): Promise<ProjectListMeta[]>;
  get(id: string): Promise<Result<ProjectRecord>>;
  /** Free-space check first (REQ-UX-050). */
  put(record: ProjectRecord): Promise<Result<void>>;
  /**
   * Saves a document, keeping an existing record's name, pin and frames key; a new record is
   * named after the character.
   */
  saveDocument(id: string, doc: ProjectDocument): Promise<Result<void>>;
  /** Changes the list metadata only (rename, pin). */
  updateMeta(
    id: string,
    patch: Partial<Pick<ProjectListMeta, 'name' | 'pinned' | 'homeFramesKey'>>,
  ): Promise<Result<void>>;
  /** Removes the project, its snapshots and its home frames (AC-UX-079.2). */
  remove(id: string): Promise<void>;
  /** Appends to the ring of {@link SNAPSHOT_RING_SIZE}. */
  putSnapshot(id: string, doc: ProjectDocument): Promise<Result<void>>;
  /** Newest first. */
  listSnapshots(id: string): Promise<SnapshotMeta[]>;
  /** Validates the snapshot like an import (AC-UX-045.3); never modifies it. */
  getSnapshot(id: string, seq: number): Promise<Result<ProjectDocument>>;
  /** Bytes of projects, snapshots and home frames (REQ-UX-050). */
  usageBytes(): Promise<number>;
  /** Other tabs wrote these projects. Returns an unsubscribe function. */
  onChange(listener: (ids: readonly string[]) => void): () => void;
}

/** Options of {@link createProjectRepository}. */
export interface ProjectRepositoryOptions {
  readonly database: CsgDatabase;
  readonly estimate?: () => Promise<StorageEstimateLike>;
  readonly channelFactory?: ChannelFactory;
  readonly now?: () => number;
}

/** Creates the project repository over an open database. */
export function createProjectRepository(
  options: ProjectRepositoryOptions,
): ProjectRepository {
  const {db} = options.database;
  const now = options.now ?? (() => Date.now());
  const channel = createTabChannel(PROJECTS_CHANNEL, options.channelFactory);

  const storageError = (error: unknown) =>
    fail({
      code: 'UX_SAVE_FAILED' as const,
      message: `Could not write to local storage: ${error instanceof Error ? error.message : 'unknown error'}`,
    });

  /** Rejects writes above the document cap or the free space (REQ-UX-050). */
  async function checkSpace(bytes: number): Promise<Result<void>> {
    if (bytes > MAX_PROJECT_JSON_BYTES) {
      return fail({
        code: 'UX_SAVE_FAILED',
        message: 'The project is larger than the 1 MB limit.',
      });
    }
    if (options.estimate !== undefined) {
      const {quota, usage} = await options.estimate();
      if (quota !== undefined && usage !== undefined) {
        const free = quota - usage;
        if (free < bytes * 2) {
          return fail({
            code: 'UX_SAVE_FAILED',
            message: 'Not enough free storage to save.',
          });
        }
      }
    }
    return ok(undefined);
  }

  async function readAll(): Promise<unknown[]> {
    return request(
      db.transaction(STORES.projects).objectStore(STORES.projects).getAll(),
    );
  }

  const repo: ProjectRepository = {
    async list() {
      const metas: ProjectListMeta[] = [];
      for (const raw of await readAll()) {
        const meta = parseProjectListMeta(
          (raw as {meta?: unknown} | null)?.meta,
        );
        if (meta === null)
          devWarn('Skipped a project record with invalid metadata');
        else metas.push(meta);
      }
      return metas.sort((a, b) => b.lastEditedAt - a.lastEditedAt);
    },

    async get(id) {
      const raw = await request(
        db
          .transaction(STORES.projects)
          .objectStore(STORES.projects)
          .get(id) as IDBRequest<unknown>,
      );
      if (raw === undefined) {
        return fail({
          code: 'UX_PROJECT_NOT_FOUND',
          message: 'This project no longer exists.',
        });
      }
      return validateRecord(raw);
    },

    async put(record) {
      const space = await checkSpace(sizeOf(record.doc));
      if (!space.ok) return space;
      try {
        const tx = db.transaction(STORES.projects, 'readwrite');
        tx.objectStore(STORES.projects).put(record);
        await transactionDone(tx);
      } catch (error) {
        return storageError(error);
      }
      channel.post({type: 'changed', projectIds: [record.meta.projectId]});
      return ok(undefined);
    },

    async saveDocument(id, doc) {
      const existing = await repo.get(id);
      const meta: ProjectListMeta = existing.ok
        ? {...existing.value.meta, lastEditedAt: now()}
        : {
            projectId: id,
            name: doc.character.name,
            lastEditedAt: now(),
            pinned: false,
          };
      return repo.put({format: 'sprite-project-record', version: 1, meta, doc});
    },

    async updateMeta(id, patch) {
      const existing = await repo.get(id);
      if (!existing.ok) return existing;
      const meta = parseProjectListMeta({...existing.value.meta, ...patch});
      if (meta === null) return invalid('Invalid project metadata', 'meta');
      return repo.put({...existing.value, meta});
    },

    async remove(id) {
      const tx = db.transaction(
        [STORES.projects, STORES.snapshots, STORES.homeFrames],
        'readwrite',
      );
      const projects = tx.objectStore(STORES.projects);
      const removed = (await request(
        projects.get(id) as IDBRequest<unknown>,
      )) as {meta?: unknown} | undefined;
      const framesKey = parseProjectListMeta(removed?.meta)?.homeFramesKey;
      projects.delete(id);
      tx.objectStore(STORES.snapshots).delete(
        IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
      );
      if (framesKey !== undefined) {
        // Frames are keyed by character content, so another project may share them.
        const others = (await request(projects.getAll())) as unknown[];
        const shared = others.some(
          raw =>
            parseProjectListMeta((raw as {meta?: unknown} | null)?.meta)
              ?.homeFramesKey === framesKey,
        );
        if (!shared) tx.objectStore(STORES.homeFrames).delete(framesKey);
      }
      await transactionDone(tx);
      channel.post({type: 'changed', projectIds: [id]});
    },

    async putSnapshot(id, doc) {
      const space = await checkSpace(sizeOf(doc));
      if (!space.ok) return space;
      try {
        const tx = db.transaction(STORES.snapshots, 'readwrite');
        const store = tx.objectStore(STORES.snapshots);
        const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
        const keys = (await request(store.getAllKeys(range))) as Array<
          [string, number]
        >;
        const seqs = keys.map(key => key[1]).sort((a, b) => a - b);
        const next = (seqs[seqs.length - 1] ?? 0) + 1;
        store.put({projectId: id, seq: next, savedAt: now(), doc});
        for (const seq of seqs.slice(
          0,
          Math.max(0, seqs.length + 1 - SNAPSHOT_RING_SIZE),
        )) {
          store.delete([id, seq]);
        }
        await transactionDone(tx);
      } catch (error) {
        return storageError(error);
      }
      return ok(undefined);
    },

    async listSnapshots(id) {
      const rows = (await request(
        db
          .transaction(STORES.snapshots)
          .objectStore(STORES.snapshots)
          .getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])),
      )) as Array<{seq: unknown; savedAt: unknown; doc: unknown}>;
      return rows
        .filter(
          row =>
            Number.isSafeInteger(row.seq) && typeof row.savedAt === 'number',
        )
        .map(row => ({
          projectId: id,
          seq: row.seq as number,
          savedAt: row.savedAt as number,
          bytes: sizeOf(row.doc),
        }))
        .sort((a, b) => b.seq - a.seq);
    },

    async getSnapshot(id, seq) {
      const row = await request(
        db
          .transaction(STORES.snapshots)
          .objectStore(STORES.snapshots)
          .get([id, seq]) as IDBRequest<{doc?: unknown} | undefined>,
      );
      if (row === undefined) {
        return fail({
          code: 'UX_PROJECT_NOT_FOUND',
          message: 'This autosave no longer exists.',
        });
      }
      return validateDoc(row.doc);
    },

    async usageBytes() {
      const tx = db.transaction([
        STORES.projects,
        STORES.snapshots,
        STORES.homeFrames,
      ]);
      const [projects, snapshots, frames] = (await Promise.all([
        request(tx.objectStore(STORES.projects).getAll()),
        request(tx.objectStore(STORES.snapshots).getAll()),
        request(tx.objectStore(STORES.homeFrames).getAll()),
      ])) as [
        Array<{doc?: unknown}>,
        Array<{doc?: unknown}>,
        Array<{strip?: Blob; avatar?: Blob}>,
      ];
      let total = 0;
      for (const row of [...projects, ...snapshots])
        total += sizeOf(row.doc ?? null);
      for (const row of frames)
        total += (row.strip?.size ?? 0) + (row.avatar?.size ?? 0);
      return total;
    },

    onChange(listener) {
      return channel.subscribe(message => {
        if (message.type === 'changed') listener(message.projectIds);
      });
    },
  };
  return repo;
}
