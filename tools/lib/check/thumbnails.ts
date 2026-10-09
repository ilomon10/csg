/**
 * Thumbnail freshness of `assets:check` (spec 011 REQ-AST-015, REQ-AST-039): recomputes the
 * thumbnail plan from the built packs (no GPU) and compares each present thumbnail with its
 * `thumbnails/index.json` record. Warnings only (`AST_THUMBNAIL_STALE`, `AST_THUMBNAIL_INVALID`).
 * Reads are confined to the pack folders; everything read is untrusted.
 */
import {lstat, readFile} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {parseJson} from '@csg/parts-schema';
import {
  THUMBNAIL_INDEX_PATH,
  checkPackThumbnails,
  parseThumbnailIndex,
} from '../thumbnails/index-file.js';
import {planThumbnails} from '../thumbnails/jobs.js';
import {readPlanPacks} from '../thumbnails/read-packs.js';
import type {CheckIssue} from './types.js';

async function readRegular(
  packDir: string,
  rel: string,
): Promise<Uint8Array | undefined> {
  const abs = resolve(packDir, rel);
  if (!abs.startsWith(packDir + sep)) return undefined;
  try {
    if (!(await lstat(abs)).isFile()) return undefined;
    return new Uint8Array(await readFile(abs));
  } catch {
    return undefined;
  }
}

/** Stale and invalid thumbnails of every built pack. */
export async function checkThumbnails(packsDir: string): Promise<CheckIssue[]> {
  const packs = await readPlanPacks(packsDir);
  const {jobs} = planThumbnails(packs);
  const issues: CheckIssue[] = [];
  for (const pack of packs) {
    const packDir = resolve(packsDir, pack.packId);
    const files = new Map<string, Uint8Array | undefined>();
    for (const job of jobs) {
      if (job.packId === pack.packId)
        files.set(job.path, await readRegular(packDir, job.path));
    }
    const indexBytes = await readRegular(packDir, THUMBNAIL_INDEX_PATH);
    const indexJson =
      indexBytes === undefined
        ? undefined
        : parseJson(new TextDecoder().decode(indexBytes));
    const index =
      indexJson !== undefined && indexJson.ok
        ? parseThumbnailIndex(indexJson.value)
        : null;
    issues.push(
      ...checkPackThumbnails({packId: pack.packId, jobs, files, index}),
    );
  }
  return issues;
}
