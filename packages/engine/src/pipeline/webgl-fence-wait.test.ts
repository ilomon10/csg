import {describe, expect, it} from 'vitest';
import {
  FAST_POLLS,
  createFenceWait,
  installFenceWait,
} from './webgl-fence-wait';

const TIMEOUT_EXPIRED = 0x911b;
const CONDITION_SATISFIED = 0x911c;
const WAIT_FAILED = 0x911d;

/** A fake WebGL2 context whose fence signals after `pending` polls. */
function fakeGl(pending: number, fail = false) {
  const calls = {flush: 0, polls: 0, deleted: 0};
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    TIMEOUT_EXPIRED,
    CONDITION_SATISFIED,
    WAIT_FAILED,
    fenceSync: () => ({}),
    flush: () => {
      calls.flush++;
    },
    clientWaitSync: () => {
      calls.polls++;
      if (fail) return WAIT_FAILED;
      return calls.polls > pending ? CONDITION_SATISFIED : TIMEOUT_EXPIRED;
    },
    deleteSync: () => {
      calls.deleted++;
    },
  };
  return {gl: gl as unknown as WebGL2RenderingContext, calls};
}

describe('WebGL2 fence wait (M2-19)', () => {
  it('REQ-PIX-033: resolves once the fence signals, polling per task (no requestAnimationFrame)', async () => {
    expect(
      typeof (globalThis as {requestAnimationFrame?: unknown})
        .requestAnimationFrame,
    ).toBe('undefined');
    const {gl, calls} = fakeGl(5);
    await createFenceWait(gl)();
    expect(calls.flush).toBe(1);
    expect(calls.polls).toBe(6);
    expect(calls.deleted).toBe(1);
  });

  it('REQ-PIX-033: falls back to timer polls after the fast polls', async () => {
    const {gl, calls} = fakeGl(FAST_POLLS + 3);
    await createFenceWait(gl)();
    expect(calls.polls).toBe(FAST_POLLS + 4);
    expect(calls.deleted).toBe(1);
  });

  it('REQ-PIX-033: two concurrent waits both resolve', async () => {
    const {gl} = fakeGl(10);
    const wait = createFenceWait(gl);
    await Promise.all([wait(), wait()]);
  });

  it('REQ-PIX-033: rejects on WAIT_FAILED and deletes the sync', async () => {
    const {gl, calls} = fakeGl(0, true);
    await expect(createFenceWait(gl)()).rejects.toThrow('clientWaitSync');
    expect(calls.deleted).toBe(1);
  });

  it('REQ-PIX-033: installs on a WebGL2 backend once; leaves WebGPU and unknown backends alone', () => {
    const {gl} = fakeGl(0);
    const original = () => Promise.resolve();
    const backend = {gl, utils: {_clientWaitAsync: original}};
    expect(installFenceWait(backend)).toBe(true);
    const patched = backend.utils._clientWaitAsync;
    expect(patched).not.toBe(original);
    expect(installFenceWait(backend)).toBe(true);
    expect(backend.utils._clientWaitAsync).toBe(patched);
    expect(installFenceWait({device: {}})).toBe(false);
    expect(installFenceWait({gl, utils: {}})).toBe(false);
  });
});
