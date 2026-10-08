/**
 * The M1 character renderer (architecture 3.6, spec 000 REQ-GEN-001/002,
 * spec 001 REQ-CMP-033, spec 004 REQ-ANM-018): backend selection, a preview
 * scene, diff-based assembly and the preview playback loop. The pixel
 * pipeline (`RenderPipeline`, spec 003) arrives in M2; the methods of the full
 * contract that are not listed in {@link CharacterRenderer} do not exist yet.
 */
import type {Camera, Scene} from 'three';
import type {WebGPURenderer} from 'three/webgpu';
import type {CharacterSpec, ClipRef, SlotRegistry} from '@csg/parts-schema';
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
  CharacterRenderer,
  RendererBackend,
  RendererOptions,
} from '../contracts/renderer';
import {createRendererBackend} from './backend';
import type {InitializableRenderer, RendererFactory} from './backend';
import {previewTimeAt} from './preview-clock';
import type {PreviewTiming} from './preview-clock';
import {createPreviewScene} from './preview-scene';
import type {PreviewScene} from './preview-scene';

/** The renderer calls the preview needs (`WebGPURenderer` fits). */
export interface PreviewRenderer extends InitializableRenderer {
  render(scene: Scene, camera: Camera): unknown;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setAnimationLoop(callback: ((timeMs: number) => void) | null): unknown;
}

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
  /**
   * Called with the error when `play()` / `playClip()` cannot load or retarget
   * its clip. Never called after `dispose()`.
   */
  readonly onError?: (error: EngineError) => void;
}

/** The engine's M1 renderer: the {@link CharacterRenderer} contract plus preview controls. */
export interface EngineCharacterRenderer<
  R extends PreviewRenderer = WebGPURenderer,
> extends CharacterRenderer {
  /** The three renderer. */
  readonly renderer: R;
  /** Scene, camera and direction stage. */
  readonly preview: PreviewScene;
  /** The assembled character. */
  readonly assembly: CharacterAssembly;
  /** Clip time last drawn, in seconds. */
  readonly timeSec: number;
  /** Whether the preview loop runs. */
  readonly playing: boolean;
  /**
   * Preview timing (REQ-ANM-018). `null` (default): continuous at the clip's
   * duration and loop flag. Set it from the clip's `AnimationSelection` with
   * `previewTimingFor` to step through the export frames.
   */
  setPreviewTiming(timing: PreviewTiming | null): void;
  /**
   * Like `play`, with an explicit root-motion mode (default `in-place`): loads
   * (and retargets) the clip, then starts the loop at clip time 0. A failure
   * keeps the previous clip and pose (REQ-ANM-022). After `dispose()` the
   * result is `ENGINE_DISPOSED`.
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
   *   disposed); `true` when the loop runs.
   */
  resume(): boolean;
  /** Resizes the drawing buffer (CSS pixels / `previewScale`). */
  resize(width: number, height: number): void;
  /** Poses and draws once at the current time. */
  draw(): void;
}

function canvasSize(canvas: HTMLCanvasElement | OffscreenCanvas): {
  width: number;
  height: number;
} {
  return {width: canvas.width, height: canvas.height};
}

/**
 * Creates the M1 renderer on a canvas: WebGPU, else WebGL2
 * (`backend` reports which, REQ-GEN-002); neither yields
 * `PIX_BACKEND_UNAVAILABLE`. No MSAA, pixel ratio 1, drawing buffer
 * `floor(size / previewScale)`.
 *
 * Playback: `play()` is the only place that reads wall-clock time (the
 * animation-loop timestamp, REQ-ANM-018 / P-04); `seek()` and
 * `setCharacter()` draw deterministically at an absolute clip time.
 *
 * @param canvas Target canvas.
 * @param options Registry, backend and preview options.
 * @returns The renderer or `PIX_BACKEND_UNAVAILABLE`.
 */
export async function createCharacterRenderer<
  R extends PreviewRenderer = WebGPURenderer,
>(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: CharacterRendererOptions<R>,
): Promise<Result<EngineCharacterRenderer<R>, EngineError>> {
  const scale = Math.max(1, Math.floor(options.previewScale ?? 1));
  const created = await createRendererBackend<R>(canvas, {
    forceWebGL: options.forceWebGL,
    factory: options.factory,
  });
  if (!created.ok) return created;
  const renderer = created.value.renderer;
  const backend: RendererBackend = created.value.backend;

  const initial = canvasSize(canvas);
  const preview = createPreviewScene(
    Math.max(1, Math.floor(initial.width / scale)),
    Math.max(1, Math.floor(initial.height / scale)),
  );
  const assembly = createCharacterAssembly({
    registry: options.registry,
    slots: options.slots,
  });
  preview.stage.add(assembly.root);

  let timeSec = 0;
  let playing = false;
  let timing: PreviewTiming | null = null;
  /** Wall-clock timestamp (ms) that corresponds to elapsed 0. */
  let startMs: number | null = null;
  /** Elapsed playback seconds at the last pause or seek. */
  let elapsedSec = 0;
  let disposed = false;

  const resize = (width: number, height: number): void => {
    const w = Math.max(1, Math.floor(width / scale));
    const h = Math.max(1, Math.floor(height / scale));
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    preview.setAspect(w, h);
  };
  resize(initial.width, initial.height);

  const draw = (): void => {
    if (disposed) return;
    assembly.evaluate(timeSec);
    renderer.render(preview.scene, preview.camera);
  };

  /** Duration and loop flag of the clip being played. */
  let currentClip: {durationSec: number; loop: boolean} | null = null;

  const activeTiming = (): PreviewTiming =>
    timing ?? {
      showExportFrames: false,
      durationSec: currentClip?.durationSec ?? 0,
      loop: currentClip?.loop ?? true,
    };

  const tick = (nowMs: number): void => {
    if (startMs === null) startMs = nowMs - elapsedSec * 1000;
    elapsedSec = (nowMs - startMs) / 1000;
    timeSec = previewTimeAt(activeTiming(), elapsedSec);
    draw();
  };

  /** Whether a clip was bound by `playClip` (what `resume()` continues). */
  let hasClip = false;

  const startLoop = (): void => {
    playing = true;
    startMs = null;
    renderer.setAnimationLoop(tick);
  };

  const playClip = async (
    clipId: ClipRef,
    rootMotion: RootMotionMode = 'in-place',
  ): Promise<Result<void, EngineError>> => {
    const result = await assembly.setClip(clipId, rootMotion);
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
      return result;
    }
    const entry = options.registry.clipEntry(clipId);
    currentClip =
      entry === undefined
        ? null
        : {durationSec: entry.durationSec, loop: entry.loop};
    hasClip = true;
    elapsedSec = 0;
    startLoop();
    return result;
  };

  const self: EngineCharacterRenderer<R> = {
    backend,
    renderer,
    preview,
    assembly,
    get timeSec() {
      return timeSec;
    },
    get playing() {
      return playing;
    },

    async setCharacter(spec: CharacterSpec) {
      const result = await assembly.setCharacter(spec);
      if (result.ok && !playing) draw();
      return result;
    },

    play(clipId: ClipRef): void {
      void playClip(clipId);
    },

    playClip,

    resume(): boolean {
      if (disposed || !hasClip) return false;
      if (!playing) startLoop();
      return true;
    },

    pause(): void {
      playing = false;
      startMs = null;
      renderer.setAnimationLoop(null);
    },

    seek(t: number): void {
      timeSec = t;
      elapsedSec = t;
      startMs = null;
      draw();
    },

    setDirection(index: number): void {
      preview.setDirection(index);
      if (!playing) draw();
    },

    setPreviewTiming(next: PreviewTiming | null): void {
      timing = next;
    },

    resize(width: number, height: number): void {
      resize(width, height);
      if (!playing) draw();
    },

    draw,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      playing = false;
      renderer.setAnimationLoop(null);
      assembly.dispose();
      preview.stage.clear();
      renderer.dispose();
    },
  };
  return {ok: true, value: self};
}
