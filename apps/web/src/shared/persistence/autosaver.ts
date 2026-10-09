import type {ProjectDocument} from '@csg/parts-schema';
import type {ProjectRepository} from './project-repository';
import {realTimers} from './types';
import type {Result, StorageEstimateLike, Timers, UxError} from './types';

/** Idle time before an autosave (REQ-UX-026). */
export const AUTOSAVE_IDLE_MS = 2000;
/** Longest time an unsaved change waits during continuous editing (REQ-UX-026). */
export const AUTOSAVE_MAX_MS = 10_000;

/** Save state shown in the top bar (REQ-UX-027). */
export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'failed';

/** The slice of the document store the autosaver reads (structurally a `DocumentStore`). */
export interface AutosaveSource {
  getState(): {
    readonly projectId: string | null;
    readonly doc: ProjectDocument | null;
    readonly revision: number;
    readonly savedRevision: number;
    readonly readOnly: boolean;
  };
  subscribe(listener: () => void): () => void;
  markSaved(revision: number): void;
}

/** Options of {@link createAutosaver}. */
export interface AutosaverOptions {
  readonly store: AutosaveSource;
  readonly repo: ProjectRepository;
  readonly timers?: Timers;
  readonly estimate?: () => Promise<StorageEstimateLike>;
}

/** Debounced, bounded autosave of the open project (REQ-UX-025..027, 030, 050). */
export interface Autosaver {
  status(): SaveStatus;
  /** The error of the last failed save, if the status is `failed`. */
  lastError(): UxError | null;
  subscribe(listener: () => void): () => void;
  /** Mod+S: saves immediately, without adding an autosave snapshot. Resolves true on success. */
  saveNow(): Promise<boolean>;
  /** Retries after a failure. */
  retry(): Promise<boolean>;
  /** True while a save is pending, running or failed: `beforeunload` must confirm (REQ-UX-030). */
  needsConfirmOnUnload(): boolean;
  dispose(): void;
}

interface Pending {
  projectId: string;
  doc: ProjectDocument;
  revision: number;
}

/** Creates the autosaver and starts watching the store. */
export function createAutosaver(options: AutosaverOptions): Autosaver {
  const {store, repo} = options;
  const timers = options.timers ?? realTimers;
  const listeners = new Set<() => void>();
  let status: SaveStatus = 'saved';
  let error: UxError | null = null;
  let pending: Pending | null = null;
  let idleTimer: unknown = null;
  let maxTimer: unknown = null;
  let saving: Promise<boolean> | null = null;

  const setStatus = (next: SaveStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of [...listeners]) listener();
  };
  const clearTimers = () => {
    if (idleTimer !== null) timers.clearTimeout(idleTimer);
    if (maxTimer !== null) timers.clearTimeout(maxTimer);
    idleTimer = null;
    maxTimer = null;
  };

  async function write(job: Pending, snapshot: boolean): Promise<Result<void>> {
    const bytes = JSON.stringify(job.doc).length;
    if (options.estimate !== undefined) {
      const {quota, usage} = await options.estimate();
      if (
        quota !== undefined &&
        usage !== undefined &&
        quota - usage < bytes * 2
      ) {
        return {
          ok: false,
          error: {
            code: 'UX_SAVE_FAILED',
            message: 'Not enough free storage to save.',
          },
        };
      }
    }
    const saved = await repo.saveDocument(job.projectId, job.doc);
    if (!saved.ok || !snapshot) return saved;
    return repo.putSnapshot(job.projectId, job.doc);
  }

  function flush(snapshot: boolean): Promise<boolean> {
    if (saving !== null) return saving.then(() => flush(snapshot));
    clearTimers();
    const job = pending;
    if (job === null) return Promise.resolve(status !== 'failed');
    pending = null;
    setStatus('saving');
    saving = (async () => {
      let result: Result<void>;
      try {
        result = await write(job, snapshot);
      } catch (e) {
        result = {
          ok: false,
          error: {
            code: 'UX_SAVE_FAILED',
            message: e instanceof Error ? e.message : 'Save failed',
          },
        };
      }
      saving = null;
      if (result.ok) {
        error = null;
        const state = store.getState();
        if (state.projectId === job.projectId) store.markSaved(job.revision);
        if (pending !== null) schedule();
        else setStatus('saved');
        return true;
      }
      error = result.error;
      pending ??= job; // keep the newest unsaved document for Retry
      setStatus('failed');
      return false;
    })();
    return saving;
  }

  function schedule() {
    setStatus(status === 'failed' ? 'failed' : 'unsaved');
    if (idleTimer !== null) timers.clearTimeout(idleTimer);
    idleTimer = timers.setTimeout(() => void flush(true), AUTOSAVE_IDLE_MS);
    maxTimer ??= timers.setTimeout(() => void flush(true), AUTOSAVE_MAX_MS);
  }

  function onChange() {
    const state = store.getState();
    if (pending !== null && pending.projectId !== state.projectId) {
      // The user switched project with unsaved work: write the old one first.
      void flush(true);
    }
    if (state.projectId === null || state.doc === null) return;
    if (state.readOnly) return;
    if (state.revision > state.savedRevision) {
      pending = {
        projectId: state.projectId,
        doc: state.doc,
        revision: state.revision,
      };
      if (saving === null) schedule();
      else setStatus(status); // the running save reschedules when it ends
    }
  }

  const unsubscribe = store.subscribe(onChange);

  return {
    status: () => status,
    lastError: () => error,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    saveNow: () => flush(false),
    retry: () => flush(true),
    needsConfirmOnUnload: () =>
      status === 'unsaved' || status === 'saving' || status === 'failed',
    dispose() {
      unsubscribe();
      clearTimers();
      listeners.clear();
    },
  };
}
