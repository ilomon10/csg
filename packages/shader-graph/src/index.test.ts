import {describe, expect, it} from 'vitest';
import {SHADER_GRAPH_FORMAT_VERSION, socketTypeSchema} from './index';

describe('shader-graph', () => {
  it('GEN smoke: validates socket types', () => {
    expect(socketTypeSchema.safeParse('vec3').success).toBe(true);
    expect(socketTypeSchema.safeParse('matrix').success).toBe(false);
    expect(SHADER_GRAPH_FORMAT_VERSION).toBe(1);
  });
});
