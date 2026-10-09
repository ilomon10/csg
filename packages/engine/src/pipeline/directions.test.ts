import {describe, expect, it} from 'vitest';
import {Vector3} from 'three';
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
  it('AC-PIX-005.5: a +Z-facing model at index 0 (e) faces screen-right after a 90 degree turn about +Y; at index 6 (s) it faces the camera after 0 degrees', () => {
    // Side-view camera on +Z looking down -Z: view space equals world space
    // (x right, y up, +z toward the camera).
    const forward = (label: 'e' | 's') =>
      new Vector3(0, 0, 1).applyAxisAngle(
        new Vector3(0, 1, 0),
        stageYawRad(label),
      );
    expect(deg(stageYawRad('e'))).toBeCloseTo(90, 6);
    expect(deg(stageYawRad('s'))).toBeCloseTo(0, 6);
    const e = forward('e');
    expect(e.x).toBeCloseTo(1, 6);
    expect(e.y).toBeCloseTo(0, 6);
    expect(e.z).toBeCloseTo(0, 6);
    const south = forward('s');
    expect(south.x).toBeCloseTo(0, 6);
    expect(south.y).toBeCloseTo(0, 6);
    expect(south.z).toBeCloseTo(1, 6);
  });
});
