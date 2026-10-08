/**
 * Renderer contracts (architecture 3.6, spec 003). Type-only. M1 implements the
 * backend, `setCharacter`, `play`, `pause`, `seek`, `setDirection` and
 * `dispose`; the rest throws `Error('not implemented (M2)')`.
 */
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';
import type {RenderTarget} from 'three/webgpu';
import type {EngineError, Result} from './errors';
import type {Framing, RenderedFrame, RenderSettings} from './pipeline';
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
 * M2 additions to {@link CharacterRenderer} (plan 2.7). Declared separately so
 * the M1 implementation keeps compiling; the M2 renderer task merges these
 * members into `CharacterRenderer`.
 */
export interface CharacterRendererM2 {
  /**
   * Zod-validated (parts-schema). Diffs: uniforms only, rebuild post, rebuild
   * materials, resize, reframe. Failures carry `PIX_*` codes and
   * `details.issues[]`.
   */
  setRenderSettings(
    settings: RenderSettings,
  ): Promise<Result<void, EngineError>>;
  /**
   * Union bounds and framing for the export; also yields `pivotPx` for
   * `ExportContext` and clipping warnings.
   */
  prepareFrames(
    settings?: RenderSettings,
    signal?: AbortSignal,
  ): Promise<Result<Framing, EngineError>>;
  /** Deterministic export sampling (architecture 3.6 shape). */
  renderFrames(
    settings?: RenderSettings,
    signal?: AbortSignal,
  ): AsyncIterable<RenderedFrame>;
}

/** Result of the M2 {@link EngineRendererM2.resize}. */
export interface PreviewResize {
  /** Largest integer device scale that fits (REQ-PIX-031). */
  readonly deviceScale: number;
  readonly cssW: number;
  readonly cssH: number;
}

/**
 * M2 changes to `EngineCharacterRenderer` (plan 2.7). `resize` replaces the M1
 * `resize(width, height): void` when the M2 renderer lands: this is the only
 * breaking change, and its callers are the preview viewport in `apps/web`.
 */
export interface EngineRendererM2 {
  /** Drawing buffer stays W x H; returns the CSS size for the largest integer device scale. */
  resize(
    viewportCssW: number,
    viewportCssH: number,
    dpr: number,
  ): PreviewResize;
  /** AC-PIX-030.1 reads the preview cell from here. */
  readonly cellTarget: RenderTarget;
  /** AC-PIX-034.1 spy (incremented where `needsUpdate` is set). */
  readonly pipelineStats: {readonly rebuilds: number};
}

/**
 * Creates a renderer on a canvas. WebGPU first, WebGL2 when WebGPU is
 * unavailable; neither yields `PIX_BACKEND_UNAVAILABLE`.
 */
export type CreateCharacterRenderer = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: RendererOptions,
) => Promise<Result<CharacterRenderer, EngineError>>;
