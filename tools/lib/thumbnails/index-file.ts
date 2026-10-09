/**
 * `assets/packs/<packId>/thumbnails/index.json`: the generated record of `pnpm assets:thumbnails`
 * (spec 011 REQ-AST-015, REQ-AST-039). One entry per thumbnail with the plan's `inputs` hash and
 * the file's SHA-256, so `assets:check` can tell a current thumbnail from a stale one without a
 * GPU. Pure; the I/O lives in `tools/thumbnails.ts` and `tools/lib/check/thumbnails.ts`.
 */
import {createHash} from 'node:crypto';
import {canonicalJson} from '../build/canonical-json.js';
import type {CheckIssue} from '../check/types.js';
import {MAX_THUMBNAIL_BYTES} from './jobs.js';
import type {ThumbnailJob, ThumbnailKind} from './jobs.js';
import {readWebpInfo} from './webp.js';

/** Pack-relative path of the index. */
export const THUMBNAIL_INDEX_PATH = 'thumbnails/index.json';

/** One recorded thumbnail. */
export interface ThumbnailIndexEntry {
  readonly path: string;
  readonly kind: ThumbnailKind;
  readonly id: string;
  /** `ThumbnailJob.inputs` the file was rendered from. */
  readonly inputs: string;
  /** SHA-256 of the file. */
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

/** The index document. */
export interface ThumbnailIndex {
  readonly format: 'sprite-thumbnail-index';
  readonly version: 1;
  readonly thumbnails: readonly ThumbnailIndexEntry[];
}

/** Lowercase hex SHA-256. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Canonical JSON of an index, entries sorted by path. */
export function serializeThumbnailIndex(
  entries: readonly ThumbnailIndexEntry[],
): string {
  const doc: ThumbnailIndex = {
    format: 'sprite-thumbnail-index',
    version: 1,
    thumbnails: [...entries].sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
  return canonicalJson(doc);
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Parses an untrusted index; entries that do not validate are dropped. `null` when not an index. */
export function parseThumbnailIndex(
  json: unknown,
): Map<string, ThumbnailIndexEntry> | null {
  if (typeof json !== 'object' || json === null) return null;
  const doc = json as Record<string, unknown>;
  if (doc['format'] !== 'sprite-thumbnail-index' || doc['version'] !== 1)
    return null;
  if (!Array.isArray(doc['thumbnails'])) return null;
  const out = new Map<string, ThumbnailIndexEntry>();
  for (const e of doc['thumbnails'] as unknown[]) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    if (
      typeof r['path'] === 'string' &&
      typeof r['id'] === 'string' &&
      typeof r['kind'] === 'string' &&
      typeof r['inputs'] === 'string' &&
      typeof r['sha256'] === 'string' &&
      HEX64.test(r['sha256']) &&
      Number.isInteger(r['width']) &&
      Number.isInteger(r['height'])
    ) {
      out.set(r['path'], r as unknown as ThumbnailIndexEntry);
    }
  }
  return out;
}

/**
 * Problems of one thumbnail file against its job: not a lossless WebP of `cellPx * scale`
 * square, or over {@link MAX_THUMBNAIL_BYTES}. Empty when valid.
 */
export function thumbnailFileProblems(
  job: Pick<ThumbnailJob, 'cellPx' | 'scale'>,
  bytes: Uint8Array,
): string[] {
  const side = job.cellPx * job.scale;
  const info = readWebpInfo(bytes);
  const out: string[] = [];
  if (info === null) return ['is not a WebP file'];
  if (info.chunk !== 'VP8L') out.push(`is not lossless WebP (${info.chunk})`);
  if (info.width !== side || info.height !== side)
    out.push(`is ${info.width}x${info.height}, expected ${side}x${side}`);
  if (bytes.length > MAX_THUMBNAIL_BYTES)
    out.push(`is ${bytes.length} bytes, over ${MAX_THUMBNAIL_BYTES}`);
  return out;
}

/**
 * Stale and invalid thumbnails of one pack (warnings; thumbnails need a GPU, so they never fail
 * the check). A missing file is not reported here: the part and preset checks warn
 * `AST_THUMBNAIL_MISSING` for those.
 *
 * - `AST_THUMBNAIL_STALE`: the file exists but the index has no entry for it, the file's hash
 *   differs from the entry, or the entry's `inputs` differ from the current plan (a part, preset,
 *   rig, clip or the recipe changed).
 * - `AST_THUMBNAIL_INVALID`: {@link thumbnailFileProblems}.
 */
export function checkPackThumbnails(args: {
  packId: string;
  jobs: readonly ThumbnailJob[];
  /** Bytes of each job's file, `undefined` when absent. */
  files: ReadonlyMap<string, Uint8Array | undefined>;
  /** Parsed index, `null` when absent or invalid. */
  index: ReadonlyMap<string, ThumbnailIndexEntry> | null;
}): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const hint = 'run pnpm assets:thumbnails';
  for (const job of args.jobs) {
    if (job.packId !== args.packId) continue;
    const bytes = args.files.get(job.path);
    if (bytes === undefined) continue;
    const warn = (code: string, message: string) =>
      issues.push({
        severity: 'warn',
        code,
        packId: args.packId,
        id: job.id,
        message: `${job.id}: ${job.path} ${message}`,
      });
    const problems = thumbnailFileProblems(job, bytes);
    if (problems.length > 0) warn('AST_THUMBNAIL_INVALID', problems.join('; '));
    const entry = args.index?.get(job.path);
    if (entry === undefined) {
      warn(
        'AST_THUMBNAIL_STALE',
        `is not in ${THUMBNAIL_INDEX_PATH} (${hint}).`,
      );
    } else if (entry.sha256 !== sha256Hex(bytes)) {
      warn(
        'AST_THUMBNAIL_STALE',
        `differs from its ${THUMBNAIL_INDEX_PATH} record; do not edit thumbnails by hand (${hint}).`,
      );
    } else if (entry.inputs !== job.inputs) {
      warn(
        'AST_THUMBNAIL_STALE',
        `was rendered from inputs that changed since (part, preset, rig, clip or recipe; ${hint}).`,
      );
    }
  }
  return issues;
}
