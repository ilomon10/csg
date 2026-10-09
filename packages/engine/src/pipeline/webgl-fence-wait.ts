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
 * leaves the renderer untouched (the rAF wait still works, just slower) and
 * warns once. The owner (`PixelPipeline`) closes the message channel on
 * dispose ({@link FenceWaitInstall.dispose}).
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
 * The fence wait of {@link createFenceWait}: call it like three's
 * `_clientWaitAsync`; {@link FenceWait.close} releases its message channel.
 */
export interface FenceWait {
  /** Resolves once the GPU passed a new fence; rejects on `WAIT_FAILED`. */
  (): Promise<void>;
  /**
   * Closes both message-channel ports (review L2). Idempotent. A wait still
   * polling finishes on `setTimeout(0)` polls; later waits poll that way too.
   */
  close(): void;
}

/**
 * Creates the fence wait for a WebGL2 context: flush, then poll
 * `clientWaitSync(sync, 0, 0)` once per task until the fence signals.
 *
 * @param gl The WebGL2 context of the backend.
 * @returns A function with the contract of three's `_clientWaitAsync`
 *   (resolves when the GPU passed the fence, rejects on `WAIT_FAILED`), plus
 *   `close()` for the message channel.
 */
export function createFenceWait(gl: WebGL2RenderingContext): FenceWait {
  const channel = new MessageChannel();
  let closed = false;
  const port = {
    wait: null as Promise<void> | null,
    resolve: null as (() => void) | null,
    post: () => channel.port2.postMessage(null),
  };
  const wake = (): void => {
    const resolve = port.resolve;
    port.resolve = null;
    resolve?.();
  };
  channel.port1.onmessage = wake;
  const timeout = (): Promise<void> =>
    new Promise<void>(resolve => setTimeout(resolve, 0));

  const wait = async (): Promise<void> => {
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
        await (!closed && polls < FAST_POLLS && port.resolve === null
          ? nextTask(port)
          : timeout());
      }
    } finally {
      gl.deleteSync(sync);
    }
  };
  return Object.assign(wait, {
    close(): void {
      if (closed) return;
      closed = true;
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      // A wait parked on the channel would never wake: wake it to poll again.
      wake();
    },
  });
}

/** Result of {@link installFenceWait}. */
export interface FenceWaitInstall {
  /** Whether the backend now uses the task-polled wait. */
  readonly installed: boolean;
  /**
   * Releases this install (call from the owner's `dispose`). Installs on one
   * backend are reference-counted: the last release closes the message
   * channel (review L2). The closed wait stays installed and polls with
   * `setTimeout(0)`, so a renderer that outlives its pipelines never falls
   * back to three's rAF-bound wait; the next install replaces it with a
   * fresh channel. Idempotent; a no-op when nothing was installed.
   */
  dispose(): void;
}

/** Patch state stored on a backend's `utils` object. */
interface PatchState {
  readonly wait: FenceWait;
  users: number;
}

/** Whether the "not installed" warning was printed (once per page). */
let warned = false;

const NOOP_INSTALL: FenceWaitInstall = {installed: false, dispose: () => {}};

/**
 * Replaces the rAF-polled fence wait of a three r186 WebGL2 backend with
 * {@link createFenceWait}. Idempotent and reference-counted: further calls
 * on a patched backend share the patch, and the last
 * {@link FenceWaitInstall.dispose} closes its channel. A no-op for WebGPU backends.
 * On a WebGL2 backend whose internal method is missing (three upgrade) it
 * leaves the renderer untouched and prints one `console.warn` per page:
 * readback still works, at the display rate (the canary GPU test fails on
 * such an upgrade).
 *
 * @param backend `renderer.backend` of an initialized `WebGPURenderer`.
 * @returns Whether the wait is installed, and how to release it.
 */
export function installFenceWait(backend: unknown): FenceWaitInstall {
  const b = backend as WebGLBackendLike;
  if (b.gl === undefined) return NOOP_INSTALL;
  const utils = b.utils as
    | ({_clientWaitAsync?: () => Promise<void>} & {[PATCHED]?: PatchState})
    | undefined;
  let state = utils?.[PATCHED];
  if (utils !== undefined && state === undefined) {
    if (typeof utils._clientWaitAsync === 'function') {
      state = {wait: createFenceWait(b.gl), users: 0};
      utils._clientWaitAsync = state.wait;
      utils[PATCHED] = state;
    }
  }
  if (utils === undefined || state === undefined) {
    if (!warned) {
      warned = true;
      console.warn(
        'csg: WebGL2 fence wait not installed (three internals changed); readback is limited to the display rate',
      );
    }
    return NOOP_INSTALL;
  }
  const patch = state;
  patch.users++;
  let released = false;
  return {
    installed: true,
    dispose(): void {
      if (released) return;
      released = true;
      if (--patch.users > 0) return;
      patch.wait.close();
      delete utils[PATCHED];
    },
  };
}
