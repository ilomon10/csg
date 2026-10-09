import {describe, expect, it} from 'vitest';
import {createDefaultCharacterSpec} from './character-spec';
import {defaultAnatomy} from './anatomy';
import {makePart} from './test-fixtures';
import {
  anatomyPresetSchema,
  applyBodyShape,
  availableStyleCombos,
  bodyShapePresetSchema,
  characterPresetSchema,
  easyCategoryDefSchema,
  lookPresetSchema,
  parseCharacterPreset,
  parsePresetFile,
  presetIndexSchema,
  styleDefinitionSchema,
  swatchSetDefSchema,
  validateStyleDefinitions,
} from './presets';
import v1Fixture from '../test/fixtures/character-v1.json';

const CHIBI = {
  height: 0.85,
  head: 1.8,
  torsoWidth: 1.1,
  shoulders: 0.9,
  armLength: 0.75,
  legLength: 0.7,
  hands: 1.4,
  feet: 1.4,
  limbThickness: 1.4,
};
const SHAPES = {
  average: {},
  slim: {
    torsoWidth: 0.9,
    shoulders: 0.95,
    hands: 0.95,
    feet: 0.95,
    limbThickness: 0.85,
  },
  athletic: {
    height: 1.02,
    torsoWidth: 1.05,
    shoulders: 1.15,
    legLength: 1.03,
    limbThickness: 1.1,
  },
  stocky: {
    height: 0.95,
    torsoWidth: 1.2,
    shoulders: 1.1,
    legLength: 0.95,
    hands: 1.05,
    feet: 1.05,
    limbThickness: 1.25,
  },
  tall: {height: 1.1, torsoWidth: 0.97, armLength: 1.04, legLength: 1.08},
  petite: {
    height: 0.9,
    torsoWidth: 0.94,
    shoulders: 0.92,
    hands: 0.92,
    feet: 0.92,
    limbThickness: 0.92,
  },
};

const shapeFile = (id: string, factors: object) => ({
  format: 'sprite-body-shape-preset',
  version: 1,
  id,
  label: `ana.shape.${id}`,
  order: 10,
  factors,
});

describe('anatomy presets', () => {
  it('AC-ANA-013.3: the chibi preset values validate and equal the table row', () => {
    const result = anatomyPresetSchema.safeParse({
      format: 'sprite-anatomy-preset',
      version: 1,
      id: 'chibi',
      label: 'Chibi',
      values: CHIBI,
    });
    expect(result.success && result.data.values).toEqual(CHIBI);
    const out = anatomyPresetSchema.safeParse({
      format: 'sprite-anatomy-preset',
      version: 1,
      id: 'bad',
      label: 'Bad',
      values: {...CHIBI, legLength: 0.69},
    });
    expect(out.success).toBe(false);
  });
});

describe('body shapes', () => {
  it('AC-ANA-022.1: the six REQ-ANA-022 rows validate', () => {
    for (const [id, factors] of Object.entries(SHAPES)) {
      expect(
        bodyShapePresetSchema.safeParse(shapeFile(id, factors)).success,
      ).toBe(true);
    }
  });

  it('AC-ANA-022.2: factor 1.51 or an unknown key fails naming the file ID and field', () => {
    const high = parsePresetFile(
      bodyShapePresetSchema,
      shapeFile('big', {limbThickness: 1.51}),
    );
    expect(high.ok).toBe(false);
    if (!high.ok) {
      expect(high.issues[0]?.entryId).toBe('big');
      expect(high.issues[0]?.field).toBe('limbThickness');
    }
    const neck = parsePresetFile(
      bodyShapePresetSchema,
      shapeFile('neck', {neck: 1}),
    );
    expect(neck.ok).toBe(false);
    expect(
      parsePresetFile(bodyShapePresetSchema, {...shapeFile('x', {}), extra: 1})
        .ok,
    ).toBe(false);
  });

  it('AC-ANA-023.1: on the realistic base stocky equals its factors', () => {
    expect(applyBodyShape(defaultAnatomy(), SHAPES.stocky)).toEqual({
      ...defaultAnatomy(),
      ...SHAPES.stocky,
    });
  });

  it('AC-ANA-023.2: stocky on chibi gives torsoWidth 1.32, limbThickness 1.75, legLength 0.7, head 1.8', () => {
    const out = applyBodyShape(CHIBI, SHAPES.stocky);
    expect(out.torsoWidth).toBe(1.32);
    expect(out.limbThickness).toBe(1.75);
    expect(out.legLength).toBe(0.7);
    expect(out.head).toBe(1.8);
  });

  it('AC-ANA-023.3: petite on chibi clamps height to 0.80', () => {
    expect(applyBodyShape(CHIBI, SHAPES.petite).height).toBe(0.8);
  });

  it('AC-ANA-023.4: integer arithmetic gives stable results and does not mutate the base', () => {
    const base = {...CHIBI};
    const a = applyBodyShape(base, SHAPES.athletic);
    const b = applyBodyShape(base, SHAPES.athletic);
    expect(a).toEqual(b);
    expect(base).toEqual(CHIBI);
    for (const v of Object.values(a)) expect(Math.round(v * 100) / 100).toBe(v);
  });
});

describe('style definitions', () => {
  const style = (name: string, extra: object = {}) =>
    styleDefinitionSchema.parse({
      format: 'sprite-style',
      version: 1,
      style: name,
      excludedClips: [],
      ...extra,
    });

  it('AC-ANA-024.1: valid style files pass cross-file validation', () => {
    const files = [
      style('realistic', {anatomyPreset: 'realistic'}),
      style('chibi', {anatomyPreset: 'chibi'}),
    ];
    expect(
      validateStyleDefinitions(files, new Set(['realistic', 'chibi'])),
    ).toEqual([]);
  });

  it('AC-ANA-024.2: unknown preset, excluded default clip and duplicate style are named', () => {
    const issues = validateStyleDefinitions(
      [
        style('chibi', {
          anatomyPreset: 'chubby',
          excludedClips: [
            {clip: 'builtin:quaternius-ual/run', reason: 'x'},
            {clip: 'builtin:quaternius-ual/walk', reason: 'x'},
          ],
        }),
        style('chibi'),
      ],
      new Set(['chibi']),
    );
    expect(issues.map(i => i.path)).toEqual([
      'anatomyPreset',
      'excludedClips.1',
      'style',
    ]);
    expect(issues.every(i => i.entryId === 'chibi')).toBe(true);
  });

  it('AC-ANA-024.3: a clip ref absent from every pack is not an error here', () => {
    expect(
      validateStyleDefinitions(
        [
          style('chibi', {
            excludedClips: [{clip: 'builtin:gone/clip', reason: 'x'}],
          }),
        ],
        new Set(),
      ),
    ).toEqual([]);
  });
});

describe('Easy, swatch, character, look and index files', () => {
  it('REQ-UX-060: an Easy category def validates and rejects duplicate slots', () => {
    const def = {
      format: 'sprite-easy-category',
      version: 1,
      id: 'hair',
      labelKey: 'ux.easy.hair',
      icon: 'hair',
      slots: ['hair'],
      tintChannels: ['hair'],
      anatomyPresets: false,
    };
    expect(easyCategoryDefSchema.safeParse(def).success).toBe(true);
    expect(
      easyCategoryDefSchema.safeParse({...def, slots: ['hair', 'hair']})
        .success,
    ).toBe(false);
    expect(easyCategoryDefSchema.safeParse({...def, id: 'pets'}).success).toBe(
      false,
    );
  });

  it('REQ-UX-062: a swatch set needs 4 to 24 swatches and normalizes hex', () => {
    const sw = (n: number) =>
      Array.from({length: n}, (_, i) => ({
        hex: `#00000${i % 10}`.toUpperCase(),
        nameKey: `c.${i}`,
      }));
    const base = {
      format: 'sprite-swatch-set',
      version: 1,
      id: 'hair',
      channels: ['hair'],
    };
    expect(
      swatchSetDefSchema.safeParse({...base, swatches: sw(3)}).success,
    ).toBe(false);
    expect(
      swatchSetDefSchema.safeParse({...base, swatches: sw(25)}).success,
    ).toBe(false);
    const ok = swatchSetDefSchema.safeParse({...base, swatches: sw(4)});
    expect(ok.success && ok.data.swatches[0]?.hex).toBe('#000000');
  });

  it('AC-CMP-049.2: a character preset holding a v1 spec loads as v2', () => {
    const result = parseCharacterPreset({
      format: 'sprite-character-preset',
      version: 1,
      id: 'ranger',
      name: 'Ranger',
      character: v1Fixture,
      camera: 'side',
    });
    expect(result.ok && result.value.character.version).toBe(2);
    expect(
      characterPresetSchema.safeParse({character: createDefaultCharacterSpec()})
        .success,
    ).toBe(false);
    expect(parseCharacterPreset({id: 'x', character: 'nope'}).ok).toBe(false);
  });

  it('REQ-EDT-044: a look preset takes builtin graphs and rejects camera patches', () => {
    const look = {
      format: 'sprite-look-preset',
      version: 1,
      id: 'gameboy-4',
      name: 'GameBoy',
      description: 'Four greens',
      thumbnail: 'presets/looks/gameboy-4.png',
      materialGraph: 'builtin:material-default',
      postGraph: 'builtin:post-default',
      params: {},
      render: {palette: {id: 'custom'}},
    };
    expect(lookPresetSchema.safeParse(look).success).toBe(true);
    expect(
      lookPresetSchema.safeParse({...look, render: {camera: {}}}).success,
    ).toBe(false);
    expect(
      lookPresetSchema.safeParse({...look, postGraph: 'user:x'}).success,
    ).toBe(false);
    expect(
      lookPresetSchema.safeParse({...look, thumbnail: '../x.png'}).success,
    ).toBe(false);
  });

  it('AC-ANA-022.3: pack-relative paths reject ., %, ? and # forms', () => {
    const look = {
      format: 'sprite-look-preset',
      version: 1,
      id: 'gameboy-4',
      name: 'GameBoy',
      description: 'Four greens',
      materialGraph: 'builtin:material-default',
      postGraph: 'builtin:post-default',
      params: {},
      render: {palette: {id: 'custom'}},
    };
    for (const bad of [
      './x.png',
      'a/./x.png',
      'x%2e.png',
      'x.png?a=1',
      'x#y',
    ]) {
      expect(
        lookPresetSchema.safeParse({...look, thumbnail: bad}).success,
        bad,
      ).toBe(false);
    }
    expect(
      lookPresetSchema.safeParse({...look, thumbnail: 'thumbs/x.png'}).success,
    ).toBe(true);
  });

  it('AC-ANA-022.3: the preset index lists files by kind and rejects duplicates and escapes', () => {
    const index = {
      format: 'sprite-preset-index',
      version: 1,
      files: [{kind: 'body-shape', path: 'presets/body-shapes/slim.json'}],
    };
    expect(presetIndexSchema.safeParse(index).success).toBe(true);
    expect(
      presetIndexSchema.safeParse({
        ...index,
        files: [...index.files, ...index.files],
      }).success,
    ).toBe(false);
    expect(
      presetIndexSchema.safeParse({
        ...index,
        files: [{kind: 'style', path: '../x.json'}],
      }).success,
    ).toBe(false);
  });
});

describe('availableStyleCombos', () => {
  const supported = [
    ['realistic', 'human'],
    ['chibi', 'human'],
    ['realistic', 'animal'],
  ] as const;

  it('AC-CMP-045.4: a pair is available only with its style data file loaded', () => {
    expect(
      availableStyleCombos(supported, {
        styles: new Set(['realistic']),
        parts: [],
      }),
    ).toEqual([['realistic', 'human']]);
    expect(
      availableStyleCombos(supported, {
        styles: new Set(['stickman']),
        parts: [],
      }),
    ).toEqual([]);
  });

  it('AC-CMP-045.5: a non-human species needs a species-head part that fits the style', () => {
    const loaded = (parts: ReturnType<typeof makePart>[]) => ({
      styles: new Set(['realistic', 'chibi'] as const),
      parts,
    });
    const head = makePart({
      id: 'fox-head',
      slot: 'species-head',
      species: ['animal'],
    });
    expect(availableStyleCombos(supported, loaded([]))).toHaveLength(2);
    expect(availableStyleCombos(supported, loaded([head]))).toHaveLength(3);
    const chibiOnly = makePart({
      id: 'fox',
      slot: 'species-head',
      species: ['animal'],
      styles: ['chibi'],
    });
    expect(availableStyleCombos(supported, loaded([chibiOnly]))).toHaveLength(
      2,
    );
    const wrong = makePart({
      id: 'orc',
      slot: 'species-head',
      species: ['monster'],
    });
    expect(availableStyleCombos(supported, loaded([wrong]))).toHaveLength(2);
  });
});
