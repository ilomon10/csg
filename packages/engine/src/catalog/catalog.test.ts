import {describe, expect, it} from 'vitest';
import type {PartEntry} from '@csg/parts-schema';
import {
  SUPPORTED_STYLE_COMBOS,
  checkCompatibility,
  parseClipManifestJson,
  parsePartManifestJson,
  resolveRenderPair,
} from './index';

const CHIBI_HUMAN = ['chibi', 'human'] as const;
const REALISTIC_HUMAN = ['realistic', 'human'] as const;

describe('@csg/engine/catalog', () => {
  it('REQ-CMP-043: M3 supports exactly realistic/human and chibi/human', () => {
    expect(SUPPORTED_STYLE_COMBOS).toEqual([REALISTIC_HUMAN, CHIBI_HUMAN]);
  });

  it('AC-CMP-043.1: an unsupported style falls back to realistic and flags it', () => {
    expect(
      resolveRenderPair(
        {style: 'stickman', species: 'human'},
        SUPPORTED_STYLE_COMBOS,
      ),
    ).toEqual({style: 'realistic', species: 'human', fallback: true});
  });

  it('AC-CMP-043.2: chibi/monster renders chibi/human', () => {
    expect(
      resolveRenderPair(
        {style: 'chibi', species: 'monster'},
        SUPPORTED_STYLE_COMBOS,
      ),
    ).toEqual({style: 'chibi', species: 'human', fallback: true});
  });

  it('REQ-CMP-043: an available pair is used as stored, without fallback', () => {
    expect(
      resolveRenderPair(
        {style: 'chibi', species: 'human'},
        SUPPORTED_STYLE_COMBOS,
      ),
    ).toEqual({style: 'chibi', species: 'human', fallback: false});
  });

  it('REQ-CMP-043: a style and species that exist only in other pairs end at realistic/human', () => {
    const available = [REALISTIC_HUMAN, ['voxel', 'animal']] as const;
    expect(
      resolveRenderPair({style: 'voxel', species: 'human'}, available),
    ).toEqual({style: 'realistic', species: 'human', fallback: true});
    expect(resolveRenderPair({style: 'voxel', species: 'animal'}, [])).toEqual({
      style: 'realistic',
      species: 'human',
      fallback: true,
    });
  });

  it('REQ-CMP-043: resolving never mutates the available list', () => {
    const available = [...SUPPORTED_STYLE_COMBOS];
    resolveRenderPair({style: 'voxel', species: 'monster'}, available);
    expect(available).toEqual([...SUPPORTED_STYLE_COMBOS]);
  });

  it('REQ-CMP-008: the barrel exposes compatibility and manifest parsing', () => {
    const body = {id: 'b', rig: 'r', bodyType: 't'};
    const part = {kind: 'skinned', rig: 'other'} as PartEntry;
    expect(checkCompatibility(part, body as never)).toEqual({
      ok: false,
      reason: 'rig',
    });
    expect(parsePartManifestJson('{').ok).toBe(false);
    expect(parseClipManifestJson('{').ok).toBe(false);
  });
});
