/**
 * Renderer contracts (architecture 3.6, spec 001 REQ-CMP-043/044, spec 003
 * REQ-PIX-001/030/031/034, spec 005 REQ-EXP-001/024 render side, spec 009
 * REQ-UX-003 engine part). Type-only.
 */
import type {
  CharacterSpec,
  CharacterSpecies,
  CharacterStyle,
  ClipRef,
} from '@csg/parts-schema';
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

/**
 * Viewport mode (spec 009 REQ-UX-003): `pixel` shows the low-res pipeline cell
 * (drawing buffer = cell, integer CSS upscale); `3d` shows an orbitable
 * full-resolution view of the same scene (drawing buffer = viewport device
 * pixels).
 */
export type ViewMode = 'pixel' | '3d';

/** Notice codes: reported, never an error (spec 001 REQ-CMP-043). */
export type EngineNoticeCode = 'CMP_STYLE_UNSUPPORTED';

/**
 * A persistent, non-blocking notice (REQ-CMP-043): the stored pair is
 * unavailable and the preview shows the fallback pair.
 */
export interface StyleUnsupportedNotice {
  readonly code: 'CMP_STYLE_UNSUPPORTED';
  /** "<label> is coming soon. Showing <fallback label> for now." (REQ-CMP-043). */
  readonly message: string;
  /** Stored style and species (kept unchanged). */
  readonly style: CharacterStyle;
  readonly species: CharacterSpecies;
  /** The pair rendered instead. */
  readonly fallback: {
    readonly style: CharacterStyle;
    readonly species: CharacterSpecies;
  };
  /** Label of the unavailable value(s), e.g. `Stickman` or `Monster`. */
  readonly label: string;
  /** Label of the replacement value(s), e.g. `Realistic` or `Human`. */
  readonly fallbackLabel: string;
}

/** Every notice the renderer raises. */
export type EngineNotice = StyleUnsupportedNotice;

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
  /**
   * Called when a notice is raised (`active: true`) and when it clears
   * (`active: false`), synchronously within the `setCharacter` call that
   * changes it, so it clears before the next rendered frame (AC-CMP-043.3).
   * Never called after `dispose()`.
   */
  readonly onNotice?: (notice: EngineNotice, active: boolean) => void;
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
  /**
   * Diff-based (REQ-CMP-033); on failure the previous character is kept. An
   * unavailable (style, species) pair renders with the fallback pair and
   * raises `CMP_STYLE_UNSUPPORTED` as a notice, never as an error
   * (REQ-CMP-043); the stored values are not changed.
   */
  setCharacter(spec: CharacterSpec): Promise<Result<void, EngineError>>;
  /** Active notices (REQ-CMP-043), in raise order. */
  readonly notices: readonly EngineNotice[];
  /** The current view mode (default `pixel`). */
  readonly viewMode: ViewMode;
  /**
   * Switches the view (REQ-UX-003). `3d` keeps the character, clip, time and
   * direction, and draws through a perspective orbit camera at the viewport's
   * device resolution (see `resize`); `pixel` restores the cell-sized drawing
   * buffer. Export is unaffected (it always renders the pixel pipeline).
   */
  setViewMode(mode: ViewMode): void;
  /**
   * Turns the 3D orbit camera around its target: yaw about +Y, pitch
   * clamped to ±85 degrees. Deterministic (no time); ignored in `pixel` mode
   * only in the sense that it draws nothing until `3d` is shown.
   */
  orbit(dYawDeg: number, dPitchDeg: number): void;
  /**
   * Frames the character in the 3D view (REQ-UX-003 "Frame character"):
   * target = centre of the character's current bounds, distance so the
   * bounding sphere fits; yaw and pitch are kept. Deterministic.
   */
  frameCharacter(): void;
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
   * While the stored (style, species) pair is unavailable it returns
   * `ok: false` with `CMP_STYLE_UNSUPPORTED` and renders nothing (REQ-CMP-044).
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
