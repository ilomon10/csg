import {describe, expect, it} from 'vitest';
import {directionLabels, facingYawRad, stageYawRad} from './directions';

const deg = (r: number) => (r * 180) / Math.PI;

describe('directions', () => {
  it('AC-PIX-005.1/.2: labels for 8, 4 and 2', () => {
    expect(directionLabels(8)).toEqual([
      'e',
      'ne',
      'n',
      'nw',
      'w',
      'sw',
      's',
      'se',
    ]);
    expect(directionLabels(4)).toEqual(['e', 'n', 'w', 's']);
    expect(directionLabels(2)).toEqual(['e', 'w']);
  });
  it('AC-PIX-005.3: single facing s has yaw 270 and label s', () => {
    expect(directionLabels(1, 's')).toEqual(['s']);
    expect(deg(facingYawRad('s'))).toBeCloseTo(270, 9);
    expect(deg(stageYawRad('s'))).toBeCloseTo(0, 9);
    expect(deg(stageYawRad('e'))).toBeCloseTo(90, 9);
  });
  it('AC-PIX-005.4: 3 and 6 directions are rejected', () => {
    expect(() => directionLabels(3)).toThrow();
    expect(() => directionLabels(6)).toThrow();
  });
});
