import {describe, expect, it, vi} from 'vitest';
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

  it('REQ-PIX-033: installs on a WebGL2 backend once (reference-counted); leaves WebGPU backends alone', () => {
    const {gl} = fakeGl(0);
    const original = () => Promise.resolve();
    const backend = {gl, utils: {_clientWaitAsync: original}};
    const first = installFenceWait(backend);
    expect(first.installed).toBe(true);
    const patched = backend.utils._clientWaitAsync;
    expect(patched).not.toBe(original);
    const again = installFenceWait(backend);
    expect(again.installed).toBe(true);
    expect(backend.utils._clientWaitAsync).toBe(patched);
    again.dispose(); // another install still uses it: keeps the patch
    again.dispose(); // idempotent: does not release the first install
    expect(backend.utils._clientWaitAsync).toBe(patched);
    first.dispose(); // last user: closes the channel, keeps a timer-polled wait
    expect(backend.utils._clientWaitAsync).toBe(patched);
    expect(installFenceWait({device: {}}).installed).toBe(false);
  });

  it('REQ-PIX-033 / review L2: dispose closes the message channel and never restores the rAF wait', async () => {
    const closed: number[] = [];
    const realChannel = globalThis.MessageChannel;
    class SpyChannel extends realChannel {
      constructor() {
        super();
        for (const port of [this.port1, this.port2]) {
          const close = port.close.bind(port);
          port.close = () => {
            closed.push(1);
            close();
          };
        }
      }
    }
    vi.stubGlobal('MessageChannel', SpyChannel);
    try {
      const {gl} = fakeGl(3);
      const original = () => Promise.resolve();
      const backend = {gl, utils: {_clientWaitAsync: original}};
      const install = installFenceWait(backend);
      await backend.utils._clientWaitAsync();
      install.dispose();
      expect(closed).toHaveLength(2);
      const closedWait = backend.utils._clientWaitAsync;
      expect(closedWait).not.toBe(original);
      await closedWait(); // still resolves (timer polls)
      install.dispose(); // idempotent
      expect(closed).toHaveLength(2);
      // Re-installable after dispose.
      const next = installFenceWait(backend);
      expect(next.installed).toBe(true);
      expect(backend.utils._clientWaitAsync).not.toBe(closedWait);
      next.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('REQ-PIX-033 / review L2: a closed wait still resolves (timer polls), also when closed mid-wait', async () => {
    const {gl, calls} = fakeGl(5);
    const wait = createFenceWait(gl);
    const pending = wait();
    wait.close();
    await pending;
    await wait();
    expect(calls.deleted).toBe(2);
  });

  it('REQ-PIX-033 / review L2: a WebGL2 backend without the internal method warns once and is untouched', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const {gl} = fakeGl(0);
      const utils = {};
      expect(installFenceWait({gl, utils}).installed).toBe(false);
      expect(installFenceWait({gl}).installed).toBe(false);
      expect(utils).toEqual({});
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
