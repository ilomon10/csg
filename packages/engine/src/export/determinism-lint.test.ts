import {describe, expect, it} from 'vitest';

// The engine tsconfig has no Node types; load the few builtins structurally.
interface NodeFs {
  readdirSync(dir: string): string[];
  readFileSync(file: string, enc: 'utf8'): string;
}
interface NodePath {
  dirname(p: string): string;
  join(...parts: string[]): string;
}
interface NodeUrl {
  fileURLToPath(url: string): string;
}
const getBuiltin = (
  globalThis as unknown as {
    process: {getBuiltinModule(id: string): unknown};
  }
).process.getBuiltinModule;
const {readdirSync, readFileSync} = getBuiltin('node:fs') as NodeFs;
const {dirname, join} = getBuiltin('node:path') as NodePath;
const {fileURLToPath} = getBuiltin('node:url') as NodeUrl;

const here = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN =
  /\b(Math\.random|Date\.now|new Date|Date\(|performance\b|fetch\(|importScripts|XMLHttpRequest|WebSocket)/;

describe('export sources (REQ-EXP-018, REQ-GEN-014)', () => {
  it('AC-EXP-018.1: no clock, randomness or network in the exporter', () => {
    const offenders = readdirSync(here)
      .filter(n => n.endsWith('.ts') && !/\.test\.ts$/.test(n))
      .filter(n =>
        FORBIDDEN.test(
          readFileSync(join(here, n), 'utf8')
            .split('\n')
            .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
            .join('\n'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
