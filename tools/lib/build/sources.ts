/**
 * Stage 1b: source tree hash and integrity check (spec 011 REQ-AST-001, REQ-AST-024).
 */
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {lstat, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {BuildError} from './types.js';
import type {LoadedPack} from './types.js';

const sha256 = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');

async function collect(
  root: string,
  rel: string,
  out: Array<[string, string]>,
): Promise<void> {
  const entries = await readdir(join(root, rel), {withFileTypes: true});
  for (const entry of entries) {
    const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
    const abs = join(root, relPath);
    // lstat, never follow: links and other non-regular entries are refused unread.
    const info = await lstat(abs);
    if (info.isDirectory()) {
      await collect(root, relPath, out);
    } else if (info.isFile()) {
      out.push([relPath, sha256(await readFile(abs))]);
    } else {
      throw new BuildError(
        'AST_SOURCE_FORMAT',
        `${relPath} is a symbolic link or non-regular entry; sources must be plain files.`,
        2,
      );
    }
  }
}

/** Compares strings as UTF-8 byte sequences. */
function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Computes the REQ-AST-024 tree hash of a folder: SHA-256 over the lines
 * `<relPath>\0<sha256>\n` of all regular files (hidden included), sorted by UTF-8 bytes of the
 * relative path. Empty directories do not contribute; symbolic links fail with `AST_SOURCE_FORMAT`.
 */
export async function hashSourceTree(dir: string): Promise<string> {
  const files: Array<[string, string]> = [];
  await collect(dir, '', files);
  files.sort((a, b) => compareBytes(a[0], b[0]));
  return sha256(files.map(([p, h]) => `${p}\0${h}\n`).join(''));
}

/** Outcome of {@link checkSources} for one pack. */
export interface SourceCheckResult {
  packId: string;
  dir: string;
  /** Absolute folder path. */
  path: string;
  /** Computed hash; absent when the folder is missing. */
  actual?: string;
  /** `ok`, `unrecorded` (no `treeSha256` yet), or `missing`. */
  status: 'ok' | 'unrecorded' | 'missing';
}

/** Download instructions printed for a missing pack folder (AC-AST-001.3). */
export function downloadInstructions(
  pack: LoadedPack,
  srcRoot: string,
): string {
  const s = pack.source;
  return [
    `Missing source pack "${pack.packId}".`,
    `  vendor URL : ${s?.vendorUrl ?? '(not listed in tools/asset-sources.json)'}`,
    `  tier       : ${s?.tier ?? 'n/a'}`,
    `  unzip into : ${join(srcRoot, pack.dir)}`,
  ].join('\n');
}

/**
 * Verifies the source folders of the given packs. A missing folder throws `AST_SOURCE_MISSING`
 * (exit 2) carrying download instructions (AC-AST-001.3); a hash that differs from the recorded
 * `treeSha256` throws `AST_SOURCE_HASH_MISMATCH` (exit 2) naming pack, expected and actual hash
 * (AC-AST-001.2). Packs without a recorded hash are reported as `unrecorded`.
 */
export async function checkSources(
  packs: readonly LoadedPack[],
  srcRoot: string,
): Promise<SourceCheckResult[]> {
  const results: SourceCheckResult[] = [];
  for (const pack of packs) {
    const path = join(srcRoot, pack.dir);
    if (!existsSync(path)) {
      throw new BuildError(
        'AST_SOURCE_MISSING',
        downloadInstructions(pack, srcRoot),
        2,
      );
    }
    const actual = await hashSourceTree(path);
    const expected = pack.source?.treeSha256 ?? null;
    if (expected !== null && expected !== actual) {
      throw new BuildError(
        'AST_SOURCE_HASH_MISMATCH',
        `pack "${pack.packId}" (${pack.dir}): expected ${expected}, actual ${actual}.`,
        2,
      );
    }
    results.push({
      packId: pack.packId,
      dir: pack.dir,
      path,
      actual,
      status: expected === null ? 'unrecorded' : 'ok',
    });
  }
  return results;
}
