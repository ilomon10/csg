/** Node unit tests of the golden command argument checks (review L6). */
import {describe, expect, it} from 'vitest';
import {assertBackend, assertGoldenDir} from './golden-commands.ts';

describe('golden command argument validation', () => {
  it('REQ-PIX-028: goldenDir is undefined or a relative path below test-results/', () => {
    expect(() => assertGoldenDir(undefined)).not.toThrow();
    expect(() => assertGoldenDir('test-results/x/y')).not.toThrow();
    for (const bad of [
      '',
      'packages/engine/test/goldens',
      'test-results/../src',
      'test-results/a/../../b',
      '/test-results/x',
      'test-results/a\\..\\b',
      'test-results/a\0b',
    ])
      expect(() => assertGoldenDir(bad), bad).toThrow();
  });

  it('REQ-PIX-028: backend is webgpu or webgl2 only', () => {
    expect(() => assertBackend('webgpu')).not.toThrow();
    expect(() => assertBackend('webgl2')).not.toThrow();
    for (const bad of ['', '../x', 'WebGPU', 'webgl'])
      expect(() => assertBackend(bad), bad).toThrow();
  });
});
