import {describe, expect, it} from 'vitest';
import {TSL_COMPILER_VERSION} from './index';

describe('shader-graph/tsl', () => {
  it('GEN smoke: exposes the compiler entry point', () => {
    expect(TSL_COMPILER_VERSION).toBe(0);
  });
});
