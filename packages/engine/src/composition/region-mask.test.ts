import {BODY_REGIONS} from '@csg/parts-schema';
import type {BodyRegion} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {
  computeHides,
  createRegionMask,
  isRegionHidden,
  regionMaskOf,
  regionVisibleNode,
  setRegionMask,
} from './region-mask';

function collect(node: {traverse(cb: (n: unknown) => void): void}): unknown[] {
  const out: unknown[] = [];
  node.traverse(n => out.push(n));
  return out;
}

describe('region mask', () => {
  it('AC-AST-025.2: the hide mask for [hands, feet] is 1088 (bit 6 + bit 10)', () => {
    expect(regionMaskOf(['hands', 'feet'])).toBe(1088);
    expect(regionMaskOf([])).toBe(0);
    expect(regionMaskOf(['head'])).toBe(1);
    expect(regionMaskOf(['feet', 'hands', 'hands'])).toBe(1088);
  });

  it('REQ-AST-025: bit i is BODY_REGIONS[i] for every region', () => {
    BODY_REGIONS.forEach((region, i) => {
      const mask = regionMaskOf([region]);
      expect(mask).toBe(2 ** i);
      for (let r = 0; r < BODY_REGIONS.length; r++) {
        expect(isRegionHidden(mask, r)).toBe(r === i);
        // Interpolation noise on the Float32 attribute does not change the region.
        expect(isRegionHidden(mask, r + 0.3)).toBe(r === i);
        expect(isRegionHidden(mask, r - 0.3)).toBe(r === i);
      }
    });
    expect(() => regionMaskOf(['tail' as BodyRegion])).toThrow();
  });

  it('AC-CMP-011.1: a torso with hides [torso, upper-arms] hides exactly those regions', () => {
    const state = computeHides([
      {slot: 'body', entry: {hides: []}},
      {slot: 'torso', entry: {hides: ['torso', 'upper-arms']}},
    ]);
    expect(state.regions).toEqual(['torso', 'upper-arms']);
    expect(state.mask).toBe(regionMaskOf(['torso', 'upper-arms']));
    BODY_REGIONS.forEach((region, i) => {
      expect(isRegionHidden(state.mask, i)).toBe(
        region === 'torso' || region === 'upper-arms',
      );
    });
  });

  it('AC-CMP-011.2: unequipping the torso draws the regions again (mask uniform updated in place)', () => {
    const mask = createRegionMask();
    const node = regionVisibleNode(mask);
    setRegionMask(
      mask,
      computeHides([{slot: 'torso', entry: {hides: ['torso', 'upper-arms']}}])
        .regions,
    );
    expect(mask.value).toBe(24);
    setRegionMask(
      mask,
      computeHides([{slot: 'body', entry: {hides: []}}]).regions,
    );
    expect(mask.value).toBe(0);
    for (let r = 0; r < BODY_REGIONS.length; r++)
      expect(isRegionHidden(mask.value, r)).toBe(false);
    // The shader condition reads the uniform object itself, so no rebuild is needed.
    expect(collect(node)).toContain(mask);
  });

  it('REQ-CMP-011: overlapping hides form a union in BODY_REGIONS order, independent of part order', () => {
    const a = {
      slot: 'torso',
      entry: {hides: ['upper-arms', 'torso'] as BodyRegion[]},
    } as const;
    const b = {
      slot: 'hands',
      entry: {hides: ['hands', 'torso'] as BodyRegion[]},
    } as const;
    expect(computeHides([a, b])).toEqual(computeHides([b, a]));
    expect(computeHides([a, b]).regions).toEqual([
      'torso',
      'upper-arms',
      'hands',
    ]);
  });

  it('AC-CMP-012.1: a helmet hiding hair hides the hair slot; removing it draws the hair again', () => {
    const hair = {slot: 'hair', entry: {hides: []}} as const;
    const helmet = {
      slot: 'headwear',
      entry: {hides: ['hair'] as BodyRegion[]},
    } as const;
    expect(computeHides([hair]).hiddenSlots).toEqual([]);
    expect(computeHides([hair, helmet]).hiddenSlots).toEqual(['hair']);
    expect(computeHides([hair, helmet]).regions).toContain('hair');
    expect(computeHides([hair]).hiddenSlots).toEqual([]);
    // A hair part never hides itself.
    expect(
      computeHides([{slot: 'hair', entry: {hides: ['hair']}}]).hiddenSlots,
    ).toEqual([]);
  });
});
