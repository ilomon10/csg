import type {ProjectDocument} from '@csg/parts-schema';

/** Error codes owned by the shell (spec 009 Data & contracts, spec 014). */
export type UxErrorCode =
  | 'UX_PROJECT_INVALID'
  | 'UX_PROJECT_NOT_FOUND'
  | 'UX_SAVE_FAILED'
  | 'UX_STORAGE_UNAVAILABLE';

/** A shell error: a stable code, a message for the user and the first failing path, if any. */
export interface UxError {
  readonly code: UxErrorCode;
  readonly message: string;
  /** Dotted path of the first schema issue (AC-UX-028.2, AC-UX-045.3). */
  readonly path?: string;
}

/** Success or failure without exceptions. */
export type Result<T, E = UxError> =
  | {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly error: E};

/** Builds a success result. */
export function ok<T>(value: T): Result<T, never> {
  return {ok: true, value};
}

/** Builds a failure result. */
export function fail<E = UxError>(error: E): Result<never, E> {
  return {ok: false, error};
}

/** Home-screen metadata kept beside each project record (spec 014 REQ-UX-072, REQ-UX-079). */
export interface ProjectListMeta {
  readonly projectId: string;
  /** 1 to 64 characters; render as text only. */
  name: string;
  /** Epoch ms. */
  lastEditedAt: number;
  pinned: boolean;
  homeFramesKey?: string;
}

/** Record of the IndexedDB store `projects`. */
export interface ProjectRecord {
  readonly format: 'sprite-project-record';
  readonly version: 1;
  readonly meta: ProjectListMeta;
  readonly doc: ProjectDocument;
}

/** One entry of the autosave ring (REQ-UX-026). */
export interface SnapshotMeta {
  readonly projectId: string;
  readonly seq: number;
  /** Epoch ms. */
  readonly savedAt: number;
  readonly bytes: number;
}

/** A decoded image as far as the home-frames checks need it. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  close?(): void;
}

/** Decodes a blob, normally with `createImageBitmap` (REQ-UX-082). */
export type ImageDecoder = (blob: Blob) => Promise<DecodedImage>;

/** Record of the IndexedDB store `home-frames` (spec 014 REQ-UX-082). */
export interface HomeFramesRecord {
  readonly format: 'sprite-home-frames';
  readonly version: 1;
  /** Lowercase hex SHA-256 cache key. */
  readonly key: string;
  /** 1 to 32. */
  readonly frameCount: number;
  /** 1 to 30. */
  readonly fps: number;
  /** PNG, (64 x frameCount) x 64 px, at most 512 KB. */
  readonly strip: Blob;
  /** PNG, 64 x 64 px, at most 64 KB. */
  readonly avatar: Blob;
  /** Epoch ms, LRU bookkeeping only. */
  lastUsed: number;
}

/** A home-frames record that passed every check, with its decoded images. */
export interface ValidHomeFrames {
  readonly record: HomeFramesRecord;
  readonly strip: DecodedImage;
  readonly avatar: DecodedImage;
}

/** `navigator.storage.estimate()` as far as the free-space check needs it. */
export interface StorageEstimateLike {
  readonly quota?: number;
  readonly usage?: number;
}

/** Timer functions, injectable so tests use fake timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Real timers; resolved at call time so Vitest fake timers apply. */
export const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Logs a validation problem in development builds only (AC-UX-029.2, AC-UX-082.1). */
export function devWarn(message: string): void {
  if (import.meta.env.DEV) console.warn(`[csg] ${message}`);
}
