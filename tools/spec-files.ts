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

/**
 * Whether a repo-relative test path is excluded from traceability: the spec-ID tool's own tests
 * (`tools/spec-*.test.ts`, `tools/hooks/guard-spec-ids.test.ts`) use fake IDs as fixtures.
 */
export function isTraceExcluded(relPath: string): boolean {
  return /^tools\/(spec-[^/]*|hooks\/guard-spec-ids)\.test\.tsx?$/.test(
    relPath.split('\\').join('/'),
  );
}

/** Recursively lists test files under packages/, apps/ and tools/ (minus {@link isTraceExcluded}). */
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
        const name = relative(ROOT, path);
        if (isTraceExcluded(name)) continue;
        out.push({name, content: readFileSync(path, 'utf8')});
      }
    }
  };
  for (const top of ['packages', 'apps', 'tools']) walk(join(ROOT, top));
  return out;
}
