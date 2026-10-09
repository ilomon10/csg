/**
 * Export frame sampler (spec 003 REQ-PIX-006/007/009/010, spec 004
 * REQ-ANM-011/013/015, spec 005 REQ-EXP-001/024; m2-plan 2.1 and 2.6).
 *
 * Two phases over a {@link FrameSamplerTarget} (the pixel pipeline plus the
 * posed character, or a fake in Node tests):
 *
 * 1. {@link prepareFrames}: plans every frame ({@link planFrames}), poses the
 *    character once per (clip, source frame), projects its CPU-skinned
 *    corners for every rendered direction into the union bounds, and computes
 *    the one fixed framing of the export (REQ-PIX-007). Clipping and clamped
 *    sample times come back as warnings (`PIX_FRAMING_CLIPPED`,
 *    `ANM_FIXED_FPS_CLAMPED`), never as failures (REQ-PIX-009).
 * 2. {@link renderFrames}: walks the jobs in REQ-EXP-001 order, poses at the
 *    job's sample time (identical in every direction, REQ-ANM-011), turns the
 *    stage, renders exactly once through the pipeline, reads back and yields a
 *    {@link RenderedFrame}. With `mirrorWest` the west-facing directions are
 *    flipped copies of their east-facing source and never rendered
 *    (AC-PIX-006.2). The AbortSignal is checked between frames and raced
 *    against every readback, so a cancel ends the iteration with
 *    `EXP_CANCELLED` well within 250 ms (AC-EXP-024.1).
 *
 * Deterministic: no wall clock, no randomness; the same settings and
 * character give the same jobs, framing and pixels (P-04, REQ-PIX-027).
 */
import type {Object3D} from 'three';
import {Vector3} from 'three';
import type {ClipRef, DirectionLabel, RenderSettings} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import type {EngineError, Result} from '../contracts/errors';
import type {
  FrameJob,
  FrameTarget,
  Framing,
  FramingBox,
  RenderedFrame,
} from '../contracts/pipeline';
import {stageYawRad} from '../pipeline/directions';
import {cameraElevationDeg, computeFraming} from '../pipeline/framing';
import {snapOffsetPx} from '../pipeline/snap';
import {
  activeDirectionLabels,
  clipForDirection,
  mirrorSourceDirection,
  planFrames,
} from './frame-plan';
import {collectStageCorners, createUnionBounds} from './union-bounds';

/** Error code of a cancelled export (spec 005 REQ-EXP-024). */
export const EXP_CANCELLED = 'EXP_CANCELLED';

/** Root-motion mode of a selection when it sets none (REQ-ANM-013). */
export const DEFAULT_ROOT_MOTION = 'in-place';

const DEG_TO_RAD = Math.PI / 180;

/**
 * The {@link FrameTarget} seam plus what the sampler needs beyond the M2-03
 * contract: the direction set, clip durations, the frame-0 root reference
 * (REQ-PIX-010, REQ-ANM-015) and state restoration (renderer exclusivity, D5).
 */
export interface FrameSamplerTarget extends FrameTarget {
  /**
   * Called first by both phases: the export's settings (direction set for
   * the yaw of `pose(t, direction)`, camera elevation).
   *
   * @param settings Validated render settings.
   */
  configure(settings: RenderSettings): void;
  /** Duration in seconds of the clip set by the last successful `setClip`. */
  clipDurationSec(): number;
  /**
   * Records the root pose of the current clip at `timeSec` (its frame 0):
   * root translation is snapped relative to it (REQ-PIX-010) and, with
   * `metadata`, reported relative to it (REQ-ANM-015).
   *
   * @param timeSec Sample time of source frame 0.
   */
  setRootReference(timeSec: number): void;
  /**
   * Root displacement of the last `pose` from the reference, in whole output
   * pixels, top-left convention (x right, y down); `undefined` unless the
   * current clip was set with `metadata`.
   */
  rootOffsetPx(): readonly [number, number] | undefined;
  /** Restores every transform the sampler changed (called in `finally`). */
  restore(): void;
}

/** A warning of the sampler: reported, the frames are still produced. */
export interface FrameWarning extends EngineError {
  readonly code: 'PIX_FRAMING_CLIPPED' | 'ANM_FIXED_FPS_CLAMPED';
}

/** Output of {@link prepareFrames}, input of {@link renderFrames}. */
export interface PreparedFrames {
  /** The settings the plan and framing were made for. */
  readonly settings: RenderSettings;
  /** Every frame in REQ-EXP-001 order (clip → direction → frame). */
  readonly jobs: readonly FrameJob[];
  /** The one framing of the export (camera, pivot, clipped frames). */
  readonly framing: Framing;
  /** `PIX_FRAMING_CLIPPED` and `ANM_FIXED_FPS_CLAMPED` warnings. */
  readonly warnings: readonly FrameWarning[];
  /** Mirrored direction → east-facing source direction (`mirrorWest`). */
  readonly mirrored: ReadonlyMap<number, number>;
}

/** One entry of the sampler's frame log (AC-ANM-011.1). */
export interface FrameLogEntry {
  readonly label: string;
  readonly clipId: ClipRef;
  readonly direction: number;
  readonly frame: number;
  readonly sourceFrame: number;
  readonly timeSec: number;
  /** `rendered` on the GPU, or `mirrored` from `mirroredFrom` (REQ-PIX-006). */
  readonly source: 'rendered' | 'mirrored';
  readonly mirroredFrom?: number;
}

/** Progress of {@link renderFrames} (architecture 3.6 `ExportProgress`). */
export interface FrameProgress {
  readonly phase: 'render';
  readonly done: number;
  readonly total: number;
}

/** Options of {@link prepareFrames}. */
export interface PrepareFramesOptions {
  readonly signal?: AbortSignal;
}

/** Options of {@link renderFrames}. */
export interface RenderFramesOptions {
  readonly signal?: AbortSignal;
  /** Called for every frame, just before it is yielded. */
  readonly onProgress?: (progress: FrameProgress) => void;
  /** Receives one entry per yielded frame, in yield order. */
  readonly log?: FrameLogEntry[];
}

/**
 * Error thrown by {@link renderFrames} (an async iterable cannot return a
 * `Result`): `EXP_CANCELLED` on abort, or the failing `setClip` error code.
 */
export class FrameSamplerError extends Error implements EngineError {
  /** Spec-prefixed code. */
  readonly code: string;
  /** Code-specific details. */
  readonly details?: Readonly<Record<string, unknown>>;

  /**
   * @param error The engine error to carry.
   */
  constructor(error: EngineError) {
    super(error.message);
    this.name = 'FrameSamplerError';
    this.code = error.code;
    if (error.details !== undefined) this.details = error.details;
  }
}

/** Reads `signal.aborted` through a call, so TS does not narrow it across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function cancelled(): EngineError {
  return {code: EXP_CANCELLED, message: 'the export was cancelled'};
}

/** Root-motion mode of the selection with `label`. */
function rootMotionOf(
  settings: RenderSettings,
  label: string,
): 'in-place' | 'metadata' {
  return (
    settings.animations.find(a => a.label === label)?.rootMotion ??
    DEFAULT_ROOT_MOTION
  );
}

/** Mirrored direction → source direction for the active set. */
function mirrorMap(settings: RenderSettings): Map<number, number> {
  const out = new Map<number, number>();
  const count = activeDirectionLabels(settings).length;
  for (let d = 0; d < count; d++) {
    const source = mirrorSourceDirection(settings, d);
    if (source !== null) out.set(d, source);
  }
  return out;
}

/**
 * Flips a frame horizontally around the pivot line, the left edge of column
 * `pivotColumnPx` (REQ-PIX-006, AC-PIX-006.1; pivot corner per A6): column
 * `x` moves to `2·pivotColumnPx − 1 − x`. Pixels that leave the cell are
 * dropped; uncovered pixels are transparent black.
 *
 * @param pixels Tight RGBA8, top-left origin.
 * @param width Cell width.
 * @param height Cell height.
 * @param pivotColumnPx `floor(width / 2)`.
 * @returns A new buffer.
 */
export function mirrorFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  pivotColumnPx: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length);
  for (let x = 0; x < width; x++) {
    const tx = 2 * pivotColumnPx - 1 - x;
    if (tx < 0 || tx >= width) continue;
    for (let y = 0; y < height; y++) {
      const from = (y * width + x) * 4;
      const to = (y * width + tx) * 4;
      out[to] = pixels[from] as number;
      out[to + 1] = pixels[from + 1] as number;
      out[to + 2] = pixels[from + 2] as number;
      out[to + 3] = pixels[from + 3] as number;
    }
  }
  return out;
}

/**
 * Phase 1: plan, union bounds and framing (REQ-PIX-007, REQ-PIX-009).
 * Loads every planned clip once to read its duration, then poses each
 * (clip, source frame) once and adds its stage-space corners for every
 * rendered direction of that clip with the direction's stage yaw. Mirrored
 * directions get the mirror image of their source's box, which is exactly
 * what they will show. Does not set the framing on the target.
 *
 * @param target The frame target.
 * @param settings Validated render settings (with `animations`).
 * @param options Abort signal.
 * @returns The prepared export, `EXP_CANCELLED`, or the failing `setClip` error.
 */
export async function prepareFrames(
  target: FrameSamplerTarget,
  settings: RenderSettings,
  options: PrepareFramesOptions = {},
): Promise<Result<PreparedFrames, EngineError>> {
  const {signal} = options;
  if (isAborted(signal)) return {ok: false, error: cancelled()};
  target.configure(settings);
  try {
    const labels = activeDirectionLabels(settings);
    const mirrored = mirrorMap(settings);

    // Clip durations (each distinct clip once, in plan order).
    const durations = new Map<ClipRef, number>();
    for (const selection of settings.animations) {
      for (let d = 0; d < labels.length; d++) {
        const clip = clipForDirection(selection, d);
        if (durations.has(clip)) continue;
        const set = await target.setClip(
          clip,
          selection.rootMotion ?? DEFAULT_ROOT_MOTION,
        );
        if (!set.ok) return set;
        if (isAborted(signal)) return {ok: false, error: cancelled()};
        durations.set(clip, target.clipDurationSec());
      }
    }
    const jobs = planFrames(settings, durations);
    const warnings: FrameWarning[] = clampWarnings(settings, durations);

    // Union bounds: one pose per (label, clip, source frame).
    const union = createUnionBounds(cameraElevationDeg(settings.camera));
    for (const group of clipGroups(jobs, mirrored)) {
      if (isAborted(signal)) return {ok: false, error: cancelled()};
      const set = await target.setClip(
        group.clipId,
        rootMotionOf(settings, group.label),
      );
      if (!set.ok) return set;
      target.setRootReference(group.referenceTimeSec);
      const firstDirection = group.directions[0] as number;
      for (const timeSec of group.times) {
        if (isAborted(signal)) return {ok: false, error: cancelled()};
        target.pose(timeSec, firstDirection);
        const corners = target.skinnedCorners();
        for (const d of group.directions) {
          union.add(
            group.label,
            d,
            corners,
            stageYawRad(labels[d] as DirectionLabel),
          );
        }
      }
    }
    const boxes = withMirroredBoxes(union.boxes(), mirrored);
    const framing = computeFraming(boxes, settings);
    if (framing.clipped.length > 0) {
      warnings.push({
        code: 'PIX_FRAMING_CLIPPED',
        message: `framing clips ${framing.clipped
          .map(c => `${c.label}/${labels[c.direction] ?? c.direction}`)
          .join(', ')}`,
        details: {frames: framing.clipped},
      });
    }
    return {ok: true, value: {settings, jobs, framing, warnings, mirrored}};
  } finally {
    target.restore();
  }
}

/** `ANM_FIXED_FPS_CLAMPED` per (label, clip), from the plan's own sample times. */
function clampWarnings(
  settings: RenderSettings,
  durations: ReadonlyMap<ClipRef, number>,
): FrameWarning[] {
  const out: FrameWarning[] = [];
  const labels = activeDirectionLabels(settings);
  for (const selection of settings.animations) {
    const seen = new Set<ClipRef>();
    for (let d = 0; d < labels.length; d++) {
      const clipId = clipForDirection(selection, d);
      if (seen.has(clipId)) continue;
      seen.add(clipId);
      const durationSec = durations.get(clipId) as number;
      for (const w of computeSampleTimes(selection, durationSec).warnings) {
        out.push({
          code: w.code,
          message: `${selection.label}: frames ${w.frames.join(', ')} clamped to the end of ${clipId}`,
          details: {label: selection.label, clipId, frames: [...w.frames]},
        });
      }
    }
  }
  return out;
}

interface ClipGroup {
  readonly label: string;
  readonly clipId: ClipRef;
  /** Rendered (non-mirrored) directions of this clip, ascending. */
  readonly directions: number[];
  /** Distinct sample times, in first-seen frame order. */
  readonly times: number[];
  /** Time of source frame 0 (the group's first job is always frame 0). */
  readonly referenceTimeSec: number;
}

/** Groups the rendered jobs by (label, clip), in plan order. */
function clipGroups(
  jobs: readonly FrameJob[],
  mirrored: ReadonlyMap<number, number>,
): ClipGroup[] {
  const groups = new Map<string, ClipGroup>();
  for (const job of jobs) {
    if (mirrored.has(job.direction)) continue;
    const key = `${job.label}\u0000${job.clipId}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        label: job.label,
        clipId: job.clipId,
        directions: [],
        times: [],
        referenceTimeSec: job.timeSec,
      };
      groups.set(key, group);
    }
    if (!group.directions.includes(job.direction))
      group.directions.push(job.direction);
    if (!group.times.includes(job.timeSec)) group.times.push(job.timeSec);
  }
  return [...groups.values()];
}

/** Adds, per mirrored direction, the mirror image (x → −x) of its source's box. */
function withMirroredBoxes(
  boxes: FramingBox[],
  mirrored: ReadonlyMap<number, number>,
): FramingBox[] {
  if (mirrored.size === 0) return boxes;
  const out = [...boxes];
  for (const [direction, source] of mirrored) {
    for (const b of boxes) {
      if (b.direction !== source) continue;
      out.push({
        label: b.label,
        direction,
        box: {
          minX: -b.box.maxX,
          maxX: -b.box.minX,
          minY: b.box.minY,
          maxY: b.box.maxY,
        },
      });
    }
  }
  return out;
}

/** Resolves `promise`, or rejects with `EXP_CANCELLED` as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(new FrameSamplerError(cancelled()));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      promise.catch(() => undefined);
      reject(new FrameSamplerError(cancelled()));
    };
    signal.addEventListener('abort', onAbort, {once: true});
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

interface CachedFrame {
  readonly pixels: Uint8ClampedArray;
  readonly rootOffsetPx: readonly [number, number] | undefined;
  /** Emissions still to come (own job and mirrored partner). */
  remaining: number;
}

/**
 * Phase 2: renders the prepared jobs in REQ-EXP-001 order and yields one
 * {@link RenderedFrame} each. Sets the framing once (one camera for every
 * frame, AC-PIX-007.1), sets each (label, clip) once with its frame-0 root
 * reference, poses at the job's sample time, renders and reads back.
 * Mirrored directions (`mirrorWest`) flip the source frame (rendered early
 * when the source comes later in the order) and negate `rootOffsetPx[0]`.
 *
 * Throws {@link FrameSamplerError}: `EXP_CANCELLED` when `signal` aborts
 * (checked between frames and raced against each readback, AC-EXP-024.1),
 * or the code of a failing `setClip`. The target is restored in every case.
 *
 * @param target The frame target (exclusive for the whole iteration).
 * @param prepared Output of {@link prepareFrames} for the same target.
 * @param options Abort signal, progress callback, frame log.
 * @yields The frames.
 */
export async function* renderFrames(
  target: FrameSamplerTarget,
  prepared: PreparedFrames,
  options: RenderFramesOptions = {},
): AsyncGenerator<RenderedFrame, void, undefined> {
  const {signal, onProgress, log} = options;
  const {settings, jobs, framing, mirrored} = prepared;
  const throwIfAborted = () => {
    if (isAborted(signal)) throw new FrameSamplerError(cancelled());
  };
  throwIfAborted();
  const {width, height} = settings.resolution;
  const pivotColumnPx = framing.pivotPx[0];
  const keyOf = (label: string, direction: number, frame: number) =>
    `${label}\u0000${direction}\u0000${frame}`;
  const jobIndex = new Map<string, FrameJob>();
  for (const job of jobs)
    jobIndex.set(keyOf(job.label, job.direction, job.frame), job);
  const mirrorPartners = new Set(mirrored.values());
  const referenceTimes = new Map<string, number>();
  for (const job of jobs) {
    const key = `${job.label}\u0000${job.clipId}`;
    if (job.sourceFrame === 0 && !referenceTimes.has(key))
      referenceTimes.set(key, job.timeSec);
  }
  const cache = new Map<string, CachedFrame>();
  let currentClip: string | undefined;

  target.configure(settings);
  try {
    target.setFraming(framing);

    const renderJob = async (job: FrameJob): Promise<CachedFrame> => {
      const clipKey = `${job.label}\u0000${job.clipId}`;
      if (clipKey !== currentClip) {
        const set = await raceAbort(
          target.setClip(job.clipId, rootMotionOf(settings, job.label)),
          signal,
        );
        if (!set.ok) throw new FrameSamplerError(set.error);
        currentClip = clipKey;
        target.setRootReference(referenceTimes.get(clipKey) ?? job.timeSec);
      }
      throwIfAborted();
      target.pose(job.timeSec, job.direction);
      const rootOffsetPx = target.rootOffsetPx();
      target.render();
      const pixels = await raceAbort(target.read(), signal);
      return {pixels, rootOffsetPx, remaining: 1};
    };

    let done = 0;
    for (const job of jobs) {
      throwIfAborted();
      const source = mirrored.get(job.direction);
      let pixels: Uint8ClampedArray;
      let rootOffsetPx: readonly [number, number] | undefined;
      if (source === undefined) {
        const key = keyOf(job.label, job.direction, job.frame);
        let entry = cache.get(key);
        if (entry === undefined) {
          entry = await renderJob(job);
          if (mirrorPartners.has(job.direction)) {
            entry.remaining = 1;
            cache.set(key, entry);
          }
        } else if (--entry.remaining <= 0) {
          cache.delete(key);
        }
        pixels = entry.pixels;
        rootOffsetPx = entry.rootOffsetPx;
      } else {
        const key = keyOf(job.label, source, job.frame);
        let entry = cache.get(key);
        if (entry === undefined) {
          const sourceJob = jobIndex.get(key);
          if (sourceJob === undefined)
            throw new Error(`renderFrames: no source job for ${key}`);
          entry = await renderJob(sourceJob);
          entry.remaining = 1;
          cache.set(key, entry);
        } else if (--entry.remaining <= 0) {
          cache.delete(key);
        }
        pixels = mirrorFrame(entry.pixels, width, height, pivotColumnPx);
        rootOffsetPx =
          entry.rootOffsetPx === undefined
            ? undefined
            : [-entry.rootOffsetPx[0] || 0, entry.rootOffsetPx[1]];
      }
      throwIfAborted();
      const frame: RenderedFrame = {
        clipId: job.label,
        direction: job.direction,
        frame: job.frame,
        sourceFrame: job.sourceFrame,
        timeSec: job.timeSec,
        durationMs: job.durationMs,
        ...(rootOffsetPx === undefined ? {} : {rootOffsetPx}),
        width,
        height,
        pixels,
      };
      log?.push({
        label: job.label,
        clipId: job.clipId,
        direction: job.direction,
        frame: job.frame,
        sourceFrame: job.sourceFrame,
        timeSec: job.timeSec,
        source: source === undefined ? 'rendered' : 'mirrored',
        ...(source === undefined ? {} : {mirroredFrom: source}),
      });
      done++;
      onProgress?.({phase: 'render', done, total: jobs.length});
      yield frame;
    }
  } finally {
    cache.clear();
    target.restore();
  }
}

/** The pipeline calls the frame target makes (a `PixelPipeline` fits). */
export interface FramePipeline {
  setFraming(framing: Framing): unknown;
  render(): void;
  read(): Promise<Uint8ClampedArray>;
}

/** The character calls the frame target makes (a `CharacterAssembly` fits). */
export interface PosableCharacter {
  /** Character container; a descendant of the stage. */
  readonly root: Object3D;
  /** Skeleton, for the root joint (`rig.rootBone`); `null` before a body. */
  readonly body: {
    readonly bones: ReadonlyMap<string, Object3D>;
    readonly rig: {readonly rootBone: string};
  } | null;
  /** Duration of the held clip, `null` without one. */
  readonly clipDurationSec: number | null;
  setClip(
    ref: ClipRef,
    rootMotion: 'in-place' | 'metadata',
  ): Promise<Result<void, EngineError>>;
  evaluate(timeSec: number): void;
}

/** Options of {@link createPipelineFrameTarget}. */
export interface PipelineFrameTargetOptions {
  readonly pipeline: FramePipeline;
  readonly character: PosableCharacter;
  /** Turned by the direction yaw; its local space is "stage space". */
  readonly stage: Object3D;
}

/**
 * The real {@link FrameSamplerTarget}: the pixel pipeline plus a posed
 * character on a stage. Renders only through `pipeline.render()` (the
 * pipeline advances three's node frame itself, M2-14).
 *
 * `pose(t, direction)` evaluates the pose at `t` (REQ-ANM-008), sets the
 * stage yaw of the direction, and snaps the root (REQ-PIX-010): the root
 * joint's displacement from the frame-0 reference, projected into the camera
 * plane, is made a whole number of pixels by a sub-pixel stage translation.
 * With `metadata` (REQ-ANM-015) the horizontal displacement is first removed
 * in stage space (the character renders in place, vertical motion kept) and
 * the full displacement is reported by `rootOffsetPx`.
 *
 * @param options Pipeline, character and stage.
 * @returns The target.
 */
export function createPipelineFrameTarget(
  options: PipelineFrameTargetOptions,
): FrameSamplerTarget {
  const {pipeline, character, stage} = options;
  let yaws: number[] = [];
  let elevationRad = 0;
  let worldPerPx: number | undefined;
  let rootMotion: 'in-place' | 'metadata' = DEFAULT_ROOT_MOTION;
  const reference = new Vector3();
  let hasReference = false;
  let offset: [number, number] | undefined;
  const saved = {
    stagePosition: new Vector3(),
    stageYaw: 0,
    rootPosition: new Vector3(),
    stored: false,
  };
  const v = new Vector3();

  /** Stage-local position of the root joint (or the character root). */
  const rootJointInStage = (out: Vector3): Vector3 => {
    const body = character.body;
    const joint = body?.bones.get(body.rig.rootBone) ?? character.root;
    stage.updateMatrixWorld(true);
    joint.getWorldPosition(out);
    return stage.worldToLocal(out);
  };

  return {
    configure(settings) {
      yaws = activeDirectionLabels(settings).map(l => stageYawRad(l));
      elevationRad = cameraElevationDeg(settings.camera) * DEG_TO_RAD;
      worldPerPx = undefined;
      if (!saved.stored) {
        saved.stagePosition.copy(stage.position);
        saved.stageYaw = stage.rotation.y;
        saved.rootPosition.copy(character.root.position);
        saved.stored = true;
      }
    },

    async setClip(ref, mode) {
      const set = await character.setClip(ref, mode);
      if (set.ok) {
        rootMotion = mode;
        hasReference = false;
      }
      return set;
    },

    clipDurationSec() {
      const d = character.clipDurationSec;
      if (d === null) throw new Error('frame target: no clip set');
      return d;
    },

    setRootReference(timeSec) {
      character.root.position.copy(saved.rootPosition);
      stage.position.copy(saved.stagePosition);
      stage.rotation.y = 0;
      character.evaluate(timeSec);
      rootJointInStage(reference);
      hasReference = true;
    },

    pose(timeSec, direction) {
      const yaw = yaws[direction];
      if (yaw === undefined)
        throw new Error(`frame target: direction ${direction} not configured`);
      character.root.position.copy(saved.rootPosition);
      stage.position.copy(saved.stagePosition);
      stage.rotation.y = yaw;
      character.evaluate(timeSec);
      offset = undefined;
      if (!hasReference) return;
      rootJointInStage(v).sub(reference);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const ce = Math.cos(elevationRad);
      const se = Math.sin(elevationRad);
      // Camera-plane projection of a stage-space vector after the yaw (union-bounds convention).
      const screenX = (x: number, z: number) => x * cy + z * sy;
      const screenY = (x: number, y: number, z: number) =>
        y * ce - (-x * sy + z * cy) * se;
      let rx = v.x;
      let rz = v.z;
      if (rootMotion === 'metadata') {
        if (worldPerPx !== undefined) {
          const px = snapOffsetPx(
            [screenX(v.x, v.z), screenY(v.x, v.y, v.z)],
            worldPerPx,
          );
          offset = [px[0], -px[1] || 0];
        }
        // Render in place: drop the horizontal travel (stage space), keep Y.
        character.root.position.x -= v.x;
        character.root.position.z -= v.z;
        rx = 0;
        rz = 0;
      }
      if (worldPerPx === undefined) return;
      const sx = screenX(rx, rz);
      const sY = screenY(rx, v.y, rz);
      const snapped = snapOffsetPx([sx, sY], worldPerPx);
      const dx = snapped[0] * worldPerPx - sx;
      const dy = snapped[1] * worldPerPx - sY;
      // Camera right = (1, 0, 0), up = (0, cos e, −sin e) in world space.
      stage.position.set(
        saved.stagePosition.x + dx,
        saved.stagePosition.y + dy * ce,
        saved.stagePosition.z - dy * se,
      );
    },

    skinnedCorners() {
      return collectStageCorners(character.root, stage);
    },

    setFraming(framing) {
      pipeline.setFraming(framing);
      worldPerPx = framing.worldPerPx;
    },

    render() {
      pipeline.render();
    },

    read() {
      return pipeline.read();
    },

    rootOffsetPx() {
      return rootMotion === 'metadata' ? offset : undefined;
    },

    restore() {
      if (!saved.stored) return;
      stage.position.copy(saved.stagePosition);
      stage.rotation.y = saved.stageYaw;
      character.root.position.copy(saved.rootPosition);
      saved.stored = false;
    },
  };
}
