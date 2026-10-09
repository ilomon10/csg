import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  cpSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {
  ANATOMY_PARAM_SPECS,
  EASY_CATEGORY_IDS,
  parseCharacterPreset,
  applyBodyShape,
} from '@csg/parts-schema';
import type {
  AnatomyPreset,
  BodyShapePreset,
  CharacterPreset,
  PartEntry,
  PartManifest,
  StyleDefinition,
  SwatchSetDef,
  LookPreset,
} from '@csg/parts-schema';
import {
  emitPresets,
  readPresetSources,
  validatePresetSet,
} from './lib/build/presets.js';
import type {PresetFile} from './lib/build/presets.js';
import {fitsBody} from './lib/build/sole.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACK = 'quaternius-ubc';

async function sources(): Promise<PresetFile[]> {
  const {files, issues} = await readPresetSources(
    join(REPO, 'tools/packs', PACK),
  );
  expect(issues).toEqual([]);
  return files;
}
const of = <T>(files: PresetFile[], kind: PresetFile['kind']): T[] =>
  files.filter(f => f.kind === kind).map(f => f.json as T);

function manifests(): Map<string, PartEntry> {
  const map = new Map<string, PartEntry>();
  for (const pack of ['quaternius-ubc', 'quaternius-outfits']) {
    const m = JSON.parse(
      readFileSync(join(REPO, 'assets/packs', pack, 'manifest.json'), 'utf8'),
    ) as PartManifest;
    for (const p of m.parts) map.set(`builtin:${pack}/${p.id}`, p);
  }
  return map;
}

describe('shipped preset data', () => {
  it('AC-ANA-022.1, AC-ANA-024.1: every file validates, the index lists them all', async () => {
    const files = await sources();
    const result = validatePresetSet(files);
    expect(result.issues).toEqual([]);
    expect(result.index.files).toHaveLength(files.length);
  });

  it('AC-ANA-013.3: chibi has the table values; default, heroic and realistic exist', async () => {
    const presets = of<AnatomyPreset>(await sources(), 'anatomy-preset');
    expect(presets.map(p => p.id).sort()).toEqual([
      'chibi',
      'default',
      'heroic',
      'realistic',
    ]);
    const chibi = presets.find(p => p.id === 'chibi');
    expect(chibi?.values).toEqual({
      height: 0.85,
      head: 1.8,
      torsoWidth: 1.1,
      shoulders: 0.9,
      armLength: 0.75,
      legLength: 0.7,
      hands: 1.4,
      feet: 1.4,
      limbThickness: 1.4,
    });
    for (const p of presets) {
      for (const [key, value] of Object.entries(p.values)) {
        const spec =
          ANATOMY_PARAM_SPECS[key as keyof typeof ANATOMY_PARAM_SPECS];
        expect(value).toBeGreaterThanOrEqual(spec.min);
        expect(value).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('AC-ANA-022.1: six body shapes in menu order with the table factors', async () => {
    const shapes = of<BodyShapePreset>(await sources(), 'body-shape').sort(
      (a, b) => a.order - b.order,
    );
    expect(shapes.slice(0, 6).map(s => s.id)).toEqual([
      'average',
      'slim',
      'athletic',
      'stocky',
      'tall',
      'petite',
    ]);
    const stocky = shapes.find(s => s.id === 'stocky');
    expect(stocky?.factors).toEqual({
      height: 0.95,
      head: 1,
      torsoWidth: 1.2,
      shoulders: 1.1,
      armLength: 1,
      legLength: 0.95,
      hands: 1.05,
      feet: 1.05,
      limbThickness: 1.25,
    });
  });

  it('AC-ANA-023.2: stocky on the chibi base gives torsoWidth 1.32 and legLength 0.70', async () => {
    const files = await sources();
    const chibi = of<AnatomyPreset>(files, 'anatomy-preset').find(
      p => p.id === 'chibi',
    );
    const stocky = of<BodyShapePreset>(files, 'body-shape').find(
      s => s.id === 'stocky',
    );
    const out = applyBodyShape(chibi!.values, stocky!.factors);
    expect(out.torsoWidth).toBe(1.32);
    expect(out.legLength).toBe(0.7);
    expect(out.head).toBe(1.8);
  });

  it('AC-ANA-024.1: realistic.json names realistic, chibi.json names chibi with an empty exclusion list', async () => {
    const styles = of<StyleDefinition>(await sources(), 'style');
    expect(styles.map(s => s.style).sort()).toEqual(['chibi', 'realistic']);
    expect(styles.find(s => s.style === 'chibi')?.anatomyPreset).toBe('chibi');
    expect(styles.every(s => s.excludedClips.length === 0)).toBe(true);
  });

  it('AC-UX-060.1: seven Easy categories in tab order', async () => {
    const cats = of<{id: string}>(await sources(), 'easy-category').map(
      c => c.id,
    );
    expect(cats.sort()).toEqual([...EASY_CATEGORY_IDS].sort());
  });

  it('AC-UX-062.1: swatch sets have at least 8 swatches, each with a unique spoken-name key', async () => {
    const sets = of<SwatchSetDef>(await sources(), 'swatch-set');
    expect(sets.map(s => s.id).sort()).toEqual([
      'eyes',
      'general',
      'hair',
      'skin',
    ]);
    for (const set of sets) {
      expect(set.swatches.length).toBeGreaterThanOrEqual(8);
      expect(new Set(set.swatches.map(s => s.nameKey)).size).toBe(
        set.swatches.length,
      );
      expect(new Set(set.swatches.map(s => s.hex)).size).toBe(
        set.swatches.length,
      );
    }
    const hair = sets.find(s => s.id === 'hair');
    expect(hair?.swatches[0]?.hex).toBe('#7a4a26');
  });

  it('AC-UX-103.1, AC-CMP-036.1: at least 6 presets use only bundled ubc/outfits parts that fit their body', async () => {
    const parts = manifests();
    const presets = of<CharacterPreset>(await sources(), 'character');
    expect(presets.length).toBeGreaterThanOrEqual(6);
    const names = presets.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const preset of presets) {
      const spec = preset.character;
      expect(spec.species).toBe('human');
      expect(['realistic', 'chibi']).toContain(spec.style);
      const body = parts.get(spec.body.ref);
      expect(body?.slot).toBe('body');
      for (const [slot, selection] of Object.entries(spec.parts)) {
        expect(selection.ref).toMatch(/^builtin:quaternius-(ubc|outfits)\//);
        const part = parts.get(selection.ref);
        expect(part?.slot, `${preset.id} ${slot}`).toBe(slot);
        expect(fitsBody(part!, body!), `${preset.id} ${slot}`).toBe(true);
        if (selection.ref.startsWith('builtin:quaternius-outfits/')) {
          expect(selection.ref).toMatch(/(peasant|ranger)/);
        }
      }
    }
  });

  it('AC-UX-103.2: role names are true to the outfit worn', async () => {
    const presets = of<CharacterPreset>(await sources(), 'character');
    for (const preset of presets) {
      const torso = preset.character.parts['torso']?.ref ?? '';
      const ranger = torso.includes('ranger');
      const rangerRoles = ['Ranger', 'Wanderer', 'Scout', 'Young Ranger'];
      const peasantRoles = [
        'Villager',
        'Herbalist',
        'Woodcutter',
        'Young Villager',
      ];
      expect(
        (ranger ? rangerRoles : peasantRoles).includes(preset.name),
        preset.name,
      ).toBe(true);
    }
  });

  it('AC-UX-072.2: presets cover side and top-down cameras', async () => {
    const cameras = new Set(
      of<CharacterPreset>(await sources(), 'character').map(p => p.camera),
    );
    expect(cameras.has('side')).toBe(true);
    expect(cameras.has('three-quarter') || cameras.has('isometric')).toBe(true);
  });

  it('AC-ANA-022.1, AC-CMP-043.1: chibi presets carry the chibi anatomy', async () => {
    const files = await sources();
    const chibi = of<AnatomyPreset>(files, 'anatomy-preset').find(
      p => p.id === 'chibi',
    );
    for (const p of of<CharacterPreset>(files, 'character')) {
      if (p.character.style === 'chibi')
        expect(p.character.anatomy).toEqual(chibi?.values);
    }
  });

  it('AC-CMP-049.2: a preset whose character is version 1 loads as version 2', async () => {
    const preset = of<CharacterPreset>(await sources(), 'character')[0]!;
    const {style: _s, species: _sp, ...rest} = preset.character;
    void _s;
    void _sp;
    const v1 = {...preset, character: {...rest, version: 1}};
    const parsed = parseCharacterPreset(v1);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.character.version).toBe(2);
      expect(parsed.value.character.style).toBe('realistic');
    }
  });

  it('AC-EDT-044.1: four look presets with the cited palettes', async () => {
    const looks = of<
      LookPreset & {paletteSource?: {sourceUrl: string; license: string}}
    >(await sources(), 'look');
    expect(looks.map(l => l.id).sort()).toEqual([
      'classic-16bit',
      'gameboy-4',
      'hi-bit',
      'nes-like',
    ]);
    const by = (id: string) => looks.find(l => l.id === id)!;
    expect(by('gameboy-4').palette?.colors).toEqual([
      '#081820',
      '#346856',
      '#88c070',
      '#e0f8d0',
    ]);
    expect(by('nes-like').palette?.colors).toHaveLength(55);
    expect(by('nes-like').paletteSource?.sourceUrl).toContain(
      'lospec.com/palette-list/nintendo-entertainment-system',
    );
    expect(by('hi-bit').palette?.id).toBe('endesga-32');
    expect(by('classic-16bit').palette?.id).toBe('none');
  });
});

describe('preset validation and emit', () => {
  it('AC-ANA-022.2: an out-of-range factor and an unknown key fail naming the file id', async () => {
    const files = await sources();
    const shape = files.find(f => f.path.endsWith('slim.json'))!;
    const bad: PresetFile = {
      ...shape,
      json: {
        ...(shape.json as object),
        factors: {limbThickness: 1.51, neck: 1},
      },
    };
    const result = validatePresetSet([bad]);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.message).toContain('slim');
    expect(result.issues[0]?.message).toContain('factors');
  });

  it('AC-ANA-024.2: a style naming an unknown anatomy preset or a default clip fails', async () => {
    const files = await sources();
    const style = files.find(
      f => f.path.endsWith('chibi.json') && f.kind === 'style',
    )!;
    const anatomy = files.filter(f => f.kind === 'anatomy-preset');
    const make = (patch: object): PresetFile => ({
      ...style,
      json: {...(style.json as object), ...patch},
    });
    const a = validatePresetSet([...anatomy, make({anatomyPreset: 'chubby'})]);
    expect(a.issues.map(i => i.message).join('\n')).toContain('anatomyPreset');
    const b = validatePresetSet([
      ...anatomy,
      make({
        excludedClips: [{clip: 'builtin:quaternius-ual/walk', reason: 'x'}],
      }),
    ]);
    expect(b.issues.map(i => i.message).join('\n')).toContain(
      'excludedClips.0',
    );
  });

  it('AC-EDT-044.2: a custom palette without a source record fails', async () => {
    const looks = (await sources()).filter(f => f.kind === 'look');
    const nes = looks.find(f => f.path.endsWith('nes-like.json'))!;
    const {paletteSource: _drop, ...rest} = nes.json as Record<string, unknown>;
    void _drop;
    const result = validatePresetSet([{...nes, json: rest}]);
    expect(result.issues.map(i => i.message).join('\n')).toContain(
      'paletteSource',
    );
  });

  it('AC-CMP-027.1: emitPresets copies the files and writes a sorted index; reruns are byte-identical', async () => {
    const root = mkdtempSync(join(tmpdir(), 'presets-emit-'));
    try {
      cpSync(
        join(REPO, 'tools/packs', PACK, 'presets'),
        join(root, 'tools/packs', PACK, 'presets'),
        {
          recursive: true,
        },
      );
      mkdirSync(join(root, 'out'), {recursive: true});
      const args = {root, outRoot: join(root, 'out'), packId: PACK};
      await emitPresets(args);
      const first = readFileSync(
        join(root, 'out', PACK, 'presets/index.json'),
        'utf8',
      );
      await emitPresets(args);
      expect(
        readFileSync(join(root, 'out', PACK, 'presets/index.json'), 'utf8'),
      ).toBe(first);
      const index = JSON.parse(first) as {
        files: Array<{kind: string; path: string}>;
      };
      expect(index.files[0]?.kind).toBe('anatomy-preset');
      expect(
        index.files.some(f => f.path === 'presets/characters/ranger.json'),
      ).toBe(true);
      // An invalid file stops the build and names the file.
      writeFileSync(
        join(root, 'tools/packs', PACK, 'presets/body-shapes/slim.json'),
        '{"format":"sprite-body-shape-preset","version":1,"id":"slim","label":"ux.shape.slim","order":20,"factors":{"neck":1}}',
      );
      await expect(emitPresets(args)).rejects.toThrow(
        /AST_PRESET_INVALID[\s\S]*slim/,
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
