/**
 * `pnpm fixtures:build` (spec 011 REQ-AST-021): regenerates the synthetic fixtures under
 * `packages/engine/test/fixtures/` and `packages/parts-schema/test/fixtures/`. The two README
 * files are hand-written and left alone. Exit 1 when a size budget is exceeded.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  buildFixtures,
} from './build-fixtures.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function main(): Promise<number> {
  const files = await buildFixtures();
  let total = 0;
  for (const [path, content] of files) {
    const size =
      typeof content === 'string' ? Buffer.byteLength(content) : content.length;
    total += size;
    if (size > MAX_FILE_BYTES) {
      console.error(`FIXTURE_TOO_LARGE ${path}: ${size} > ${MAX_FILE_BYTES}`);
      return 1;
    }
    const abs = join(root, path);
    await mkdir(dirname(abs), {recursive: true});
    await writeFile(abs, content);
  }
  if (total > MAX_TOTAL_BYTES) {
    console.error(`FIXTURE_TOTAL_TOO_LARGE ${total} > ${MAX_TOTAL_BYTES}`);
    return 1;
  }
  console.log(`fixtures:build wrote ${files.size} files, ${total} bytes`);
  return 0;
}

process.exitCode = await main();
