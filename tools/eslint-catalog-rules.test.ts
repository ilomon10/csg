import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {ESLint} from 'eslint';
import {describe, expect, it, vi} from 'vitest';

// The first ESLint run builds the type-aware project service, slow under parallel load.
vi.setConfig({testTimeout: 60_000});

const repoRoot = resolve(import.meta.dirname, '..');
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, 'eslint.config.js'),
});

/** Existing files, so the type-aware project service accepts them; the text is virtual. */
const CATALOG_FILE = resolve(repoRoot, 'packages/engine/src/catalog/index.ts');
const WEB_FILE = resolve(repoRoot, 'apps/web/src/app/app.tsx');
const SHORTCUT_FILE = resolve(
  repoRoot,
  'apps/web/src/shared/shortcuts/command-registry.ts',
);

async function errors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, {filePath});
  const messages = result?.messages ?? [];
  expect(messages.filter(m => m.fatal)).toEqual([]);
  return messages.filter(m => m.severity === 2);
}

describe('catalog three-ban lint rule (architecture 3.7)', () => {
  const BANNED: ReadonlyArray<[string, string]> = [
    ['three', "import {Group} from 'three';"],
    ['three type import', "import type {Group} from 'three';"],
    ['three subpath', "import {WebGPURenderer} from 'three/webgpu';"],
    ['react', "import {useState} from 'react';"],
    ['shader-graph', "import {x} from '@csg/shader-graph';"],
    ['engine module', "import {x} from '../pipeline/index';"],
    ['engine barrel', "import {x} from '../index';"],
  ];
  for (const [name, line] of BANNED) {
    it(`AC-UX-083.1: ${name} in engine/catalog is an error`, async () => {
      const found = await errors(`export {};\n${line}\n`, CATALOG_FILE);
      expect(
        found.some(m => m.line === 2 && m.ruleId === 'no-restricted-imports'),
      ).toBe(true);
    });
  }

  it('AC-UX-083.1: a DOM global in engine/catalog is an error', async () => {
    const found = await errors('export const w = window;\n', CATALOG_FILE);
    expect(found.some(m => m.ruleId === 'no-restricted-globals')).toBe(true);
  });

  it('AC-UX-083.1: the allowed imports pass', async () => {
    const found = await errors(
      [
        "import {z} from 'zod';",
        "import type {CharacterSpec} from '@csg/parts-schema';",
        "export {checkCompatibility} from '../registry/compatibility';",
        "export {parsePartManifestJson} from '../registry/manifest-json';",
        "import type {CompatibilityCheck} from '../contracts/registry';",
        "import {resolveRenderPair} from './resolve-render-pair';",
        'export type X = [typeof z, CharacterSpec, CompatibilityCheck, typeof resolveRenderPair];',
        '',
      ].join('\n'),
      CATALOG_FILE,
    );
    expect(found.filter(m => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
});

describe('global keydown lint rule (AC-UX-011.1)', () => {
  const GLOBAL: ReadonlyArray<string> = [
    "window.addEventListener('keydown', () => {});",
    "document.addEventListener('keydown', () => {});",
    "document.body.addEventListener('keydown', () => {});",
    "globalThis.addEventListener('keydown', () => {});",
  ];
  for (const line of GLOBAL) {
    it(`AC-UX-011.1: ${line.split('.addEventListener')[0]} keydown outside shared/shortcuts is an error`, async () => {
      const found = await errors(`export {};\n${line}\n`, WEB_FILE);
      expect(
        found.some(m => m.line === 2 && m.ruleId === 'csg/no-keydown-listener'),
      ).toBe(true);
    });
  }

  it('AC-UX-011.1: the same listener inside shared/shortcuts is allowed', async () => {
    const found = await errors(
      "export {};\nwindow.addEventListener('keydown', () => {});\n",
      SHORTCUT_FILE,
    );
    expect(found.filter(m => m.ruleId === 'csg/no-keydown-listener')).toEqual(
      [],
    );
  });

  it('AC-UX-011.1: widget-local key handling stays allowed', async () => {
    const found = await errors(
      [
        'export function f(el: HTMLElement) {',
        "  el.addEventListener('keydown', () => {});",
        "  window.addEventListener('keyup', () => {});",
        '}',
        '',
      ].join('\n'),
      WEB_FILE,
    );
    expect(found.filter(m => m.ruleId === 'csg/no-keydown-listener')).toEqual(
      [],
    );
  });
});

describe('catalog import graph', () => {
  it('AC-UX-083.1: the catalog import graph never reaches three, React or a DOM module', () => {
    const seen = new Set<string>();
    const queue = [
      resolve(import.meta.dirname, '../packages/engine/src/catalog/index.ts'),
    ];
    const edge =
      /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/g;
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(edge)) {
        const spec = match[1] ?? '';
        expect(spec, `${file} imports ${spec}`).not.toMatch(
          /^(three|react|react-dom)(\/|$)/,
        );
        if (spec.startsWith('.'))
          queue.push(resolve(dirname(file), `${spec}.ts`));
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});

describe('parts-schema deep-import lint rule (Zod jitless bootstrap)', () => {
  const BANNED: ReadonlyArray<[string, string]> = [
    ['bare src path', "import {x} from '@csg/parts-schema/src/json';"],
    ['bare src export-from', "export {x} from '@csg/parts-schema/src/json';"],
    [
      'relative from apps',
      "import {x} from '../../../../packages/parts-schema/src/json';",
    ],
  ];
  for (const [name, line] of BANNED) {
    it(`AC-GEN-013.1: ${name} is an error`, async () => {
      const found = await errors(`${line}\n`, WEB_FILE);
      expect(
        found.some(m => m.ruleId === 'csg/no-parts-schema-deep-import'),
      ).toBe(true);
    });
  }

  it('AC-GEN-013.1: the barrel import is allowed', async () => {
    const found = await errors(
      "import {parseJson} from '@csg/parts-schema';\nexport {parseJson};\n",
      WEB_FILE,
    );
    expect(
      found.some(m => m.ruleId === 'csg/no-parts-schema-deep-import'),
    ).toBe(false);
  });
});
