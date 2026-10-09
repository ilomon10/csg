import {
  canonicalCharacterJson,
  createDefaultCharacterSpec,
} from '@csg/parts-schema';
import {beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import {
  characterFileName,
  loadCharacterFile,
  MAX_CHARACTER_FILE_BYTES,
  serializeCharacter,
} from './character-file';
import {loadTestCatalog} from './test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadTestCatalog();
});

const withSpec = (patch: (spec: Record<string, unknown>) => void) => {
  const spec = JSON.parse(
    canonicalCharacterJson(createDefaultCharacterSpec()),
  ) as Record<string, unknown>;
  patch(spec);
  return JSON.stringify(spec);
};

describe('character file', () => {
  it('AC-CMP-022.1: "Hero #1" saves as hero-1.character.json', () => {
    expect(characterFileName('Hero #1')).toBe('hero-1.character.json');
    expect(characterFileName('  ../Ünï/Çode  ')).toBe(
      'uni-code.character.json',
    );
    expect(characterFileName('###')).toBe('character.character.json');
    expect(characterFileName('a'.repeat(200)).length).toBeLessThanOrEqual(
      64 + '.character.json'.length,
    );
  });

  it('AC-CMP-022.2: the same spec saves to byte-identical text, canonical with 2-space indent', () => {
    const spec = createDefaultCharacterSpec();
    const a = serializeCharacter(spec);
    expect(serializeCharacter({...spec})).toBe(a);
    expect(a).toBe(canonicalCharacterJson(spec, 2));
    expect(a.split('\n')[1]?.startsWith('  "')).toBe(true);
    expect(JSON.parse(a).format).toBe('sprite-character');
  });

  it('AC-CMP-023.1: a valid file loads to the saved spec', () => {
    const spec = createDefaultCharacterSpec();
    const result = loadCharacterFile(serializeCharacter(spec), catalog);
    expect(result).toEqual({ok: true, spec, missing: []});
  });

  it('AC-CMP-023.2: a wrong format, malformed JSON or an oversized file is refused with CMP_SPEC_INVALID', () => {
    const wrong = loadCharacterFile(
      withSpec(s => (s['format'] = 'other')),
      catalog,
    );
    expect(wrong).toMatchObject({
      ok: false,
      code: 'CMP_SPEC_INVALID',
      path: 'format',
    });
    const bad = loadCharacterFile('{nope', catalog);
    expect(bad).toMatchObject({ok: false, code: 'CMP_SPEC_INVALID'});
    const huge = loadCharacterFile(
      ' '.repeat(MAX_CHARACTER_FILE_BYTES + 1),
      catalog,
    );
    expect(huge).toMatchObject({ok: false, code: 'CMP_SPEC_INVALID'});
    const proto = loadCharacterFile('{"__proto__":{"x":1}}', catalog);
    expect(proto.ok).toBe(false);
  });

  it('AC-CMP-023.3: a newer version says "Made with a newer version of the app"', () => {
    const result = loadCharacterFile(
      withSpec(s => (s['version'] = 99)),
      catalog,
    );
    expect(result).toMatchObject({
      ok: false,
      message: 'Made with a newer version of the app.',
    });
  });

  it('AC-CMP-024.1: an unknown builtin part leaves its slot empty and is listed, the rest loads', () => {
    const result = loadCharacterFile(
      withSpec(s => {
        (s['parts'] as Record<string, unknown>)['back'] = {
          ref: 'builtin:quaternius-outfits/cape-99',
        };
      }),
      catalog,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.missing).toEqual(['cape-99']);
    expect(result.spec.parts['back']).toBeUndefined();
    expect(result.spec.parts['hair']).toBeDefined();
  });

  it('AC-CMP-024.2: an unknown builtin body fails with CMP_BODY_MISSING', () => {
    const result = loadCharacterFile(
      withSpec(s => (s['body'] = {ref: 'builtin:quaternius-ubc/nobody'})),
      catalog,
    );
    expect(result).toMatchObject({ok: false, code: 'CMP_BODY_MISSING'});
  });

  it('AC-CMP-024.3: a user: ref is kept for spec 008 to handle', () => {
    const result = loadCharacterFile(
      withSpec(s => {
        (s['parts'] as Record<string, unknown>)['back'] = {ref: 'user:cape-1'};
      }),
      catalog,
    );
    expect(result.ok && result.spec.parts['back']?.ref).toBe('user:cape-1');
    expect(result.ok && result.missing).toEqual([]);
  });
});
