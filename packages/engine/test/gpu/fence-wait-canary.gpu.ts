/**
 * Canary for the three r186 internals behind `installFenceWait` (M2-19, review L2): on the real
 * WebGL2 renderer the patch must succeed, so a three upgrade that renames `utils._clientWaitAsync`
 * fails here instead of silently losing the fast readback. WebGPU has no fence wait.
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {installFenceWait} from '../../src/pipeline/webgl-fence-wait';
import {createGpuHarness, currentBackend} from './harness';
import type {GpuHarness} from './harness';

describe(`fence wait canary (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(8, 8);
  });
  afterAll(() => h?.dispose());

  it.runIf(currentBackend() === 'webgl2')(
    'REQ-PIX-021: installFenceWait succeeds on the real r186 WebGL2 backend and is idempotent',
    () => {
      const result = installFenceWait(h.renderer.backend) as
        boolean | {installed: boolean};
      expect(typeof result === 'boolean' ? result : result.installed).toBe(
        true,
      );
      const again = installFenceWait(h.renderer.backend) as
        boolean | {installed: boolean};
      expect(typeof again === 'boolean' ? again : again.installed).toBe(true);
    },
  );
});
