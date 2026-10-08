import {describe, expect, it} from 'vitest';
import {DEFAULT_SET} from './default-set.js';

describe('AC-AST-016.2 default set', () => {
  it('lists the default character parts and the idle and walk clips (REQ-CMP-036)', () => {
    const ids = DEFAULT_SET.map(r => r.id);
    expect(ids).toContain('superhero-m');
    expect(ids).toEqual(expect.arrayContaining(['idle', 'walk']));
    expect(DEFAULT_SET.filter(r => r.kind === 'part')).toHaveLength(7);
  });
});
