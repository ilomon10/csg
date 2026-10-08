import {describe, expect, it} from 'vitest';

// The engine tsconfig has no Node types; load the few builtins structurally.
interface NodeFs {
  readdirSync(dir: string): string[];
  readFileSync(file: string, enc: 'utf8'): string;
  statSync(p: string): {isDirectory(): boolean};
}
interface NodePath {
  join(...parts: string[]): string;
  dirname(p: string): string;
}
interface NodeUrl {
  fileURLToPath(url: string): string;
}
const getBuiltin = (
  globalThis as unknown as {
    process: {getBuiltinModule(id: string): unknown};
  }
).process.getBuiltinModule;
const {readdirSync, readFileSync, statSync} = getBuiltin('node:fs') as NodeFs;
const {join, dirname} = getBuiltin('node:path') as NodePath;
const {fileURLToPath} = getBuiltin('node:url') as NodeUrl;

const here = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN =
  /\b(Math\.random|Date\.now|new Date|Date\(|performance\.now|performance\b)/;

function sources(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries.flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '');
}

describe('AC-PIX-027.2: determinism lint', () => {
  it('pipeline/ and sampler/ never use Math.random, Date or performance', () => {
    const files = [...sources(here), ...sources(join(here, '..', 'sampler'))];
    const offenders: string[] = [];
    for (const file of files) {
      strip(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (FORBIDDEN.test(line))
            offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the matcher catches the forbidden calls', () => {
    for (const bad of [
      'Math.random()',
      'Date.now()',
      'performance.now()',
      'new Date()',
    ])
      expect(FORBIDDEN.test(bad)).toBe(true);
  });
});
