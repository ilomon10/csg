/**
 * Renderer backend creation (spec 000 REQ-GEN-001/002, spec 003 REQ-PIX-026,
 * architecture 4.4): `WebGPURenderer` from `three/webgpu`, WebGPU first and the
 * WebGL2 backend when WebGPU is unavailable; neither yields
 * `PIX_BACKEND_UNAVAILABLE`.
 */
import {WebGPURenderer} from 'three/webgpu';
import type {EngineError, Result} from '../contracts/errors';
import type {RendererBackend} from '../contracts/renderer';

/** Parameters the engine passes to the renderer constructor. */
export interface RendererParameters {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Use the WebGL2 backend even when WebGPU is available. */
  readonly forceWebGL: boolean;
  /** Always false: no MSAA (P-05). */
  readonly antialias: false;
  /** Transparent default framebuffer. */
  readonly alpha: true;
}

/** The part of `WebGPURenderer` backend creation depends on (injectable for tests). */
export interface InitializableRenderer {
  /**
   * Backend in use after `init()` (three swaps it on fallback); carries
   * `isWebGPUBackend` or `isWebGLBackend`.
   */
  readonly backend: object;
  init(): Promise<unknown>;
  dispose(): void;
}

/** Creates a renderer; default `new WebGPURenderer(parameters)`. */
export type RendererFactory<R extends InitializableRenderer> = (
  parameters: RendererParameters,
) => R;

/** A created and initialized renderer with the backend it runs on. */
export interface CreatedBackend<R extends InitializableRenderer> {
  readonly renderer: R;
  /** `webgpu` or `webgl2` (REQ-GEN-002). */
  readonly backend: RendererBackend;
}

/**
 * The backend an initialized renderer runs on. three's `WebGPURenderer` swaps
 * `renderer.backend` to its WebGL2 backend when the WebGPU adapter or device
 * request fails (AC-GEN-001.2 edge case), so this must be read after `init()`.
 *
 * @param renderer An initialized renderer.
 * @returns `webgpu` or `webgl2`.
 */
export function backendOf(renderer: InitializableRenderer): RendererBackend {
  const flags = renderer.backend as {readonly isWebGPUBackend?: unknown};
  return flags.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}

const DEFAULT_FACTORY: RendererFactory<WebGPURenderer> = parameters =>
  new WebGPURenderer({...parameters});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates and initializes the renderer. Order:
 * 1. With `forceWebGL`, only the WebGL2 backend is tried.
 * 2. Otherwise a WebGPU renderer; three falls back to WebGL2 inside `init()`
 *    when WebGPU is unavailable.
 * 3. If that still fails (constructor or init throws), a renderer with
 *    `forceWebGL: true` is tried.
 * 4. If every attempt fails: `PIX_BACKEND_UNAVAILABLE` with the messages.
 *
 * Renderers whose `init()` failed are disposed.
 *
 * @param canvas Target canvas.
 * @param options `forceWebGL` and an optional factory (tests).
 * @returns The renderer and its backend, or `PIX_BACKEND_UNAVAILABLE`.
 */
export async function createRendererBackend<
  R extends InitializableRenderer = WebGPURenderer,
>(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: {
    readonly forceWebGL?: boolean;
    readonly factory?: RendererFactory<R>;
  } = {},
): Promise<Result<CreatedBackend<R>, EngineError>> {
  const factory = (options.factory ??
    (DEFAULT_FACTORY as unknown as RendererFactory<R>)) as RendererFactory<R>;
  const attempts: boolean[] =
    options.forceWebGL === true ? [true] : [false, true];
  const errors: string[] = [];
  for (const forceWebGL of attempts) {
    let renderer: R | undefined;
    try {
      renderer = factory({canvas, forceWebGL, antialias: false, alpha: true});
      await renderer.init();
      return {ok: true, value: {renderer, backend: backendOf(renderer)}};
    } catch (error) {
      errors.push(`${forceWebGL ? 'webgl2' : 'webgpu'}: ${describe(error)}`);
      try {
        renderer?.dispose();
      } catch {
        // A half-initialized renderer may fail to dispose; nothing else to free.
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'PIX_BACKEND_UNAVAILABLE',
      message: `neither WebGPU nor WebGL2 is available (${errors.join('; ')})`,
      details: {attempts: errors},
    },
  };
}
