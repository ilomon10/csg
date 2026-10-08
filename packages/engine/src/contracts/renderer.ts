/**
 * Renderer contracts (architecture 3.6, spec 003). Type-only. M1 implements the
 * backend, `setCharacter`, `play`, `pause`, `seek`, `setDirection` and
 * `dispose`; the rest throws `Error('not implemented (M2)')`.
 */
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';
import type {EngineError, Result} from './errors';
import type {AssetRegistry} from './registry';

/** Rendering backend in use. */
export type RendererBackend = 'webgpu' | 'webgl2';

/** Options of {@link CreateCharacterRenderer}. */
export interface RendererOptions {
  /** Force the WebGL2 backend (tests, Firefox/Linux workaround). */
  readonly forceWebGL?: boolean;
  readonly registry: AssetRegistry;
  /** Display upscale for the preview canvas (integer). */
  readonly previewScale?: number;
}

/** The M1 subset of the character renderer. */
export interface CharacterRenderer {
  /** Backend actually in use: WebGPU, falling back to WebGL2. */
  readonly backend: RendererBackend;
  /** Diff-based (REQ-CMP-033); on failure the previous character is kept. */
  setCharacter(spec: CharacterSpec): Promise<Result<void, EngineError>>;
  /** Interactive preview loop; wall-clock time is allowed here only (REQ-ANM-018). */
  play(clipId: ClipRef): void;
  pause(): void;
  seek(timeSec: number): void;
  /** Yaw is `index * 45` degrees by `DIRECTION_ORDER`. */
  setDirection(index: number): void;
  dispose(): void;
}

/**
 * Creates a renderer on a canvas. WebGPU first, WebGL2 when WebGPU is
 * unavailable; neither yields `PIX_BACKEND_UNAVAILABLE`.
 */
export type CreateCharacterRenderer = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: RendererOptions,
) => Promise<Result<CharacterRenderer, EngineError>>;
