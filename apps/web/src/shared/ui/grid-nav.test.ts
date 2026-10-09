import {describe, expect, it} from 'vitest';
import {nextIndex} from './grid-nav';

describe('nextIndex', () => {
  it('AC-UX-061.1: Down moves one row in a grid of 4 columns and stops at the ends', () => {
    expect(nextIndex('ArrowDown', 1, {count: 12, columns: 4})).toBe(5);
    expect(nextIndex('ArrowRight', 5, {count: 12, columns: 4})).toBe(6);
    expect(nextIndex('ArrowDown', 9, {count: 12, columns: 4})).toBeNull();
    expect(nextIndex('ArrowLeft', 0, {count: 12, columns: 4})).toBeNull();
    expect(nextIndex('Home', 7, {count: 12, columns: 4})).toBe(0);
    expect(nextIndex('End', 7, {count: 12, columns: 4})).toBe(11);
  });
  it('AC-UX-004.1: wraps in lists and respects the axis', () => {
    expect(
      nextIndex('ArrowRight', 4, {count: 5, wrap: true, axis: 'horizontal'}),
    ).toBe(0);
    expect(
      nextIndex('ArrowLeft', 0, {count: 5, wrap: true, axis: 'list'}),
    ).toBe(4);
    expect(
      nextIndex('ArrowDown', 0, {count: 5, axis: 'horizontal'}),
    ).toBeNull();
    expect(nextIndex('ArrowDown', 0, {count: 5, axis: 'list'})).toBe(1);
  });
});
