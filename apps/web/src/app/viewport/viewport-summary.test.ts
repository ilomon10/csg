import type {ClipRef} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {
  buildViewportSummary,
  clipName,
  facingAnnouncement,
  frameAt,
} from './viewport-summary';

const WALK = 'builtin:quaternius-ual/walk' as ClipRef;

describe('viewport summary', () => {
  it('AC-UX-039.1: the summary names the clip, frame, direction, size and view', () => {
    expect(
      buildViewportSummary({
        label: 'Knight',
        partCount: 8,
        clip: WALK,
        frame: 3,
        frameCount: 8,
        direction: 1,
        sizePx: 64,
        mode: 'pixel',
      }),
    ).toBe(
      'Knight: 8 parts, walk, frame 3 of 8, direction 2 of 8, 64 px, Pixel view',
    );
  });

  it('AC-UX-039.1: a clip change changes the text', () => {
    const base = {
      label: 'Knight',
      partCount: 8,
      frame: null,
      frameCount: null,
      direction: 0,
      sizePx: 64,
      mode: '3d' as const,
    };
    const idle = buildViewportSummary({
      ...base,
      clip: 'builtin:quaternius-ual/idle' as ClipRef,
    });
    const run = buildViewportSummary({
      ...base,
      clip: 'builtin:quaternius-ual/run' as ClipRef,
    });
    expect(idle).not.toContain('run');
    expect(run).toContain('run');
    expect(run).toContain('3D view');
  });

  it('AC-UX-058.1: facings are announced with their spoken name', () => {
    // DIRECTION_ORDER: e, ne, n, nw, w, sw, s, se
    expect(facingAnnouncement(5)).toBe('Facing south-west');
    expect(facingAnnouncement(6)).toBe('Facing south');
  });

  it('REQ-UX-039: clip names come from the ref and frames step through the clip', () => {
    expect(clipName(WALK)).toBe('walk');
    expect(frameAt(0, 2, 8)).toBe(1);
    expect(frameAt(1.99, 2, 8)).toBe(8);
    expect(frameAt(2.1, 2, 8)).toBe(1);
    expect(frameAt(0, 0, 8)).toBeNull();
  });
});
