import {describe, expect, it} from 'vitest';
import * as engine from './index';

describe('@csg/engine barrel', () => {
  it('REQ-CMP-033 / REQ-GEN-002: exports the M1 public API', () => {
    for (const name of [
      'createAssetRegistry',
      'createGlbLoader',
      'createBodySkeleton',
      'attachSkinnedPart',
      'attachStaticPart',
      'updateSockets',
      'createTintUniforms',
      'regionMaskOf',
      'createCharacterAssembly',
      'evaluatePose',
      'createAnatomyBinding',
      'applyAnatomy',
      'createClipPlayer',
      'computeSampleTimes',
      'createCharacterRenderer',
      'createRendererBackend',
      'previewTimingFor',
      'restPoseForGroup',
      'createRetargetPlan',
    ]) {
      expect(typeof (engine as Record<string, unknown>)[name], name).toBe(
        'function',
      );
    }
  });
});
