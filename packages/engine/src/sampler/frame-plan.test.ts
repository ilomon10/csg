import {describe, expect, it} from 'vitest';
import {parseRenderSettings} from '@csg/parts-schema';
import type {ClipRef, RenderSettings} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import {
  activeDirectionLabels,
  mirrorSourceDirection,
  planFrames,
  sourceFrameIndices,
} from './frame-plan';

const WALK: ClipRef = 'builtin:fixture-pack/fixture-clip';
const ATTACK: ClipRef = 'builtin:fixture-pack/attack';
const WALK_BACK: ClipRef = 'builtin:fixture-pack/walk-back';
const DURATIONS = new Map<ClipRef, number>([
  [WALK, 1],
  [ATTACK, 0.7],
  [WALK_BACK, 1.3],
]);

function settings(input: Record<string, unknown>): RenderSettings {
  const result = parseRenderSettings(input);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const walk = {clipId: WALK, label: 'walk', frameCount: 8, fps: 8, loop: true};

describe('planFrames', () => {
  it('AC-ANM-011.1: 8 directions × walk N=8 → 8 frames per direction, frame i uses t_i in every direction', () => {
    const s = settings({directions: 8, animations: [walk]});
    const jobs = planFrames(s, DURATIONS);
    expect(jobs).toHaveLength(64);
    const {times} = computeSampleTimes(walk, 1);
    for (let d = 0; d < 8; d++) {
      const dir = jobs.filter(j => j.direction === d);
      expect(dir.map(j => j.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(dir.map(j => j.timeSec)).toEqual(times);
      expect(dir.map(j => j.sourceFrame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
    expect(new Set(jobs.map(j => j.durationMs))).toEqual(new Set([125]));
    expect(new Set(jobs.map(j => j.clipId))).toEqual(new Set([WALK]));
  });

  it('AC-EXP-001.1 (plan): jobs are ordered clip (settings order) → direction → frame', () => {
    const attack = {
      clipId: ATTACK,
      label: 'attack',
      frameCount: 5,
      fps: 12,
      loop: false,
    };
    // `attack` first: settings order wins over label order.
    const s = settings({directions: 4, animations: [attack, walk]});
    const jobs = planFrames(s, DURATIONS);
    expect(jobs).toHaveLength(4 * 5 + 4 * 8);
    const key = (j: (typeof jobs)[number]) => [
      j.label === 'attack' ? 0 : 1,
      j.direction,
      j.frame,
    ];
    for (let i = 1; i < jobs.length; i++) {
      const [a, b] = [key(jobs[i - 1]!), key(jobs[i]!)];
      const cmp = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      expect(cmp).toBeLessThan(0);
    }
    expect(jobs[0]).toEqual({
      label: 'attack',
      clipId: ATTACK,
      direction: 0,
      frame: 0,
      sourceFrame: 0,
      timeSec: 0,
      durationMs: 1000 / 12,
    });
    expect(jobs.at(-1)).toMatchObject({label: 'walk', direction: 3, frame: 7});
  });

  it('REQ-PIX-027 (plan): planning is deterministic', () => {
    const s = settings({directions: 8, animations: [walk]});
    expect(planFrames(s, DURATIONS)).toEqual(planFrames(s, DURATIONS));
  });

  it('AC-ANM-010.2 (plan): bakePingPong N=5 → source indices [0,1,2,3,4,3,2,1]', () => {
    const sel = {
      clipId: WALK,
      label: 'bob',
      frameCount: 5,
      fps: 10,
      loop: false,
      pingPong: true,
      bakePingPong: true,
    };
    expect(sourceFrameIndices(sel)).toEqual([0, 1, 2, 3, 4, 3, 2, 1]);
    const jobs = planFrames(
      settings({directions: 1, animations: [sel]}),
      DURATIONS,
    );
    expect(jobs.map(j => j.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(jobs.map(j => j.sourceFrame)).toEqual([0, 1, 2, 3, 4, 3, 2, 1]);
    expect(jobs[5]!.timeSec).toBe(jobs[3]!.timeSec);
    expect(jobs[7]!.timeSec).toBe(jobs[1]!.timeSec);
  });

  it('AC-ANM-010.1 (plan): pingPong without bake plans N frames', () => {
    const sel = {...walk, frameCount: 5, pingPong: true};
    expect(sourceFrameIndices(sel)).toEqual([0, 1, 2, 3, 4]);
  });

  it('AC-ANM-012.1 (plan): a direction override renders its clip with the same frame count', () => {
    const sel = {...walk, directionOverrides: {'2': WALK_BACK}};
    const jobs = planFrames(
      settings({directions: 8, animations: [sel]}),
      DURATIONS,
    );
    const north = jobs.filter(j => j.direction === 2);
    expect(north).toHaveLength(8);
    expect(new Set(north.map(j => j.clipId))).toEqual(new Set([WALK_BACK]));
    expect(north.map(j => j.timeSec)).toEqual(
      computeSampleTimes(sel, 1.3).times,
    );
    expect(jobs.filter(j => j.clipId === WALK)).toHaveLength(56);
  });

  it('AC-PIX-005.2/005.3 (plan): direction count and single facing', () => {
    expect(activeDirectionLabels(settings({directions: 4}))).toEqual([
      'e',
      'n',
      'w',
      's',
    ]);
    expect(activeDirectionLabels(settings({directions: 2}))).toEqual([
      'e',
      'w',
    ]);
    expect(
      activeDirectionLabels(settings({directions: 1, singleFacing: 'sw'})),
    ).toEqual(['sw']);
    const jobs = planFrames(
      settings({directions: 2, animations: [walk]}),
      DURATIONS,
    );
    expect(jobs).toHaveLength(16);
  });

  it('plans nothing without animations and throws on a missing clip duration', () => {
    expect(planFrames(settings({directions: 8}), DURATIONS)).toEqual([]);
    const s = settings({
      directions: 1,
      animations: [{...walk, clipId: 'builtin:fixture-pack/missing'}],
    });
    expect(() => planFrames(s, DURATIONS)).toThrow(/no duration/);
  });

  it('AC-PIX-006.1 (plan): mirrorWest maps w/nw/sw to e/ne/se in the active set', () => {
    const s8 = settings({directions: 8, mirrorWest: true});
    // e ne n nw w sw s se
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7].map(d => mirrorSourceDirection(s8, d)),
    ).toEqual([null, null, null, 1, 0, 7, null, null]);
    const s2 = settings({directions: 2, mirrorWest: true});
    expect(mirrorSourceDirection(s2, 1)).toBe(0);
    expect(mirrorSourceDirection(settings({directions: 2}), 1)).toBeNull();
    expect(
      mirrorSourceDirection(
        settings({directions: 1, singleFacing: 'w', mirrorWest: true}),
        0,
      ),
    ).toBeNull();
  });
});
