/**
 * Pixel pipeline contracts (architecture 3.6, spec 003, plan 2.4 to 2.7).
 * Type-only; the pure modules under `pipeline/` and `sampler/` implement them.
 */
import type {ClipRef, RenderSettings} from '@csg/parts-schema';
import type {EngineError, Result} from './errors';
import type {
  FrameLogEntry,
  FrameProgress,
  FrameSamplerTarget,
  FrameWarning,
  PreparedFrames,
  PrepareFramesOptions,
  RenderFramesOptions,
} from '../sampler/frame-sampler';

/** Sampler types (implemented in `sampler/frame-sampler.ts`), re-exported as contracts. */
export type {
  FrameLogEntry,
  FrameProgress,
  FrameSamplerTarget,
  FrameWarning,
  PreparedFrames,
  PrepareFramesOptions,
  RenderFramesOptions,
};

/** Validated render settings (spec 003 Data and contracts), re-exported from `@csg/parts-schema`. */
export type {RenderSettings};

/** Post stages in pipeline order (AC-PIX-025.1). */
export type PostStageId =
  | 'coverage'
  | 'rim'
  | 'outline'
  | 'srgb'
  | 'dither'
  | 'palette'
  | 'final-alpha';

/** Axis-aligned box in the camera plane, world units, pivot at the origin. */
export interface ScreenBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Result of framing the union bounds (REQ-PIX-007..009, 015.3). */
export interface Framing {
  /** World units per output pixel. */
  readonly worldPerPx: number;
  readonly elevationDeg: number;
  /** Frustum from the pivot, in multiples of `worldPerPx`. */
  readonly frustum: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  /** Pivot corner in top-left coords: `[floor(W/2), H - 1 - pivotRowPx]` (AC-PIX-008.2). */
  readonly pivotPx: readonly [number, number];
  /** Frames that do not fit; reported as `PIX_FRAMING_CLIPPED`. */
  readonly clipped: ReadonlyArray<{
    readonly label: string;
    readonly direction: number;
  }>;
}

/** One screen box per (clip label, direction) for {@link ComputeFraming}. */
export interface FramingBox {
  readonly label: string;
  readonly direction: number;
  readonly box: ScreenBox;
}

/**
 * Pure framing computation. Auto mode takes the max ratio over up/left/right
 * with margin `outerWidth + 1`; below-ground geometry clips.
 */
export type ComputeFraming = (
  boxes: ReadonlyArray<FramingBox>,
  settings: RenderSettings,
) => Framing;

/** Row layout of a raw readback buffer (REQ-PIX-029). */
export interface ReadbackLayout {
  /** WebGPU: `ceil(W * 4 / 256) * 256`; WebGL2: `W * 4`. */
  readonly rowStrideBytes: number;
  /** WebGL2 `readPixels` is bottom-up; WebGPU is top-down. */
  readonly bottomUp: boolean;
}

/**
 * Normalizes a raw readback to tightly packed RGBA8, top-left origin
 * (`w * h * 4` bytes).
 */
export type NormalizeReadback = (
  raw: ArrayBufferView,
  w: number,
  h: number,
  layout: ReadbackLayout,
) => Uint8ClampedArray;

/**
 * One planned export frame. Order: animations order, then direction index,
 * then frame (REQ-EXP-001).
 */
export interface FrameJob {
  /** File-safe `AnimationSelection.label`. */
  readonly label: string;
  readonly clipId: ClipRef;
  readonly direction: number;
  /** Output frame index (after ping-pong baking). */
  readonly frame: number;
  readonly sourceFrame: number;
  readonly timeSec: number;
  readonly durationMs: number;
}

/** One rendered export frame (architecture 3.6). */
export interface RenderedFrame {
  /** Carries `AnimationSelection.label` (file-safe), not the `ClipRef`. */
  readonly clipId: string;
  /** Index into the active direction set, `DIRECTION_ORDER`-based. */
  readonly direction: number;
  readonly frame: number;
  readonly sourceFrame: number;
  readonly timeSec: number;
  /** `1000 / fps`. */
  readonly durationMs: number;
  /** Only with root motion `metadata`. */
  readonly rootOffsetPx?: readonly [number, number];
  readonly width: number;
  readonly height: number;
  /** RGBA8, straight alpha, palette-quantized, tightly packed, top-left origin (REQ-PIX-029). */
  readonly pixels: Uint8ClampedArray;
}

/** Seam of the frame sampler, so it is Node-testable with a fake. */
export interface FrameTarget {
  setClip(
    ref: ClipRef,
    rootMotion: 'in-place' | 'metadata',
  ): Promise<Result<void, EngineError>>;
  /** Evaluates the pose, applies yaw and the root snap. */
  pose(timeSec: number, direction: number): void;
  /** CPU skinned corners in stage space (8 per skinned mesh). */
  skinnedCorners(): Float32Array;
  setFraming(framing: Framing): void;
  render(): void;
  read(): Promise<Uint8ClampedArray>;
}

/**
 * Phase 1 of the frame sampler (`sampler/frame-sampler.ts`): plan, union
 * bounds and the one fixed framing of an export, with warnings.
 */
export type PrepareFrames = (
  target: FrameSamplerTarget,
  settings: RenderSettings,
  options?: PrepareFramesOptions,
) => Promise<Result<PreparedFrames, EngineError>>;

/**
 * Phase 2 of the frame sampler: renders every prepared frame in
 * {@link FrameJob} order. Throws `FrameSamplerError` (`EXP_CANCELLED` on
 * abort, or the failing `setClip` code).
 */
export type SampleFrames = (
  target: FrameSamplerTarget,
  prepared: PreparedFrames,
  options?: RenderFramesOptions,
) => AsyncIterable<RenderedFrame>;

/** Plans the frame list (pure, deterministic). */
export type PlanFrames = (
  settings: RenderSettings,
  durations: ReadonlyMap<ClipRef, number>,
) => FrameJob[];
