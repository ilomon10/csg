/**
 * WebGL2 readback latency fix (M2-19; spec 003 REQ-PIX-033, AC-PIX-034.2).
 *
 * three r186 `WebGLBackend.copyTextureToBuffer` (behind
 * `readRenderTargetPixelsAsync`) issues `readPixels` into a pixel-pack buffer
 * and then waits on a fence with `WebGLUtils._clientWaitAsync`, which polls
 * `clientWaitSync` once per `requestAnimationFrame`. Every readback therefore
 * costs at least one display frame (~16.7 ms at 60 Hz), and stalls entirely
 * in a hidden tab where rAF is paused. Export reads one cell per frame, so the
 * P-07 export was bounded by the display rate on WebGL2 (measured 15.9 ms per
 * readback on the reference GPU).
 *
 * {@link installFenceWait} replaces that one method on a renderer's WebGL2
 * backend with a poll that yields through a `MessageChannel` task (no rAF, no
 * timer clamping), then falls back to `setTimeout(0)` after
 * {@link FAST_POLLS} polls so a long GPU job does not spin the event loop.
 * The bytes read are unchanged: only when the wait ends changes, never what
 * `getBufferSubData` copies (the fence still has to signal first).
 *
 * The method is an internal of the pinned three version; a missing method
 * leaves the renderer untouched (the rAF wait still works, just slower).
 */

/** Message-channel polls before falling back to `setTimeout(0)` polls. */
export const FAST_POLLS = 256;

/** The parts of three's WebGL2 backend this module touches. */
interface WebGLBackendLike {
  readonly gl?: WebGL2RenderingContext;
  readonly utils?: {_clientWaitAsync?: () => Promise<void>};
}

/** Marks a patched `utils` object. */
const PATCHED = Symbol.for('csg.fenceWait');

/** Resolves on the next task (message channel: neither rAF-bound nor clamped). */
function nextTask(port: {
  post(): void;
  wait: Promise<void> | null;
  resolve: (() => void) | null;
}): Promise<void> {
  port.wait = new Promise<void>(resolve => {
    port.resolve = resolve;
  });
  port.post();
  return port.wait;
}

/**
 * Creates the fence wait for a WebGL2 context: flush, then poll
 * `clientWaitSync(sync, 0, 0)` once per task until the fence signals.
 *
 * @param gl The WebGL2 context of the backend.
 * @returns A function with the contract of three's `_clientWaitAsync`
 *   (resolves when the GPU passed the fence, rejects on `WAIT_FAILED`).
 */
export function createFenceWait(
  gl: WebGL2RenderingContext,
): () => Promise<void> {
  const channel = new MessageChannel();
  const port = {
    wait: null as Promise<void> | null,
    resolve: null as (() => void) | null,
    post: () => channel.port2.postMessage(null),
  };
  channel.port1.onmessage = () => {
    const resolve = port.resolve;
    port.resolve = null;
    resolve?.();
  };
  const timeout = (): Promise<void> =>
    new Promise<void>(resolve => setTimeout(resolve, 0));

  return async () => {
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (sync === null) throw new Error('fenceSync failed');
    gl.flush();
    try {
      for (let polls = 0; ; polls++) {
        // Without SYNC_FLUSH_COMMANDS_BIT: the flush above already submitted.
        const res = gl.clientWaitSync(sync, 0, 0);
        if (res === gl.WAIT_FAILED) throw new Error('clientWaitSync failed');
        if (res !== gl.TIMEOUT_EXPIRED) return;
        // Readbacks are serialized by the caller (one at a time per renderer).
        await (polls < FAST_POLLS && port.resolve === null
          ? nextTask(port)
          : timeout());
      }
    } finally {
      gl.deleteSync(sync);
    }
  };
}

/**
 * Replaces the rAF-polled fence wait of a three r186 WebGL2 backend with
 * {@link createFenceWait}. Idempotent; a no-op for WebGPU backends or when
 * the internal method is missing (three upgrade).
 *
 * @param backend `renderer.backend` of an initialized `WebGPURenderer`.
 * @returns Whether the backend now uses the task-polled wait.
 */
export function installFenceWait(backend: unknown): boolean {
  const b = backend as WebGLBackendLike;
  const utils = b.utils as
    ({_clientWaitAsync?: () => Promise<void>} & {[PATCHED]?: true}) | undefined;
  if (b.gl === undefined || utils === undefined) return false;
  if (utils[PATCHED] === true) return true;
  if (typeof utils._clientWaitAsync !== 'function') return false;
  utils._clientWaitAsync = createFenceWait(b.gl);
  utils[PATCHED] = true;
  return true;
}
