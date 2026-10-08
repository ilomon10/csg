import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import type {SpecFile} from './spec-ids';

/** Repository root (tools/ is one level below). */
export const ROOT = new URL('..', import.meta.url).pathname;

/** Reads `specs/*.md` except the template and generated traceability file. */
export function readSpecs(): SpecFile[] {
  const dir = join(ROOT, 'specs');
  return readdirSync(dir)
    .filter(
      f => f.endsWith('.md') && f !== '_template.md' && f !== 'traceability.md',
    )
    .sort()
    .map(f => ({
      name: `specs/${f}`,
      content: readFileSync(join(dir, f), 'utf8'),
    }));
}

/** Recursively lists test files (not tools/: its tests use fixture IDs). */
export function readTests(): SpecFile[] {
  const out: SpecFile[] = [];
  const skip = new Set([
    'node_modules',
    'dist',
    'coverage',
    '.git',
    '.next',
    'docs',
    'specs',
  ]);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (/\.(test|spec)\.tsx?$/.test(entry)) {
        out.push({
          name: relative(ROOT, path),
          content: readFileSync(path, 'utf8'),
        });
      }
    }
  };
  for (const top of ['packages', 'apps']) walk(join(ROOT, top));
  return out;
}
