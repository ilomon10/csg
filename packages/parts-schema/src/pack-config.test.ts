import {describe, expect, it} from 'vitest';
import {parsePackConfig} from './pack-config';

const license = {
  license: 'CC0-1.0',
  author: 'Quaternius',
  sourceUrl: 'https://quaternius.itch.io/x',
  commercialUse: 'yes',
  attributionRequired: false,
};

function part(overrides: Record<string, unknown> = {}) {
  return {
    id: 'male-ranger-torso',
    match: {file: 'Modular Parts/Male_Ranger_Body.gltf'},
    name: 'Ranger tunic',
    slot: 'torso',
    hides: ['neck', 'torso'],
    tintSlots: [{material: 'Cloth', slot: 'primary'}],
    bodies: ['superhero-m'],
    tags: ['ranger'],
    ...overrides,
  };
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    format: 'sprite-pack-config',
    version: 1,
    packId: 'quaternius-outfits',
    name: 'Outfits',
    license,
    rig: 'quaternius-ue5-65',
    parts: [part()],
    clips: [],
    ...overrides,
  };
}

function failure(json: unknown) {
  const result = parsePackConfig(json);
  if (result.ok) throw new Error('expected failure');
  return result.issues;
}

describe('pack config', () => {
  it('REQ-AST-009: the spec 011 example parses', () => {
    expect(parsePackConfig(config()).ok).toBe(true);
  });

  it('AC-CMP-037.1: a body entry may carry characterSkeletonGroup; other slots may not', () => {
    const body = part({
      id: 'superhero-m',
      slot: 'body',
      bodyType: 'superhero',
      characterSkeletonGroup: 'male',
      bodies: undefined,
    });
    expect(parsePackConfig(config({parts: [body]})).ok).toBe(true);
    const issues = failure(
      config({parts: [part({characterSkeletonGroup: 'male'})]}),
    );
    expect(issues[0]).toMatchObject({
      entryId: 'male-ranger-torso',
      field: 'characterSkeletonGroup',
    });
  });

  it('REQ-AST-009: match.file is relative to the pack dir (spaces and brackets are fine)', () => {
    const ok = part({match: {file: 'Modular Parts [Standard]/Male (1).gltf'}});
    expect(parsePackConfig(config({parts: [ok]})).ok).toBe(true);
    for (const file of [
      '/abs/x.gltf',
      '../x.gltf',
      'a/../x.gltf',
      'a\\x.gltf',
      'C:/x.gltf',
      'a//x.gltf',
      '',
    ]) {
      const issues = failure(config({parts: [part({match: {file}})]}));
      expect(issues[0]).toMatchObject({
        entryId: 'male-ranger-torso',
        field: 'file',
      });
    }
  });

  it('REQ-AST-013: computed fields are not allowed in an authored config', () => {
    expect(
      parsePackConfig(config({parts: [part({sha256: 'a'.repeat(64)})]})).ok,
    ).toBe(false);
  });

  it('AC-GEN-008.1: a missing pack license names the pack id and field', () => {
    const issues = failure(config({license: undefined}));
    expect(issues[0]).toMatchObject({
      entryId: 'quaternius-outfits',
      field: 'license',
    });
  });

  it('AC-AST-017.1: a non-bundlable license is rejected', () => {
    expect(
      parsePackConfig(config({license: {...license, license: 'CC-BY-SA-4.0'}}))
        .ok,
    ).toBe(false);
  });

  it('REQ-AST-019: duplicate part and clip ids are rejected', () => {
    expect(failure(config({parts: [part(), part()]}))[0]?.message).toContain(
      'male-ranger-torso',
    );
    const clip = {
      id: 'walk',
      match: {file: 'UAL1.glb', animation: 'Walk_Loop'},
      name: 'Walk',
      category: 'locomotion',
      loop: true,
      defaultFrameCount: 8,
      tags: [],
    };
    expect(parsePackConfig(config({clips: [clip]})).ok).toBe(true);
    expect(failure(config({clips: [clip, clip]}))[0]?.entryId).toBe('walk');
  });

  it('REQ-AST-009: a clip names its source animation and in-place variant must exist', () => {
    const clip = {
      id: 'walk',
      match: {file: 'UAL1.glb'},
      name: 'Walk',
      category: 'locomotion',
      loop: true,
      defaultFrameCount: 8,
      tags: [],
    };
    expect(failure(config({clips: [clip]}))[0]).toMatchObject({
      entryId: 'walk',
      field: 'animation',
    });
    const withVariant = {
      ...clip,
      match: {...clip.match, animation: 'W'},
      inPlaceVariant: 'nope',
    };
    expect(parsePackConfig(config({clips: [withVariant]})).ok).toBe(false);
  });
});
