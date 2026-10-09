import {describe, expect, it} from 'vitest';
import {
  CHARACTER_MIGRATIONS,
  canonicalCharacterJson,
  createDefaultCharacterSpec,
  parseCharacterSpec,
} from './character-spec';
import type {CharacterSpec} from './character-spec';
import {CHARACTER_SPECIES, CHARACTER_STYLES} from './primitives';
import v1Fixture from '../test/fixtures/character-v1.json';

const v2 = (): Record<string, unknown> =>
  JSON.parse(canonicalCharacterJson(createDefaultCharacterSpec())) as Record<
    string,
    unknown
  >;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('CharacterSpec version 2', () => {
  it('AC-CMP-038.1: all 12 style/species pairs parse and save byte-identically twice', () => {
    let count = 0;
    for (const style of CHARACTER_STYLES) {
      for (const species of CHARACTER_SPECIES) {
        const result = parseCharacterSpec({...v2(), style, species});
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const first = canonicalCharacterJson(result.value);
        const reparsed = parseCharacterSpec(JSON.parse(first));
        expect(reparsed.ok && canonicalCharacterJson(reparsed.value)).toBe(
          first,
        );
        count += 1;
      }
    }
    expect(count).toBe(12);
  });

  it('AC-CMP-038.2: a missing style or species fails naming that path', () => {
    for (const key of ['style', 'species']) {
      const doc = v2();
      delete doc[key];
      const result = parseCharacterSpec(doc);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CMP_SPEC_INVALID');
        expect(result.issues[0]?.path).toBe(key);
      }
    }
  });

  it('AC-CMP-038.3: the default spec is v2 realistic/human in canonical key order', () => {
    const spec = createDefaultCharacterSpec();
    expect(spec.version).toBe(2);
    expect(spec.style).toBe('realistic');
    expect(spec.species).toBe('human');
    expect(Object.keys(JSON.parse(canonicalCharacterJson(spec)))).toEqual([
      'format',
      'version',
      'name',
      'seed',
      'style',
      'species',
      'body',
      'parts',
      'anatomy',
      'morphs',
      'tints',
    ]);
    const withExtras: CharacterSpec = {
      ...spec,
      composition: {weight: 0.5, muscle: 0},
      face: {decal: null, offsetPx: [0, 0]},
    };
    expect(
      Object.keys(JSON.parse(canonicalCharacterJson(withExtras))).slice(-2),
    ).toEqual(['composition', 'face']);
  });

  it('AC-CMP-039.1: the v1 fixture migrates to v2 with only style and species added', () => {
    expect(v1Fixture.version).toBe(1);
    const result = parseCharacterSpec(v1Fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(2);
    expect(result.value.style).toBe('realistic');
    expect(result.value.species).toBe('human');
    expect('composition' in result.value).toBe(false);
    const {version: _a, style: _b, species: _c, ...rest} = result.value;
    const {version: _d, ...fixtureRest} = v1Fixture;
    expect(rest).toEqual(fixtureRest);
  });

  it('AC-CMP-039.2: the v1 migration is pure and deterministic', () => {
    const input = clone(v1Fixture) as Record<string, unknown>;
    const step = CHARACTER_MIGRATIONS[1];
    expect(step).toBeDefined();
    const a = step?.(input);
    const b = step?.(input);
    expect(input).toEqual(clone(v1Fixture));
    expect(a).toEqual(b);
  });

  it('AC-CMP-039.3: a v1 document with style/species keys migrates to the defaults', () => {
    const result = parseCharacterSpec({
      ...clone(v1Fixture),
      style: 'chibi',
      species: 'monster',
    });
    expect(result.ok && [result.value.style, result.value.species]).toEqual([
      'realistic',
      'human',
    ]);
  });

  it('AC-CMP-039.4: a version 3 document is rejected as newer', () => {
    const result = parseCharacterSpec({...v2(), version: 3});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toContain('newer');
  });

  it('AC-CMP-040.1: unknown, miscased and non-string style/species are rejected, never coerced', () => {
    const cases: Array<[string, unknown]> = [
      ['style', 'pixel'],
      ['style', 'Chibi'],
      ['style', 42],
      ['species', 'robot'],
    ];
    for (const [key, value] of cases) {
      const result = parseCharacterSpec({...v2(), [key]: value});
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CMP_SPEC_INVALID');
        expect(result.issues[0]?.path).toBe(key);
      }
    }
  });

  it('AC-CMP-041.1: out-of-range or incomplete composition fails naming the field', () => {
    const over = parseCharacterSpec({
      ...v2(),
      composition: {weight: 1.01, muscle: 0},
    });
    expect(over.ok === false && over.issues[0]?.path).toBe(
      'composition.weight',
    );
    const partial = parseCharacterSpec({...v2(), composition: {weight: 0}});
    expect(partial.ok === false && partial.issues[0]?.path).toBe(
      'composition.muscle',
    );
  });

  it('AC-CMP-041.2: composition is quantized to 0.01', () => {
    const result = parseCharacterSpec({
      ...v2(),
      composition: {weight: 0.333, muscle: -0.666},
    });
    expect(result.ok && result.value.composition).toEqual({
      weight: 0.33,
      muscle: -0.67,
    });
  });

  it('AC-CMP-041.3: composition {0,0} is omitted from saved JSON; non-zero is kept', () => {
    const zero = parseCharacterSpec({
      ...v2(),
      composition: {weight: 0, muscle: 0},
    });
    expect(zero.ok && canonicalCharacterJson(zero.value)).not.toContain(
      'composition',
    );
    const half = parseCharacterSpec({
      ...v2(),
      composition: {weight: 0.5, muscle: 0},
    });
    expect(
      half.ok && JSON.parse(canonicalCharacterJson(half.value)),
    ).toMatchObject({composition: {weight: 0.5, muscle: 0}});
  });

  it('REQ-CMP-022: canonical JSON orders parts by slot registry and uses 2-space indent', () => {
    const spec = createDefaultCharacterSpec();
    const text = canonicalCharacterJson(spec);
    expect(text.split('\n')[1]).toBe('  "format": "sprite-character",');
    expect(Object.keys(JSON.parse(text).parts)).toEqual([
      'hair',
      'eyebrows',
      'torso',
      'arms',
      'legs',
      'feet',
    ]);
  });
});
