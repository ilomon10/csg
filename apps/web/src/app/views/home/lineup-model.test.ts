import {describe, expect, it} from 'vitest';
import type {CharacterPreset} from '@csg/parts-schema';
import type {ProjectListMeta} from '../../../shared/persistence';
import {
  lineupScale,
  neighbourScale,
  orderLineup,
  pickUniform,
  rowOffset,
  slotWidth,
  spriteOpacity,
} from './lineup-model';

const meta = (id: string, edited: number, pinned = false): ProjectListMeta => ({
  projectId: id,
  name: id,
  lastEditedAt: edited,
  pinned,
});
const preset = (id: string): CharacterPreset =>
  ({id, name: id.toUpperCase()}) as CharacterPreset;

describe('lineup model', () => {
  it('AC-UX-072.1: pinned first, then by recent edit, then presets', () => {
    const order = orderLineup(
      [meta('A', 3), meta('B', 5, true), meta('C', 4)],
      [preset('p1'), preset('p2')],
    );
    expect(order.map(i => i.id)).toEqual([
      'B',
      'C',
      'A',
      'preset:p1',
      'preset:p2',
    ]);
  });

  it('AC-UX-073.1: a 600 px lineup selects 4x and its neighbours 3x', () => {
    expect(lineupScale(600)).toBe(4);
    expect(lineupScale(100)).toBe(2);
    expect(neighbourScale(4)).toBe(3);
    expect(neighbourScale(2)).toBe(1);
    expect(spriteOpacity(0)).toBe(1);
    expect(spriteOpacity(-1)).toBe(0.7);
    expect(spriteOpacity(3)).toBe(0.45);
  });

  it('AC-UX-073.1: the selected slot centre is the stage centre within 1 px', () => {
    for (const w of [900, 1023, 1440]) {
      const slot = slotWidth(4);
      const centre = rowOffset(w, slot, 3) + (3 + 0.5) * slot;
      expect(Math.abs(centre - w / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('AC-UX-077.1: 600 draws over 6 presets pick each exactly 100 times', () => {
    const counts = new Array<number>(6).fill(0);
    let n = 0;
    const source = () => n++;
    for (let i = 0; i < 600; i++) counts[pickUniform(6, source)]! += 1;
    expect(counts).toEqual([100, 100, 100, 100, 100, 100]);
  });
});
