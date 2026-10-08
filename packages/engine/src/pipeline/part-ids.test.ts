import {describe, expect, it} from 'vitest';
import {partIdFor} from './part-ids';

const registry = {
  slots: [
    {id: 'prop-main-hand', order: 14},
    {id: 'body', order: 0},
    {id: 'hair', order: 1},
    {id: 'arms', order: 7},
  ],
};

describe('AC-PIX-014.1: part IDs are deterministic', () => {
  it('body is 1, others follow registry order, independent of input order', () => {
    expect(partIdFor('body', registry)).toBe(1);
    expect(partIdFor('hair', registry)).toBe(2);
    expect(partIdFor('arms', registry)).toBe(3);
    expect(partIdFor('prop-main-hand', registry)).toBe(4);
    const shuffled = {slots: [...registry.slots].reverse()};
    for (const s of registry.slots)
      expect(partIdFor(s.id, shuffled)).toBe(partIdFor(s.id, registry));
  });
  it('rejects unknown slots', () => {
    expect(() => partIdFor('nope', registry)).toThrow();
  });
});
