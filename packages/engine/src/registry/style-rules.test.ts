/**
 * Style and species rules (spec 001 REQ-CMP-048 rules (d)/(e), REQ-CMP-043/045 availability).
 */
import {describe, expect, it} from 'vitest';
import type {PartEntry} from '@csg/parts-schema';
import {createTestRegistry, testStyle} from '../composition/assembly-test-env';
import {checkCompatibility} from './index';

const BODY = {
  id: 'superhero-m',
  slot: 'body',
  kind: 'skinned',
  rig: 'quaternius-ue5-65',
  bodyType: 'superhero',
} as PartEntry;

function part(over: Partial<PartEntry>): PartEntry {
  return {
    id: 'p',
    name: 'P',
    slot: 'headwear',
    kind: 'skinned',
    file: 'p.glb',
    rig: 'quaternius-ue5-65',
    hides: [],
    tintSlots: [],
    sha256: '0'.repeat(64),
    stats: {triangles: 1, textures: 0},
    tags: [],
    ...over,
  } as PartEntry;
}

const HUMAN = {style: 'realistic', species: 'human'} as const;
const ANIMAL = {style: 'realistic', species: 'animal'} as const;

describe('REQ-CMP-048: compatibility rules (d) style and (e) species', () => {
  it('AC-CMP-048.1: species [animal] is incompatible with a human character (reason species) and compatible with an animal one', () => {
    const ears = part({species: ['animal']});
    expect(checkCompatibility(ears, BODY, HUMAN)).toEqual({
      ok: false,
      reason: 'species',
    });
    for (const style of ['realistic', 'chibi', 'stickman', 'voxel'] as const) {
      expect(
        checkCompatibility(ears, BODY, {style, species: 'animal'}),
      ).toEqual({ok: true});
    }
    expect(checkCompatibility(ears, BODY, ANIMAL)).toEqual({ok: true});
  });

  it('AC-CMP-048.3: bodies excluding the body and species [animal] on a human character report body (rule b before e)', () => {
    const p = part({bodies: ['superhero-f'], species: ['animal']});
    expect(checkCompatibility(p, BODY, HUMAN)).toEqual({
      ok: false,
      reason: 'body',
    });
  });

  it('REQ-CMP-048: rule (d) style is checked before (e) species; absent or empty lists fit every value', () => {
    const p = part({styles: ['chibi'], species: ['animal']});
    expect(checkCompatibility(p, BODY, HUMAN)).toEqual({
      ok: false,
      reason: 'style',
    });
    expect(
      checkCompatibility(p, BODY, {style: 'chibi', species: 'human'}),
    ).toEqual({ok: false, reason: 'species'});
    expect(
      checkCompatibility(part({styles: [], species: []}), BODY, HUMAN),
    ).toEqual({ok: true});
    // Without a character the M1 rules (a)-(c) only (callers that check bodies alone).
    expect(checkCompatibility(p, BODY)).toEqual({ok: true});
  });
});

describe('REQ-CMP-043/045: registered styles gate the available pairs', () => {
  it('REQ-CMP-045: before registerStyles the supported pairs are available as they are', () => {
    const registry = createTestRegistry();
    expect(registry.inner.availableStyleCombos()).toEqual([
      ['realistic', 'human'],
      ['chibi', 'human'],
    ]);
  });

  it('AC-CMP-045.4 (engine): a supported pair needs its style data file; registering it enables the pair', () => {
    const registry = createTestRegistry({styles: [testStyle('realistic')]});
    expect(registry.inner.availableStyleCombos()).toEqual([
      ['realistic', 'human'],
    ]);
    registry.inner.registerStyles([testStyle('chibi')]);
    expect(registry.inner.availableStyleCombos()).toEqual([
      ['realistic', 'human'],
      ['chibi', 'human'],
    ]);
    expect(registry.inner.styleDefinition('chibi')).toEqual(testStyle('chibi'));
    expect(registry.inner.styleDefinition('voxel')).toBeUndefined();
  });

  it('AC-CMP-045.3 (engine): a build that also supports stickman/human enables it once the style file is loaded', () => {
    const registry = createTestRegistry({
      supportedStyleCombos: [
        ['realistic', 'human'],
        ['stickman', 'human'],
      ],
      styles: [testStyle('realistic'), testStyle('stickman')],
    });
    expect(registry.inner.availableStyleCombos()).toEqual([
      ['realistic', 'human'],
      ['stickman', 'human'],
    ]);
  });

  it('AC-CMP-045.5 (engine): a non-human species needs a loaded species-head part for it', () => {
    const supported = [['realistic', 'animal']] as const;
    const registry = createTestRegistry({
      supportedStyleCombos: supported,
      styles: [testStyle('realistic')],
    });
    expect(registry.inner.availableStyleCombos()).toEqual([]);
    registry.inner.registerPack(
      {
        format: 'sprite-parts-manifest',
        version: 1,
        packId: 'animal-pack',
        name: 'Animal pack',
        license: {
          license: 'CC0-1.0',
          author: 'Test',
          sourceUrl: 'https://example.com',
          commercialUse: 'yes',
          attributionRequired: false,
        },
        rigs: [],
        parts: [
          part({id: 'cat-head', slot: 'species-head', species: ['animal']}),
        ],
      } as never,
      'packs/animal/',
    );
    expect(registry.inner.availableStyleCombos()).toEqual(supported);
  });
});
