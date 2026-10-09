import {describe, expect, it} from 'vitest';
import {
  animationSelectionSchema,
  animationSelectionsSchema,
} from './animation-selection';

const base = {
  clipId: 'builtin:test-ual/walk',
  label: 'walk',
  frameCount: 8,
  fps: 12,
  loop: true,
};

describe('animation selection', () => {
  it('REQ-ANM-004: a minimal selection parses', () => {
    expect(animationSelectionSchema.safeParse(base).success).toBe(true);
  });

  it('AC-ANM-005.1: frameCount = 65 is rejected', () => {
    const result = animationSelectionSchema.safeParse({
      ...base,
      frameCount: 65,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe('Frames must be 1–64');
  });

  it('AC-ANM-005.2: range [1.2, 0.8] fails naming range', () => {
    const result = animationSelectionSchema.safeParse({
      ...base,
      range: {startSec: 1.2, endSec: 0.8},
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual(['range']);
  });

  it('AC-ANM-005.2: a valid range parses', () => {
    expect(
      animationSelectionSchema.safeParse({
        ...base,
        range: {startSec: 0.8, endSec: 1.2},
      }).success,
    ).toBe(true);
  });

  it('REQ-ANM-004: bakePingPong requires pingPong; label and fps are bounded', () => {
    expect(
      animationSelectionSchema.safeParse({...base, bakePingPong: true}).success,
    ).toBe(false);
    expect(
      animationSelectionSchema.safeParse({
        ...base,
        pingPong: true,
        bakePingPong: true,
      }).success,
    ).toBe(true);
    expect(
      animationSelectionSchema.safeParse({...base, label: 'Walk Cycle'})
        .success,
    ).toBe(false);
    expect(animationSelectionSchema.safeParse({...base, fps: 61}).success).toBe(
      false,
    );
    expect(
      animationSelectionSchema.safeParse({...base, fps: 12.5}).success,
    ).toBe(false);
  });

  it('REQ-ANM-004: directionOverrides need clip refs keyed by direction index', () => {
    const ok = {...base, directionOverrides: {'2': 'builtin:test-ual/run'}};
    expect(animationSelectionSchema.safeParse(ok).success).toBe(true);
    expect(
      animationSelectionSchema.safeParse({
        ...base,
        directionOverrides: {left: 'builtin:test-ual/run'},
      }).success,
    ).toBe(false);
    expect(
      animationSelectionSchema.safeParse({
        ...base,
        directionOverrides: {'2': 'run'},
      }).success,
    ).toBe(false);
  });

  it('REQ-ANM-006: labels are unique within an export', () => {
    const result = animationSelectionsSchema.safeParse([
      base,
      {...base, clipId: 'builtin:test-ual/run'},
    ]);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.path).toEqual([1, 'label']);
  });

  it('REQ-ANM-004: more than 32 selections are rejected', () => {
    const many = Array.from({length: 33}, (_, i) => ({
      ...base,
      label: `walk-${i}`,
    }));
    expect(animationSelectionsSchema.safeParse(many.slice(0, 32)).success).toBe(
      true,
    );
    expect(animationSelectionsSchema.safeParse(many).success).toBe(false);
  });
});
