import {execFileSync} from 'node:child_process';
import {collectDefinedIds, removedIds} from './spec-ids';
import type {SpecFile} from './spec-ids';
import {ROOT, readSpecs} from './spec-files';

/** Runs git in the repo root; returns null when it fails. */
function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Picks the base ref: `--base`, else merge-base with origin/main, else HEAD. */
function resolveBase(): string | null {
  const i = process.argv.indexOf('--base');
  const given = i >= 0 ? process.argv[i + 1] : undefined;
  if (given) return given;
  if (git('rev-parse', '--verify', '--quiet', 'HEAD') === null) return null;
  if (git('rev-parse', '--verify', '--quiet', 'origin/main') !== null) {
    const mb = git('merge-base', 'HEAD', 'origin/main')?.trim();
    if (mb) return mb;
  }
  return 'HEAD';
}

/** Reads `specs/*.md` as committed at a ref. */
function readSpecsAt(ref: string): SpecFile[] | null {
  const list = git('ls-tree', '--name-only', ref, 'specs/');
  if (list === null) return null;
  return list
    .split('\n')
    .filter(
      f =>
        /^specs\/[^/]+\.md$/.test(f) &&
        f !== 'specs/_template.md' &&
        f !== 'specs/traceability.md',
    )
    .map(name => ({name, content: git('show', `${ref}:${name}`) ?? ''}));
}

const base = resolveBase();
if (base === null) {
  console.log('spec:immutability ok (skipped: no git history yet).');
  process.exit(0);
}
const baseSpecs = readSpecsAt(base);
const baseIds = collectDefinedIds(baseSpecs ?? []);
if (baseIds.size === 0) {
  console.log(`spec:immutability ok (skipped: no spec IDs at ${base}).`);
  process.exit(0);
}
const removed = removedIds(baseIds, collectDefinedIds(readSpecs()));
if (removed.length > 0) {
  console.error(
    `spec:immutability failed: ${removed.length} ID(s) present at ${base} are gone.\n` +
      'IDs are permanent (ADR-0006). Restore them and deprecate with ~~strikethrough~~ and a reason.\n',
  );
  for (const r of removed) console.error(`  - ${r.id} (was ${r.was})`);
  process.exit(1);
}
console.log(
  `spec:immutability ok: ${baseIds.size} IDs from ${base} all still present.`,
);
