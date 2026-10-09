import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {presetIndexSchema} from '@csg/parts-schema';
import {emitPresets} from './presets.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SHIPPED = join(REPO, 'tools/packs/quaternius-ubc/presets');
const shipped = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(SHIPPED, rel), 'utf8')) as Record<
    string,
    unknown
  >;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'presets-emit-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

/** Writes an authored preset of fixture pack `p` (`folder/name.json`). */
function author(rel: string, json: unknown, packRoot = root): void {
  const file = join(packRoot, 'tools/packs/p/presets', rel);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, JSON.stringify(json));
}

const emit = (outDir = 'out', packRoot = root) =>
  emitPresets({root: packRoot, outRoot: join(packRoot, outDir), packId: 'p'});

/** The messages of the AST_PRESET_INVALID the emit throws, with its exit code. */
async function failure(): Promise<{message: string; exitCode: number}> {
  const error = await emit().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  const e = error as Error & {code?: string; exitCode?: number};
  expect(e.code).toBe('AST_PRESET_INVALID');
  return {message: e.message, exitCode: e.exitCode ?? 0};
}

describe('preset build rules (REQ-AST-035, REQ-AST-036)', () => {
  it('AC-AST-035.1: a body shape file whose id differs from its file name exits 1 with AST_PRESET_INVALID naming the file, the id and the name', async () => {
    author('body-shapes/slim.json', {
      ...shipped('body-shapes/slim.json'),
      id: 'thin',
    });
    const {message, exitCode} = await failure();
    expect(exitCode).toBe(1);
    expect(message).toContain('presets/body-shapes/slim.json');
    expect(message).toContain('thin');
    expect(message).toContain('slim');
  });

  it('AC-AST-035.2: exactly one finding when only the third look has a custom palette without paletteSource', async () => {
    const nes = shipped('looks/nes-like.json');
    const {paletteSource: _source, ...withoutSource} = nes;
    void _source;
    author('looks/classic-16bit.json', shipped('looks/classic-16bit.json'));
    author('looks/nes-like.json', nes);
    author('looks/third.json', {
      ...withoutSource,
      id: 'third',
      palette: {id: 'custom', colors: ['#000000']},
    });
    const {message, exitCode} = await failure();
    expect(exitCode).toBe(1);
    const findings = message.split('\n').filter(l => l.startsWith('  - '));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('presets/looks/third.json');
    expect(findings[0]).toContain('paletteSource');
  });

  it('AC-AST-035.3: a style whose anatomyPreset names no file in presets/anatomy exits 1 naming the style, anatomyPreset and the unknown id', async () => {
    author('anatomy/realistic.json', shipped('anatomy/realistic.json'));
    author('styles/realistic.json', {
      ...shipped('styles/realistic.json'),
      anatomyPreset: 'chubby',
    });
    const {message, exitCode} = await failure();
    expect(exitCode).toBe(1);
    expect(message).toContain('realistic');
    expect(message).toContain('anatomyPreset');
    expect(message).toContain('chubby');
  });

  it('AC-AST-036.1: the index lists anatomy/z, looks/a, looks/b in that order, validates with presetIndexSchema, and two builds are byte-identical', async () => {
    const look = shipped('looks/classic-16bit.json');
    const z = {...shipped('anatomy/realistic.json'), id: 'z'};
    const author2 = (packRoot: string) => {
      author('looks/b.json', {...look, id: 'b'}, packRoot);
      author('anatomy/z.json', z, packRoot);
      author('looks/a.json', {...look, id: 'a'}, packRoot);
    };
    author2(root);
    const other = mkdtempSync(join(tmpdir(), 'presets-emit-2-'));
    try {
      author2(other);
      await emit('out', root);
      await emit('out', other);
      const text = readFileSync(join(root, 'out/p/presets/index.json'), 'utf8');
      const index = presetIndexSchema.parse(JSON.parse(text));
      expect(index.files.map(f => f.path)).toEqual([
        'presets/anatomy/z.json',
        'presets/looks/a.json',
        'presets/looks/b.json',
      ]);
      const names = (dir: string) => {
        const out: string[] = [];
        const walk = (d: string) => {
          for (const e of readdirSync(d, {withFileTypes: true})) {
            if (e.isDirectory()) walk(join(d, e.name));
            else out.push(join(d, e.name).slice(dir.length));
          }
        };
        walk(dir);
        return out.sort();
      };
      const a = join(root, 'out/p');
      const b = join(other, 'out/p');
      expect(names(a)).toEqual(names(b));
      for (const rel of names(a)) {
        expect(readFileSync(join(a, rel), 'utf8')).toBe(
          readFileSync(join(b, rel), 'utf8'),
        );
      }
    } finally {
      rmSync(other, {recursive: true, force: true});
    }
  });

  it('AC-AST-036.2: after the source presets folder is deleted a rebuild leaves no presets folder in the output', async () => {
    author('anatomy/realistic.json', shipped('anatomy/realistic.json'));
    await emit();
    expect(existsSync(join(root, 'out/p/presets/index.json'))).toBe(true);
    rmSync(join(root, 'tools/packs/p/presets'), {recursive: true});
    await emit();
    expect(existsSync(join(root, 'out/p/presets'))).toBe(false);
  });
});
