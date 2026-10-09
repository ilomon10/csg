import {resolve} from 'node:path';
import {ESLint} from 'eslint';
import {beforeAll, describe, expect, it} from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..');
/** An existing worker path (so the type-aware project service accepts it); the text is virtual so the `**\/*.worker.{ts,tsx}` override applies. */
const WORKER_PATH = resolve(
  repoRoot,
  'packages/engine/src/pipeline/palette-lut.worker.ts',
);

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, 'eslint.config.js'),
});

async function lint(code: string, filePath = WORKER_PATH) {
  const [result] = await eslint.lintText(code, {filePath});
  return result?.messages ?? [];
}

/** One fixture per banned construct (spec 000 AC-GEN-015.1); the banned line is line 2. */
const BANNED: ReadonlyArray<[string, string]> = [
  ["fetch('/x')", "fetch('/x');"],
  ['importScripts', "importScripts('/x.js');"],
  ['import()', "void import('./x.js');"],
  ['new WebSocket', "new WebSocket('wss://x');"],
  ['new EventSource', "new EventSource('/x');"],
  ['new XMLHttpRequest', 'new XMLHttpRequest();'],
  ['new Function', "new Function('return 1');"],
  ['eval', "eval('1');"],
];

describe('worker-hygiene lint rule', () => {
  // The first type-aware lint builds the TypeScript program (several seconds on a busy machine);
  // pay that once here so each test measures only its own lint call.
  beforeAll(async () => {
    await lint('export {};\n');
  }, 120_000);

  for (const [name, line] of BANNED) {
    it(`AC-GEN-015.1: ${name} in a *.worker.ts file reports an error on its line`, async () => {
      const messages = await lint(`export {};\n${line}\n`);
      const errors = messages.filter(m => m.severity === 2 && m.line === 2);
      expect(messages.filter(m => m.fatal)).toEqual([]);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(
        errors.some(m =>
          /banned in workers|no-eval|no-new-func/.test(
            `${m.message} ${m.ruleId}`,
          ),
        ),
      ).toBe(true);
    });
  }

  it('AC-GEN-015.1: the same fetch call is not reported by the worker rules in a non-worker file', async () => {
    const messages = await lint(
      "export {};\nfetch('/x');\n",
      resolve(repoRoot, 'packages/engine/src/pipeline/palette-lut.ts'),
    );
    expect(messages.filter(m => m.fatal)).toEqual([]);
    expect(messages.filter(m => /banned in workers/.test(m.message))).toEqual(
      [],
    );
  });

  it('AC-GEN-015.1: a clean worker reports no worker-hygiene errors', async () => {
    const messages = await lint(
      'export function handle(x: number): number {\n  return x + 1;\n}\n',
    );
    expect(messages.filter(m => m.fatal)).toEqual([]);
    expect(messages.filter(m => /banned in workers/.test(m.message))).toEqual(
      [],
    );
    expect(messages.filter(m => m.severity === 2)).toEqual([]);
  });

  it('AC-GEN-015.2: the real palette LUT worker source has 0 worker-hygiene errors', async () => {
    const results = await eslint.lintFiles([
      'packages/engine/src/pipeline/palette-lut.worker.ts',
    ]);
    const hygiene = results
      .flatMap(r => r.messages)
      .filter(m =>
        /banned in workers|no-eval|no-new-func/.test(
          `${m.message} ${m.ruleId}`,
        ),
      );
    expect(hygiene).toEqual([]);
  });
});
