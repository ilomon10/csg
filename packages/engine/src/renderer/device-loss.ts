/**
 * GPU device-loss detection (spec 003 REQ-PIX-036, spec 009 REQ-UX-046): the
 * WebGPU `GPUDevice.lost` promise and the WebGL2 `webglcontextlost` canvas
 * event, reported once as `PIX_DEVICE_LOST`. The engine never restores a lost
 * device; the caller recreates the renderer.
 */
import type {DeviceLostDetails, EngineError} from '../contracts/errors';
import type {RendererBackend} from '../contracts/renderer';

/** The GPU device or WebGL2 context was lost (spec 003 REQ-PIX-036). */
export const PIX_DEVICE_LOST = 'PIX_DEVICE_LOST';

/** Minimal `GPUDeviceLostInfo` shape (no `@webgpu/types` dependency). */
interface DeviceLostInfoLike {
  readonly reason?: unknown;
  readonly message?: unknown;
}

/** Minimal event-target shape of a canvas (`HTMLCanvasElement` or `OffscreenCanvas`). */
interface CanvasEventsLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

function hasEvents(value: unknown): value is CanvasEventsLike {
  const target = value as Partial<CanvasEventsLike> | null;
  return (
    typeof target?.addEventListener === 'function' &&
    typeof target.removeEventListener === 'function'
  );
}

/** The `device.lost` promise of a WebGPU backend, or `null`. */
function deviceLostOf(backend: object): Promise<DeviceLostInfoLike> | null {
  const device = (backend as {readonly device?: unknown}).device;
  if (typeof device !== 'object' || device === null) return null;
  const lost = (device as {readonly lost?: unknown}).lost;
  return typeof (lost as {readonly then?: unknown} | null)?.then === 'function'
    ? (lost as Promise<DeviceLostInfoLike>)
    : null;
}

/** Inputs of {@link watchDeviceLoss}. */
export interface WatchDeviceLossOptions {
  /** The initialized renderer's backend object (`renderer.backend`). */
  readonly rendererBackend: object;
  /** Which backend it is (from `backendOf`). */
  readonly backend: RendererBackend;
  /** The canvas the renderer draws to (WebGL2 context-loss events). */
  readonly canvas: unknown;
  /** Called at most once, with a `PIX_DEVICE_LOST` error. */
  readonly onLost: (error: EngineError) => void;
}

/**
 * Watches for device loss. WebGPU: `device.lost`; a loss with reason
 * `destroyed` (the renderer's own `dispose()`) is not reported. WebGL2: the
 * canvas `webglcontextlost` event, without `preventDefault()` (no restore is
 * attempted; the caller recreates the renderer).
 *
 * @param options Backend, canvas and the loss callback.
 * @returns A stop function; call it before disposing the renderer so the
 *   disposal's own context loss is not reported. Idempotent.
 */
export function watchDeviceLoss(options: WatchDeviceLossOptions): () => void {
  let active = true;
  const report = (reason: string | null, message: string): void => {
    if (!active) return;
    active = false;
    const details: DeviceLostDetails = {backend: options.backend, reason};
    options.onLost({
      code: PIX_DEVICE_LOST,
      message: `${options.backend === 'webgpu' ? 'WebGPU device' : 'WebGL2 context'} lost: ${message}`,
      details: {...details},
    });
  };

  if (options.backend === 'webgpu') {
    const lost = deviceLostOf(options.rendererBackend);
    lost?.then(
      info => {
        const reason = typeof info.reason === 'string' ? info.reason : null;
        if (reason === 'destroyed') return;
        const message =
          typeof info.message === 'string' && info.message !== ''
            ? info.message
            : 'unknown reason';
        report(reason, message);
      },
      () => {
        // `lost` never rejects per the WebGPU spec; nothing to report.
      },
    );
    return () => {
      active = false;
    };
  }

  const canvas = options.canvas;
  if (!hasEvents(canvas)) {
    return () => {
      active = false;
    };
  }
  const onContextLost = (event: Event): void => {
    const status = (event as {readonly statusMessage?: unknown}).statusMessage;
    report(
      null,
      typeof status === 'string' && status !== '' ? status : 'unknown reason',
    );
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  return () => {
    active = false;
    canvas.removeEventListener('webglcontextlost', onContextLost);
  };
}
