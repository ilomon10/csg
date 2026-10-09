import {DIRECTION_ORDER} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {EXPORT_DIRECTION_ORDER} from './naming';

// The engine tsconfig has no Node types; load the few builtins structurally.
interface NodeFs {
  readFileSync(file: string, enc: 'utf8'): string;
}
interface NodePath {
  dirname(p: string): string;
  resolve(...parts: string[]): string;
}
interface NodeUrl {
  fileURLToPath(url: string): string;
}
const getBuiltin = (
  globalThis as unknown as {
    process: {getBuiltinModule(id: string): unknown};
  }
).process.getBuiltinModule;
const {readFileSync} = getBuiltin('node:fs') as NodeFs;
const {dirname, resolve} = getBuiltin('node:path') as NodePath;
const {fileURLToPath} = getBuiltin('node:url') as NodeUrl;

const ENTRY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'export.worker.ts',
);
const IMPORT = /(?:^|\n)\s*(import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/g;

/** Runtime (non type-only) import specifiers of the worker's local import graph. */
function walk(file: string, seen: Map<string, string[]>): void {
  if (seen.has(file)) return;
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of src.matchAll(IMPORT)) {
    if (m[2] === undefined && m[3] !== undefined) specs.push(m[3]);
  }
  seen.set(file, specs);
  for (const s of specs) {
    if (s.startsWith('.')) walk(resolve(dirname(file), `${s}.ts`), seen);
  }
}

describe('export worker graph (REQ-GEN-015, REQ-GEN-016)', () => {
  it('AC-GEN-015.2: the worker imports no zod and no parts-schema runtime code', () => {
    const graph = new Map<string, string[]>();
    walk(ENTRY, graph);
    expect(graph.size).toBeGreaterThan(5);
    for (const [file, specs] of graph) {
      for (const s of specs) {
        expect(s, file).not.toMatch(/^zod|^@csg\/parts-schema|^three/);
      }
      expect(readFileSync(file, 'utf8'), file).not.toMatch(
        /\bnew Function\b|\bFunction\(|\beval\(/,
      );
    }
  });

  it('keeps the worker copy of DIRECTION_ORDER equal to parts-schema', () => {
    expect([...EXPORT_DIRECTION_ORDER]).toEqual([...DIRECTION_ORDER]);
  });
});
