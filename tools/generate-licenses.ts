/**
 * `pnpm assets:licenses [--check]` (spec 011 REQ-AST-018): regenerates the
 * bundled-assets section of `ASSETS_LICENSE.md` between its markers from the
 * pack manifests. `--check` writes nothing and exits 1 when the file differs
 * (CI, AC-AST-018.1).
 */
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncLicenses} from './lib/check/licenses-io.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  if (args.some(a => a !== '--check')) {
    console.error('Usage: pnpm assets:licenses [--check]');
    return 2;
  }
  const result = await syncLicenses(
    resolve(REPO_ROOT, 'assets/packs'),
    resolve(REPO_ROOT, 'ASSETS_LICENSE.md'),
    !check,
  );
  if (!result.changed) {
    console.log('assets:licenses: ASSETS_LICENSE.md is up to date.');
    return 0;
  }
  if (check) {
    console.error(
      `assets:licenses: ASSETS_LICENSE.md is out of date; run pnpm assets:licenses.\n${result.diff.slice(0, 40).join('\n')}`,
    );
    return 1;
  }
  console.log('assets:licenses: ASSETS_LICENSE.md regenerated.');
  return 0;
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
