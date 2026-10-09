/**
 * Renderer contracts (architecture 3.6, spec 003 REQ-PIX-001/030/031/034,
 * spec 005 REQ-EXP-001/024 render side). Type-only.
 */
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';
import type {EngineError, Result} from './errors';
import type {
  PreparedFrames,
  PrepareFramesOptions,
  RenderFramesOptions,
  RenderedFrame,
  RenderSettings,
} from './pipeline';
import type {AssetRegistry} from './registry';

/** Rendering backend in use. */
export type RendererBackend = 'webgpu' | 'webgl2';

/** Options of {@link CreateCharacterRenderer}. */
export interface RendererOptions {
  /** Force the WebGL2 backend (tests, Firefox/Linux workaround). */
  readonly forceWebGL?: boolean;
  readonly registry: AssetRegistry;
  /**
   * @deprecated Ignored since M2: the drawing buffer is the cell size and the
   * upscale comes from `resize(cssW, cssH, dpr)` (REQ-PIX-031).
   */
  readonly previewScale?: number;
  /** Initial render settings (validated); default `defaultRenderSettings()`. */
  readonly settings?: RenderSettings;
}

/**
 * The character renderer (architecture 3.6): M1 preview controls plus the M2
 * pixel pipeline (spec 003). Preview and export share one pipeline, so the
 * preview cell equals the exported frame for the same settings, clip, frame
 * and direction (REQ-PIX-030).
 */
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
  /**
   * Validates (`parseRenderSettings`) and applies render settings. Uniform-only
   * changes write uniforms and never recompile (REQ-PIX-034); structural
   * changes rebuild the post chain; a resolution change resizes the cell; a
   * framing change (camera, directions, animations, outer outline width)
   * recomputes the preview framing. Invalid settings fail with the first
   * issue's `PIX_*` code and `details.issues[]`; the previous settings stay
   * active (AC-PIX-001.2).
   */
  setRenderSettings(
    settings: RenderSettings,
  ): Promise<Result<void, EngineError>>;
  /**
   * Phase 1 of an export: plan, union bounds and the one fixed framing
   * (REQ-PIX-007), with `PIX_FRAMING_CLIPPED` / `ANM_FIXED_FPS_CLAMPED`
   * warnings. Takes the renderer exclusively (the preview pauses) and
   * restores the preview clip afterwards.
   *
   * @param settings Export settings; default the applied settings.
   * @param options Abort signal (`EXP_CANCELLED`).
   */
  prepareFrames(
    settings?: RenderSettings,
    options?: PrepareFramesOptions,
  ): Promise<Result<PreparedFrames, EngineError>>;
  /**
   * Phase 2 of an export: renders `prepared` in REQ-EXP-001 order through the
   * preview's pixel pipeline. Exclusive for the whole iteration (D5): the
   * preview pauses, and settings, clip, framing and the loop are restored when
   * the iteration ends, is aborted (`EXP_CANCELLED`, thrown as
   * `FrameSamplerError`) or is left early (`break` / `return()`). Always
   * finish or `return()` the iterator: an abandoned iterator keeps the lock.
   */
  renderFrames(
    prepared: PreparedFrames,
    options?: RenderFramesOptions,
  ): AsyncIterable<RenderedFrame>;
  dispose(): void;
}

/**
 * Preview layout returned by `resize` (REQ-PIX-031): the drawing buffer stays
 * the cell size and the host shows the canvas at `cssW` x `cssH` CSS pixels
 * with `image-rendering: pixelated`.
 */
export interface PreviewResize {
  /** Cell (drawing buffer) width in pixels. */
  readonly cellW: number;
  /** Cell (drawing buffer) height in pixels. */
  readonly cellH: number;
  /**
   * Device pixels per sprite pixel: the largest integer at which the cell
   * fits the viewport (at least 1).
   */
  readonly scale: number;
  /** CSS width: `cellW * scale / dpr`. */
  readonly cssW: number;
  /** CSS height: `cellH * scale / dpr`. */
  readonly cssH: number;
}

/**
 * Creates a renderer on a canvas. WebGPU first, WebGL2 when WebGPU is
 * unavailable; neither yields `PIX_BACKEND_UNAVAILABLE`.
 */
export type CreateCharacterRenderer = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: RendererOptions,
) => Promise<Result<CharacterRenderer, EngineError>>;
