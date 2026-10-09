import {describe, expect, it} from 'vitest';
import {hexToHsv, hsvToHex, isHex6} from './color-math';

describe('color math', () => {
  it('AC-CMP-016.2: only #rrggbb is a valid hex', () => {
    expect(isHex6('#12G')).toBe(false);
    expect(isHex6('123456')).toBe(false);
    expect(isHex6('#ABCDEF')).toBe(true);
  });

  it('AC-CMP-016.1: HSV round-trips every 8-bit gray and primary exactly', () => {
    for (const hex of [
      '#000000',
      '#ffffff',
      '#808080',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#a0c4ff',
      '#7a4a26',
    ]) {
      const hsv = hexToHsv(hex);
      expect(hsv && hsvToHex(hsv)).toBe(hex);
    }
    expect(hexToHsv('nope')).toBeNull();
  });
});
