/**
 * The character renderer (architecture 3.6; spec 000 REQ-GEN-001/002; spec 001
 * REQ-CMP-033; spec 003 REQ-PIX-001/010/030/031/034; spec 004 REQ-ANM-018;
 * spec 005 REQ-EXP-001/024 render side): backend selection, diff-based
 * assembly, the preview loop, and the pixel pipeline shared by preview and
 * export.
 *
 * Frame path (m2-plan 2.1): the preview poses the character through the same
 * frame target the export uses (`createPipelineFrameTarget`: pose at the
 * sample time, stage yaw, texel-snapped root), renders exactly once through
 * `PixelPipeline.render()` into the cell target, and a presenter copies the
 * cell to the canvas texel for texel. The canvas drawing buffer is the cell
 * (W x H); the integer upscale is CSS only and comes from
 * {@link EngineCharacterRenderer.resize} (REQ-PIX-031). One pipeline, compiled
 * in `export` mode for both uses, so for a given settings, clip, sample time
 * and direction the preview cell and the exported frame are the same bytes
 * (AC-PIX-030.1).
 *
 * Preview framing (REQ-PIX-030): the export framing of the selected
 * animations (`settings.animations`), plus the previewed clip with its
 * manifest defaults when it is not selected; the rest pose when nothing is
 * selected or playing. It is recomputed when the character, the previewed
 * clip (if unselected) or a framing setting changes.
 *
 * Exclusivity (PM decision D5): `setCharacter`, `playClip`,
 * `setRenderSettings`, `prepareFrames` and `renderFrames` run one at a time.
 * While one runs the preview loop is stopped and `draw()` is a no-op; on exit
 * the settings, the preview clip, the framing and the loop are restored.
 */
import type {OrthographicCamera, RenderTarget, Scene} from 'three';
import type {WebGPURenderer} from 'three/webgpu';
import {
  DIRECTION_ORDER as SCHEMA_DIRECTION_ORDER,
  parseRenderSettings,
  defaultRenderSettings,
} from '@csg/parts-schema';
import type {
  AnimationSelection,
  CharacterSpec,
  DirectionLabel,
  ClipRef,
  SlotRegistry,
} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import {
  ENGINE_DISPOSED,
  createCharacterAssembly,
} from '../composition/character-assembly';
import type {
  AssemblyRegistry,
  CharacterAssembly,
} from '../composition/character-assembly';
import type {RootMotionMode} from '../contracts/animation';
import type {EngineError, Result} from '../contracts/errors';
import type {
  Framing,
  PreparedFrames,
  PrepareFramesOptions,
  RenderedFrame,
  RenderFramesOptions,
  RenderSettings,
} from '../contracts/pipeline';
import type {
  CharacterRenderer,
  PreviewResize,
  RendererBackend,
  RendererOptions,
} from '../contracts/renderer';
import {computeFraming, cameraElevationDeg} from '../pipeline/framing';
import {stageYawRad} from '../pipeline/directions';
import {createPixelPipeline} from '../pipeline/render-pipeline';
import type {PixelPipelineStats} from '../pipeline/render-pipeline';
import {SettingsBinder} from '../pipeline/settings-binder';
import type {RenderSettingsDiff} from '../pipeline/settings-binder';
import {
  activeDirectionLabels,
  mirrorSourceDirection,
} from '../sampler/frame-plan';
import {
  FrameSamplerError,
  createPipelineFrameTarget,
  prepareFrames as samplePrepare,
  renderFrames as sampleRender,
} from '../sampler/frame-sampler';
import {createUnionBounds} from '../sampler/union-bounds';
import {createRendererBackend} from './backend';
import type {InitializableRenderer, RendererFactory} from './backend';
import {createCanvasPresenter} from './canvas-presenter';
import type {PreviewPresenter} from './canvas-presenter';
import {previewTimeAt, previewTimingFor} from './preview-clock';
import type {PreviewTiming} from './preview-clock';
import {previewLayout} from './preview-layout';
import {createPreviewScene} from './preview-scene';
import type {PreviewScene} from './preview-scene';

/** The renderer calls the preview needs (`WebGPURenderer` fits). */
export interface PreviewRenderer extends InitializableRenderer {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAnimationLoop(callback: ((timeMs: number) => void) | null): unknown;
}

/**
 * The pixel-pipeline calls the renderer makes (`PixelPipeline` fits). The
 * pipeline owns the drawing-buffer size (cell size, pixel ratio 1).
 */
export interface RendererPipeline {
  /** RGBA8 target holding the finished cell (preview shows it, export reads it). */
  readonly cellTarget: RenderTarget;
  /** Rebuild and frame counters (AC-PIX-034.1 spy). */
  readonly stats: PixelPipelineStats;
  /** Applies validated settings; resolves after the palette LUT upload. */
  setRenderSettings(settings: RenderSettings): Promise<RenderSettingsDiff>;
  /** Places the camera for a framing. */
  setFraming(framing: Framing): unknown;
  /** Renders one frame into {@link cellTarget}. */
  render(): void;
  /** Reads {@link cellTarget}: tight RGBA8, top-left origin (REQ-PIX-029). */
  read(): Promise<Uint8ClampedArray>;
  dispose(): void;
}

/** What a {@link PipelineFactory} gets. */
export interface PipelineFactoryArgs<R extends PreviewRenderer> {
  readonly renderer: R;
  readonly backend: RendererBackend;
  readonly scene: Scene;
  /** The preview camera, placed by the pipeline's framing. */
  readonly camera: OrthographicCamera;
  /** The renderer's one settings binder (shared with the part materials). */
  readonly binder: SettingsBinder;
}

/** Creates the pipeline (tests inject fakes; default {@link createPixelPipeline}). */
export type PipelineFactory<R extends PreviewRenderer> = (
  args: PipelineFactoryArgs<R>,
) => Result<RendererPipeline, EngineError>;

/** Creates the canvas presenter (tests inject fakes; default {@link createCanvasPresenter}). */
export type PresenterFactory<R extends PreviewRenderer> = (
  renderer: R,
  pipeline: RendererPipeline,
) => PreviewPresenter;

/** Options of {@link createCharacterRenderer}. */
export interface CharacterRendererOptions<
  R extends PreviewRenderer = WebGPURenderer,
> extends Omit<RendererOptions, 'registry'> {
  /**
   * Asset registry. Composition needs the engine view of loaded parts
   * (`EngineAssetRegistry` from `createAssetRegistry` fits).
   */
  readonly registry: AssemblyRegistry;
  /** Slot registry for `defaultSocket` of static parts. */
  readonly slots?: SlotRegistry;
  /** Renderer factory (tests); default `new WebGPURenderer(parameters)`. */
  readonly factory?: RendererFactory<R>;
  /** Pipeline factory (tests); default `createPixelPipeline`. */
  readonly pipelineFactory?: PipelineFactory<R>;
  /** Presenter factory (tests); default `createCanvasPresenter`. */
  readonly presenterFactory?: PresenterFactory<R>;
  /**
   * Called with the error when `play()` / `playClip()` cannot load or retarget
   * its clip, or when the preview framing cannot be computed after a
   * character or clip change. Never called after `dispose()`.
   */
  readonly onError?: (error: EngineError) => void;
}

/** The engine's renderer: the {@link CharacterRenderer} contract plus preview controls. */
export interface EngineCharacterRenderer<
  R extends PreviewRenderer = WebGPURenderer,
> extends CharacterRenderer {
  /** The three renderer. */
  readonly renderer: R;
  /** Scene, camera (placed by the pipeline framing) and direction stage. */
  readonly preview: PreviewScene;
  /** The assembled character (toon materials bound to {@link binder}). */
  readonly assembly: CharacterAssembly;
  /** The renderer's one settings binder. */
  readonly binder: SettingsBinder;
  /** The applied render settings. */
  readonly renderSettings: RenderSettings;
  /** Framing of the preview, `undefined` before the first character. */
  readonly framing: Framing | undefined;
  /** AC-PIX-030.1 reads the preview cell from here (also via {@link readCell}). */
  readonly cellTarget: RenderTarget;
  /** AC-PIX-034.1 spy: post-chain rebuilds and rendered frames. */
  readonly pipelineStats: PixelPipelineStats;
  /** Layout for the last `resize` viewport and the current cell size. */
  readonly layout: PreviewResize;
  /** Clip time last drawn, in seconds. */
  readonly timeSec: number;
  /**
   * Whether the preview plays (user intent). While an exclusive operation
   * (export, settings change) runs the loop is stopped and resumes after.
   */
  readonly playing: boolean;
  /** True while an exclusive operation holds the renderer. */
  readonly busy: boolean;
  /**
   * Preview timing (REQ-ANM-018). `null` (default): "Show export frames" on,
   * stepping through the export sample times of the previewed clip's
   * selection (or its manifest defaults when it is not selected) at its fps
   * (AC-PIX-030.2). Set a timing to override, e.g. continuous playback with
   * `previewTimingFor(selection, durationSec, false)`.
   */
  setPreviewTiming(timing: PreviewTiming | null): void;
  /**
   * Like `play`, with an explicit root-motion mode (default: the selection's
   * `rootMotion`, else `in-place`): loads (and retargets) the clip, then
   * starts the loop at clip time 0. A failure keeps the previous clip and
   * pose (REQ-ANM-022). After `dispose()` the result is `ENGINE_DISPOSED`.
   */
  playClip(
    clipId: ClipRef,
    rootMotion?: RootMotionMode,
  ): Promise<Result<void, EngineError>>;
  /**
   * Restarts the preview loop after `pause()` without reloading or
   * re-retargeting the clip: playback continues from the paused time, or from
   * the last `seek()` time (REQ-ANM-018).
   *
   * @returns `false` when there is nothing to resume (no clip played yet, or
   *   disposed); `true` when the loop runs (or will, once an exclusive
   *   operation ends).
   */
  resume(): boolean;
  /**
   * Lays the preview out in a viewport (REQ-PIX-031). The drawing buffer stays
   * the cell size; the host sizes the canvas to `cssW` x `cssH` CSS pixels
   * with `image-rendering: pixelated`. Call again after a resolution change
   * (or read {@link layout}).
   *
   * @param viewportCssW Available width in CSS pixels.
   * @param viewportCssH Available height in CSS pixels.
   * @param dpr `devicePixelRatio` (default 1).
   * @returns The cell size, the integer device scale and the CSS size.
   */
  resize(
    viewportCssW: number,
    viewportCssH: number,
    dpr?: number,
  ): PreviewResize;
  /** Poses and draws once at the current time (no-op while busy or unframed). */
  draw(): void;
  /** Reads the preview cell (tight RGBA8, top-left origin, REQ-PIX-029). */
  readCell(): Promise<Uint8ClampedArray>;
}

/** The previewed clip and how it was bound. */
interface PreviewClip {
  readonly ref: ClipRef;
  readonly rootMotion: RootMotionMode;
  /** Its selection, or a manifest-default one when it is not selected. */
  readonly selection: AnimationSelection;
  /** Whether {@link selection} comes from `settings.animations`. */
  readonly selected: boolean;
  readonly durationSec: number;
}

const DISPOSED_ERROR: EngineError = {
  code: ENGINE_DISPOSED,
  message: 'the renderer is disposed',
};

/** Label of the synthesized preview selection (not used by the export). */
const PREVIEW_LABEL = 'preview';

/** Index of a direction label in the full eight-direction order. */
function fullIndex(label: string): number {
  return (SCHEMA_DIRECTION_ORDER as readonly string[]).indexOf(label);
}

function validationError(
  issues: ReadonlyArray<{code: string; path: string; message: string}>,
): EngineError {
  const first = issues[0];
  return {
    code: first?.code ?? 'PIX_INVALID_SETTINGS',
    message:
      first === undefined
        ? 'invalid render settings'
        : `${first.path}: ${first.message}`,
    details: {issues: issues.map(i => ({...i}))},
  };
}

/**
 * Creates the renderer on a canvas: WebGPU, else WebGL2 (`backend` reports
 * which, REQ-GEN-002); neither, or a WebGL2 context that cannot render the
 * half-float scene MRT, yields `PIX_BACKEND_UNAVAILABLE`. No MSAA, pixel
 * ratio 1, drawing buffer = cell size (REQ-PIX-002/031).
 *
 * Playback: `play()` is the only place that reads wall-clock time (the
 * animation-loop timestamp, REQ-ANM-018 / P-04); `seek()`, `setCharacter()`
 * and the export draw deterministically at an absolute clip time.
 *
 * @param canvas Target canvas.
 * @param options Registry, backend, initial settings and test seams.
 * @returns The renderer, `PIX_BACKEND_UNAVAILABLE`, or the first issue of
 *   invalid initial settings.
 */
export async function createCharacterRenderer<
  R extends PreviewRenderer = WebGPURenderer,
>(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: CharacterRendererOptions<R>,
): Promise<Result<EngineCharacterRenderer<R>, EngineError>> {
  let settings: RenderSettings;
  if (options.settings === undefined) {
    settings = defaultRenderSettings();
  } else {
    const parsed = parseRenderSettings(options.settings);
    if (!parsed.ok) return {ok: false, error: validationError(parsed.issues)};
    settings = parsed.value;
  }

  const created = await createRendererBackend<R>(canvas, {
    forceWebGL: options.forceWebGL,
    factory: options.factory,
  });
  if (!created.ok) return created;
  const renderer = created.value.renderer;
  const backend: RendererBackend = created.value.backend;

  const preview = createPreviewScene(
    settings.resolution.width,
    settings.resolution.height,
  );
  const binder = new SettingsBinder();
  const pipelineFactory: PipelineFactory<R> =
    options.pipelineFactory ??
    (args =>
      createPixelPipeline({
        renderer: args.renderer as unknown as WebGPURenderer,
        scene: args.scene,
        camera: args.camera,
        binder: args.binder,
        // One compile mode for preview and export: same bytes (REQ-PIX-030).
        mode: 'export',
      }));
  const madePipeline = pipelineFactory({
    renderer,
    backend,
    scene: preview.scene,
    camera: preview.camera,
    binder,
  });
  if (!madePipeline.ok) {
    binder.dispose();
    renderer.dispose();
    return madePipeline;
  }
  const pipeline = madePipeline.value;
  const presenter: PreviewPresenter = (
    options.presenterFactory ??
    ((r: R, p: RendererPipeline) =>
      createCanvasPresenter(r as unknown as WebGPURenderer, p.cellTarget))
  )(renderer, pipeline);
  await pipeline.setRenderSettings(settings);

  const assembly = createCharacterAssembly({
    registry: options.registry,
    slots: options.slots,
    material: {binder, backend, mode: 'export'},
  });
  preview.stage.add(assembly.root);
  const target = createPipelineFrameTarget({
    pipeline,
    character: assembly,
    stage: preview.stage,
  });

  let timeSec = 0;
  let playing = false;
  let loopRunning = false;
  let timing: PreviewTiming | null = null;
  /** Wall-clock timestamp (ms) that corresponds to elapsed 0. */
  let startMs: number | null = null;
  /** Elapsed playback seconds at the last pause or seek. */
  let elapsedSec = 0;
  let disposed = false;
  let busyDepth = 0;
  let direction = 0;
  let framing: Framing | undefined;
  /** Framing inputs changed since {@link framing} was computed. */
  let framingDirty = true;
  let previewClip: PreviewClip | null = null;
  /** Whether the frame target is configured for the preview (vs an export). */
  let previewBound = false;
  let viewport = {cssW: 1, cssH: 1, dpr: 1};
  let layout = previewLayout(
    settings.resolution.width,
    settings.resolution.height,
    1,
    1,
    1,
  );

  // ---- exclusive lock (D5) ----
  let chain: Promise<void> = Promise.resolve();
  const acquire = async (): Promise<() => void> => {
    let release!: () => void;
    const next = new Promise<void>(resolve => {
      release = resolve;
    });
    const previous = chain;
    chain = previous.then(() => next);
    await previous;
    return release;
  };

  const stopLoop = (): void => {
    if (!loopRunning) return;
    loopRunning = false;
    startMs = null;
    renderer.setAnimationLoop(null);
  };

  const startLoop = (): void => {
    if (disposed || loopRunning || busyDepth > 0) return;
    loopRunning = true;
    startMs = null;
    renderer.setAnimationLoop(tick);
  };

  /**
   * Runs `fn` exclusively and redraws after. Draws are skipped meanwhile;
   * with `pauseLoop` (export) the loop also stops, so playback time does not
   * advance, and restarts after.
   */
  const exclusive = async <T>(
    fn: () => Promise<T>,
    pauseLoop = false,
  ): Promise<T> => {
    const release = await acquire();
    busyDepth++;
    if (pauseLoop) stopLoop();
    try {
      return await fn();
    } finally {
      busyDepth--;
      release();
      if (!disposed && busyDepth === 0) {
        if (playing) startLoop();
        else draw();
      }
    }
  };

  // ---- preview selection, timing and binding ----
  const selectionFor = (
    ref: ClipRef,
  ): {selection: AnimationSelection; selected: boolean} | null => {
    const selected = settings.animations.find(a => a.clipId === ref);
    if (selected !== undefined) return {selection: selected, selected: true};
    const entry = options.registry.clipEntry(ref);
    if (entry === undefined) return null;
    const used = new Set(settings.animations.map(a => a.label));
    let label = PREVIEW_LABEL;
    for (let i = 2; used.has(label); i++) label = `${PREVIEW_LABEL}-${i}`;
    const frameCount = entry.defaultFrameCount;
    // REQ-ANM-009: fit timing defaults fps to round(N / D), clamped to 1..60.
    const fps = Math.min(
      60,
      Math.max(1, Math.round(frameCount / Math.max(entry.durationSec, 1e-9))),
    );
    return {
      selection: {clipId: ref, label, frameCount, fps, loop: entry.loop},
      selected: false,
    };
  };

  /** Animations the preview framing covers (REQ-PIX-030). */
  const framingAnimations = (): AnimationSelection[] => {
    const out = [...settings.animations];
    if (previewClip !== null && !previewClip.selected) {
      out.push(previewClip.selection);
    }
    return out;
  };

  /** Settings used to configure the frame target for the preview: all eight directions. */
  const previewTargetSettings = (): RenderSettings => ({
    ...settings,
    directions: 8,
    mirrorWest: false,
  });

  const referenceTime = (clip: PreviewClip): number =>
    computeSampleTimes(clip.selection, clip.durationSec).times[0] ?? 0;

  /** Default preview timing of the previewed clip (cached by {@link bindPreview}). */
  let clipTiming: PreviewTiming = {
    showExportFrames: false,
    durationSec: 0,
    loop: true,
  };
  /** Per full direction index: the direction rendered and the mirror axis (`mirrorWest`). */
  const shownIndex: number[] = [0, 1, 2, 3, 4, 5, 6, 7];
  const shownMirror: Array<number | null> = new Array<number | null>(8).fill(
    null,
  );

  /** Fills `shownIndex` / `shownMirror` for the applied settings and framing. */
  const updateShownDirections = (): void => {
    const labels = activeDirectionLabels(settings);
    for (let d = 0; d < SCHEMA_DIRECTION_ORDER.length; d++) {
      shownIndex[d] = d;
      shownMirror[d] = null;
      if (!settings.mirrorWest || framing === undefined) continue;
      const active = labels.indexOf(
        SCHEMA_DIRECTION_ORDER[d] as DirectionLabel,
      );
      const source =
        active < 0 ? null : mirrorSourceDirection(settings, active);
      const sourceLabel = source === null ? undefined : labels[source];
      if (sourceLabel === undefined) continue;
      shownIndex[d] = fullIndex(sourceLabel);
      shownMirror[d] = 2 * framing.pivotPx[0] - 1;
    }
  };

  /**
   * Configures the frame target for the preview (after an export, a reframe
   * or a settings change) and caches the per-draw lookups, so a draw
   * allocates nothing of its own.
   */
  const bindPreview = (): void => {
    target.configure(previewTargetSettings());
    if (framing !== undefined) target.setFraming(framing);
    if (previewClip !== null) {
      target.setRootReference(referenceTime(previewClip));
      clipTiming = previewTimingFor(
        previewClip.selection,
        previewClip.durationSec,
      );
    }
    updateShownDirections();
    previewBound = true;
  };

  /** Rebinds the previewed clip on the character after an export/reframe changed it. */
  const restorePreviewClip = async (): Promise<void> => {
    if (previewClip === null) return;
    const set = await target.setClip(previewClip.ref, previewClip.rootMotion);
    if (!set.ok && !disposed) options.onError?.(set.error);
  };

  /** Releases the frame target before an export/reframe configures it. */
  const unbindPreview = (): void => {
    target.restore();
    previewBound = false;
  };

  /** Rest-pose framing (nothing selected or playing). */
  const restFraming = (s: RenderSettings): Framing => {
    target.configure(s);
    try {
      target.pose(0, 0);
      const corners = target.skinnedCorners();
      const union = createUnionBounds(cameraElevationDeg(s.camera));
      activeDirectionLabels(s).forEach((label, d) => {
        union.add('rest', d, corners, stageYawRad(label));
      });
      return computeFraming(union.boxes(), s);
    } finally {
      target.restore();
    }
  };

  /** Recomputes the preview framing (exclusive section only). */
  const reframe = async (): Promise<Result<void, EngineError>> => {
    unbindPreview();
    const s: RenderSettings = {...settings, animations: framingAnimations()};
    let result: Result<void, EngineError> = {ok: true, value: undefined};
    if (s.animations.length === 0) {
      framing = restFraming(s);
      framingDirty = false;
    } else {
      const prepared = await samplePrepare(target, s);
      if (prepared.ok) {
        framing = prepared.value.framing;
        framingDirty = false;
      } else {
        result = prepared;
      }
      await restorePreviewClip();
    }
    if (!disposed) bindPreview();
    return result;
  };

  const reframeIfDirty = async (): Promise<Result<void, EngineError>> =>
    framingDirty ? reframe() : {ok: true, value: undefined};

  const activeTiming = (): PreviewTiming => timing ?? clipTiming;

  const draw = (): void => {
    if (disposed || busyDepth > 0 || framing === undefined) return;
    if (!previewBound) bindPreview();
    target.pose(timeSec, shownIndex[direction] ?? direction);
    pipeline.render();
    presenter.present(shownMirror[direction] ?? null);
  };

  function tick(nowMs: number): void {
    if (startMs === null) startMs = nowMs - elapsedSec * 1000;
    elapsedSec = (nowMs - startMs) / 1000;
    timeSec = previewTimeAt(activeTiming(), elapsedSec);
    draw();
  }

  // ---- operations ----
  const playClip = (
    clipId: ClipRef,
    rootMotion?: RootMotionMode,
  ): Promise<Result<void, EngineError>> =>
    exclusive(async () => {
      if (disposed) return {ok: false, error: DISPOSED_ERROR};
      const found = selectionFor(clipId);
      const mode =
        rootMotion ?? found?.selection.rootMotion ?? ('in-place' as const);
      if (!previewBound) bindPreview();
      const result = await target.setClip(clipId, mode);
      if (disposed) {
        return result.ok
          ? {
              ok: false,
              error: {
                code: ENGINE_DISPOSED,
                message: 'playClip: the renderer is disposed',
              },
            }
          : result;
      }
      if (!result.ok) {
        options.onError?.(result.error);
        // The previous clip stays bound (REQ-ANM-022).
        return result;
      }
      const durationSec = assembly.clipDurationSec ?? 0;
      const previous = previewClip;
      previewClip = {
        ref: clipId,
        rootMotion: mode,
        selection: found?.selection ?? {
          clipId,
          label: PREVIEW_LABEL,
          frameCount: 1,
          fps: 1,
          loop: true,
        },
        selected: found?.selected ?? false,
        durationSec,
      };
      if (!previewClip.selected || (previous !== null && !previous.selected)) {
        framingDirty = true;
      }
      const framed = await reframeIfDirty();
      if (disposed) return {ok: false, error: DISPOSED_ERROR};
      if (!framed.ok) options.onError?.(framed.error);
      bindPreview();
      timeSec = 0;
      elapsedSec = 0;
      playing = true;
      return {ok: true, value: undefined};
    });

  const self: EngineCharacterRenderer<R> = {
    backend,
    renderer,
    preview,
    assembly,
    binder,
    get renderSettings() {
      return settings;
    },
    get framing() {
      return framing;
    },
    get cellTarget() {
      return pipeline.cellTarget;
    },
    get pipelineStats() {
      return pipeline.stats;
    },
    get layout() {
      return layout;
    },
    get timeSec() {
      return timeSec;
    },
    get playing() {
      return playing;
    },
    get busy() {
      return busyDepth > 0;
    },

    setCharacter(spec: CharacterSpec) {
      return exclusive(async () => {
        if (disposed) return {ok: false, error: DISPOSED_ERROR};
        const result = await assembly.setCharacter(spec);
        if (!result.ok || disposed) return result;
        // Parts and anatomy change the bounds.
        framingDirty = true;
        const framed = await reframeIfDirty();
        if (!framed.ok && !disposed) options.onError?.(framed.error);
        return result;
      });
    },

    play(clipId: ClipRef): void {
      void playClip(clipId);
    },

    playClip,

    resume(): boolean {
      if (disposed || previewClip === null) return false;
      playing = true;
      startLoop();
      return true;
    },

    pause(): void {
      playing = false;
      stopLoop();
    },

    seek(t: number): void {
      timeSec = t;
      elapsedSec = t;
      startMs = null;
      draw();
    },

    setDirection(index: number): void {
      preview.setDirection(index); // validates; turns the stage right away
      direction = index;
      if (!loopRunning) draw();
    },

    setPreviewTiming(next: PreviewTiming | null): void {
      timing = next;
    },

    setRenderSettings(next: RenderSettings) {
      const parsed = parseRenderSettings(next);
      if (!parsed.ok) {
        return Promise.resolve({
          ok: false as const,
          error: validationError(parsed.issues),
        });
      }
      return exclusive(async () => {
        if (disposed) return {ok: false, error: DISPOSED_ERROR};
        const diff = await pipeline.setRenderSettings(parsed.value);
        settings = parsed.value;
        if (diff.resize) {
          layout = previewLayout(
            settings.resolution.width,
            settings.resolution.height,
            viewport.cssW,
            viewport.cssH,
            viewport.dpr,
          );
        }
        if (previewClip !== null) {
          const found = selectionFor(previewClip.ref);
          if (found !== null) {
            if (found.selected !== previewClip.selected) framingDirty = true;
            previewClip = {...previewClip, ...found};
          }
        }
        if (diff.reframe) framingDirty = true;
        if (framing === undefined && assembly.body === null)
          return {
            ok: true,
            value: undefined,
          };
        const framed = await reframeIfDirty();
        if (!disposed) bindPreview();
        return framed;
      });
    },

    prepareFrames(
      next?: RenderSettings,
      prepareOptions: PrepareFramesOptions = {},
    ): Promise<Result<PreparedFrames, EngineError>> {
      let s = settings;
      if (next !== undefined) {
        const parsed = parseRenderSettings(next);
        if (!parsed.ok) {
          return Promise.resolve({
            ok: false,
            error: validationError(parsed.issues),
          });
        }
        s = parsed.value;
      }
      return exclusive(async () => {
        if (disposed) return {ok: false, error: DISPOSED_ERROR};
        unbindPreview();
        try {
          return await samplePrepare(target, s, prepareOptions);
        } finally {
          await restorePreviewClip();
          if (!disposed) bindPreview();
        }
      }, true);
    },

    renderFrames(
      prepared: PreparedFrames,
      renderOptions: RenderFramesOptions = {},
    ): AsyncGenerator<RenderedFrame, void, undefined> {
      return (async function* exportFrames() {
        const release = await acquire();
        busyDepth++;
        stopLoop();
        try {
          if (disposed) throw new FrameSamplerError(DISPOSED_ERROR);
          unbindPreview();
          // The export settings first (REQ-PIX-001: the frames have their size).
          await pipeline.setRenderSettings(prepared.settings);
          yield* sampleRender(target, prepared, renderOptions);
        } finally {
          if (!disposed) {
            await pipeline.setRenderSettings(settings);
            target.restore();
            await restorePreviewClip();
            if (!disposed) bindPreview();
          }
          busyDepth--;
          release();
          if (!disposed && busyDepth === 0) {
            if (playing) startLoop();
            else draw();
          }
        }
      })();
    },

    resize(viewportCssW: number, viewportCssH: number, dpr = 1): PreviewResize {
      viewport = {cssW: viewportCssW, cssH: viewportCssH, dpr};
      layout = previewLayout(
        settings.resolution.width,
        settings.resolution.height,
        viewportCssW,
        viewportCssH,
        dpr,
      );
      return layout;
    },

    draw,

    readCell(): Promise<Uint8ClampedArray> {
      return pipeline.read();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      playing = false;
      stopLoop();
      assembly.dispose();
      preview.stage.clear();
      presenter.dispose();
      pipeline.dispose();
      binder.dispose();
      renderer.dispose();
    },
  };
  return {ok: true, value: self};
}
