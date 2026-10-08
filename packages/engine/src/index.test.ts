import {describe, expect, it} from 'vitest';
import {createNamedNode} from './index';

describe('engine', () => {
  it('GEN smoke: creates a named node', () => {
    expect(createNamedNode('root').name).toBe('root');
  });
});
