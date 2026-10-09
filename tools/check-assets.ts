/**
 * `pnpm assets:check` (spec 011 REQ-AST-020): validates built packs without
 * `assets-src/`. Exit 0 = pass (also with no built packs), 1 = findings,
 * 2 = usage error.
 */
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseJson} from '@csg/parts-schema';
import {runAssetCheck} from './lib/check/run.js';
import {formatCheckReport} from './lib/check/report.js';
import {countIssues} from './lib/check/types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Ids of the manifest committed at HEAD (AC-AST-019.1 baseline); empty when unknown. */
async function gitPreviousIds(
  packId: string,
  kind: 'part' | 'clip',
): Promise<string[]> {
  const file = kind === 'part' ? 'manifest.json' : 'clips.json';
  try {
    const text = execFileSync(
      'git',
      ['show', `HEAD:assets/packs/${packId}/${file}`],
      {cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
    );
    const parsed = parseJson(text);
    if (!parsed.ok) return [];
    const root = parsed.value as Record<string, unknown>;
    const list = root[kind === 'part' ? 'parts' : 'clips'];
    if (!Array.isArray(list)) return [];
    return list
      .map(e => (e as {id?: unknown}).id)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    console.error('assets:check takes no arguments.');
    return 2;
  }
  const report = await runAssetCheck({
    packsDir: resolve(REPO_ROOT, 'assets/packs'),
    configsDir: resolve(REPO_ROOT, 'tools/packs'),
    rigsDir: resolve(REPO_ROOT, 'packages/parts-schema/rigs'),
    licenseFile: resolve(REPO_ROOT, 'ASSETS_LICENSE.md'),
    previousIds: gitPreviousIds,
  });
  console.log(formatCheckReport(report));
  return countIssues(report.issues).errors > 0 ? 1 : 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  e => {
    console.error(e);
    process.exitCode = 2;
  },
);
