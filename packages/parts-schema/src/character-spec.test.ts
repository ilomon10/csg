import {describe, expect, it} from 'vitest';
import {
  CHARACTER_MIGRATIONS,
  characterSpecSchema,
  DEFAULT_CHARACTER_DATA,
  createDefaultCharacterSpec,
  defaultCharacterDataSchema,
  migrateCharacterSpec,
  parseCharacterSpec,
} from './character-spec';
import {parseJson} from './json';

const clone = () =>
  JSON.parse(JSON.stringify(createDefaultCharacterSpec())) as Record<
    string,
    unknown
  >;

describe('character spec', () => {
  it('REQ-CMP-036: the default spec validates, uses superhero-m and has all anatomy at 1', () => {
    const spec = createDefaultCharacterSpec();
    const result = parseCharacterSpec(spec);
    expect(result.ok).toBe(true);
    expect(spec.body.ref).toBe('builtin:quaternius-ubc/superhero-m');
    expect(spec.seed).toBe(0);
    expect(Object.values(spec.anatomy).every(v => v === 1)).toBe(true);
  });

  it('AC-CMP-036.3: the default data file validates and fills the six part slots', () => {
    expect(
      defaultCharacterDataSchema.safeParse(DEFAULT_CHARACTER_DATA).success,
    ).toBe(true);
    const spec = createDefaultCharacterSpec();
    expect(Object.keys(spec.parts)).toHaveLength(6);
    // PM 2026-10-09 (FX-K/FX-L): `multiply` is texel × tint, so white tints
    // show the authored Quaternius colours; only hair (a grey texture made to
    // be tinted) defaults to natural brown.
    expect(Object.values(spec.tints)).toHaveLength(7);
    for (const [slot, hex] of Object.entries(spec.tints))
      expect(hex).toBe(slot === 'hair' ? '#7a4a26' : '#ffffff');
    expect(spec.parts['hair']?.ref).toBe(
      'builtin:quaternius-ubc/hair-simple-parted',
    );
    spec.parts['hair'] = {ref: 'builtin:x/y'};
    expect(createDefaultCharacterSpec().parts['hair']?.ref).not.toBe(
      'builtin:x/y',
    );
  });

  it('AC-CMP-002.2: a spec with no body fails with CMP_BODY_MISSING', () => {
    const {body: _omit, ...rest} = clone();
    const result = parseCharacterSpec(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CMP_BODY_MISSING');
      expect(result.issues[0]?.path).toBe('body');
    }
    const nulled = parseCharacterSpec({...rest, body: null});
    expect(nulled.ok === false && nulled.code).toBe('CMP_BODY_MISSING');
  });

  it('REQ-CMP-023: unknown format and newer versions are CMP_SPEC_INVALID', () => {
    const wrong = parseCharacterSpec({...clone(), format: 'other'});
    expect(wrong.ok === false && wrong.code).toBe('CMP_SPEC_INVALID');
    const newer = parseCharacterSpec({...clone(), version: 3});
    expect(newer.ok === false && newer.code).toBe('CMP_SPEC_INVALID');
    expect(parseCharacterSpec('nope').ok).toBe(false);
  });

  it('REQ-CMP-023: a current-version document passes through the chain unchanged', () => {
    expect(Object.keys(CHARACTER_MIGRATIONS)).toEqual(['1']);
    const doc = clone();
    expect(migrateCharacterSpec(doc)).toEqual({ok: true, value: doc});
  });

  it('REQ-CMP-023: migrations run in order from the document version, purely', () => {
    const v1 = {
      format: 'sprite-character',
      version: 1,
      name: 'x',
      trail: ['v1'],
    };
    const migrations = {
      1: (d: Record<string, unknown>) => ({
        ...d,
        trail: [...(d['trail'] as string[]), 'v2'],
      }),
      2: (d: Record<string, unknown>) => ({
        ...d,
        trail: [...(d['trail'] as string[]), 'v3'],
      }),
    };
    const result = migrateCharacterSpec(v1, migrations, 3);
    expect(result).toEqual({
      ok: true,
      value: {
        format: 'sprite-character',
        version: 3,
        name: 'x',
        trail: ['v1', 'v2', 'v3'],
      },
    });
    expect(v1.version).toBe(1);
    expect(
      migrateCharacterSpec({...v1, version: 2}, migrations, 3),
    ).toMatchObject({
      ok: true,
      value: {version: 3, trail: ['v1', 'v3']},
    });
    expect(migrateCharacterSpec(v1, {}, 2).ok).toBe(false);
  });

  it('AC-ANA-016.2: face.offsetPx = [5, 0] fails naming face.offsetPx', () => {
    const result = parseCharacterSpec({
      ...clone(),
      face: {decal: null, offsetPx: [5, 0]},
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues.some(i => i.path.startsWith('face.offsetPx'))).toBe(
        true,
      );
  });

  it('REQ-CMP-014: tints need all 7 slots and normalize to lowercase', () => {
    const spec = clone();
    const tints = {...(spec['tints'] as Record<string, string>)};
    delete tints['metal'];
    expect(parseCharacterSpec({...spec, tints}).ok).toBe(false);
    const upper = parseCharacterSpec({
      ...spec,
      tints: {...(spec['tints'] as object), skin: '#ABCDEF'},
    });
    expect(upper.ok && upper.value.tints.skin).toBe('#abcdef');
  });

  it('REQ-CMP-015: part tint overrides are partial; unknown slots fail', () => {
    const spec = clone();
    const ok = {
      ...spec,
      parts: {back: {ref: 'builtin:p/cape', tints: {primary: '#0000ff'}}},
    };
    expect(parseCharacterSpec(ok).ok).toBe(true);
    const bad = {
      ...spec,
      parts: {back: {ref: 'builtin:p/cape', tints: {glow: '#0000ff'}}},
    };
    expect(parseCharacterSpec(bad).ok).toBe(false);
  });

  it('REQ-CMP-001: parts must not hold a body key; seed is a uint32; name is 1..64', () => {
    const spec = clone();
    expect(
      parseCharacterSpec({...spec, parts: {body: {ref: 'builtin:p/b'}}}).ok,
    ).toBe(false);
    expect(parseCharacterSpec({...spec, seed: 4294967296}).ok).toBe(false);
    expect(parseCharacterSpec({...spec, seed: -1}).ok).toBe(false);
    expect(parseCharacterSpec({...spec, name: ''}).ok).toBe(false);
    expect(parseCharacterSpec({...spec, name: 'x'.repeat(65)}).ok).toBe(false);
  });

  it('AC-ANA-012.3: morph names the body lacks are kept on round trip', () => {
    const result = parseCharacterSpec({
      ...clone(),
      morphs: {belly: 0.5, unknown: 1},
    });
    expect(result.ok && result.value.morphs).toEqual({belly: 0.5, unknown: 1});
    expect(parseCharacterSpec({...clone(), morphs: {belly: 1.5}}).ok).toBe(
      false,
    );
  });

  it('AC-ANA-001.2: anatomy is quantized and range-checked inside the spec', () => {
    const spec = clone();
    const anatomy = {...(spec['anatomy'] as object), head: 1.234};
    const result = parseCharacterSpec({...spec, anatomy});
    expect(result.ok && result.value.anatomy.head).toBe(1.23);
    expect(
      parseCharacterSpec({...spec, anatomy: {...anatomy, head: 2.01}}).ok,
    ).toBe(false);
  });

  it('REQ-GEN-011: forbidden keys are rejected by parseJson before validation', () => {
    const text = JSON.stringify(clone()).replace(
      '"seed"',
      '"__proto__":{},"seed"',
    );
    expect(parseJson(text).ok).toBe(false);
  });

  it('REQ-CMP-001: the schema round-trips its own output', () => {
    const spec = createDefaultCharacterSpec();
    expect(characterSpecSchema.parse(JSON.parse(JSON.stringify(spec)))).toEqual(
      spec,
    );
  });
});
