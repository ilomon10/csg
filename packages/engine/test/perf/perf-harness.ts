/**
 * Shared helpers of the M2-19 performance suite (`packages/engine/test/perf/*.gpu.ts`, run by
 * `pnpm test:perf`). Not a test file.
 *
 * - The P-07 perf character: the default Quaternius character with 8 equipped parts (hair,
 *   eyebrows, beard, torso, arms, legs, feet, accessory) on the built packs of `assets/packs`.
 * - A character renderer on its own canvas, with the pipeline's `render()` / `read()` timed.
 * - `gpuIdle()`: resolves when the GPU has finished the submitted work, without
 *   requestAnimationFrame (WebGPU `onSubmittedWorkDone`, WebGL2 fence polled on a message channel).
 * - Percentiles and the JSON report (`test-results/perf/<name>.json`, written from Node).
 *
 * Budgets are reported everywhere and enforced only with `CSG_PERF_GATE=1` on the reference
 * machine (m2-plan 3 "Perf"; the golden container is a software rasterizer, report only).
 */
import {
  DEFAULT_CHARACTER_DATA,
  clipManifestSchema,
  loadSlotRegistry,
  partManifestSchema,
} from '@csg/parts-schema';
import type {CharacterSpec, SlotRegistry} from '@csg/parts-schema';
import {commands} from 'vitest/browser';
import * as THREE from 'three/webgpu';
import type {AssemblyRegistry} from '../../src/composition/character-assembly';
import type {RenderSettings} from '../../src/contracts/pipeline';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import {createPaletteLutWorker} from '../../src/pipeline/palette-lut';
import type {PaletteLutWorker} from '../../src/pipeline/palette-lut';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {createCanvasPresenter} from '../../src/renderer/canvas-presenter';
import {previewTimingFor} from '../../src/renderer/preview-clock';
import {createCharacterRenderer} from '../../src/renderer/character-renderer';
import type {EngineCharacterRenderer} from '../../src/renderer/character-renderer';
import {currentBackend, nodeEnv} from '../gpu/harness';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: {query: '?url'; import: 'default'; eager: true},
    ): Record<string, string>;
  }
}

const PACK_URLS = import.meta.glob('../../../../assets/packs/*/*.json', {
  query: '?url',
  import: 'default',
  eager: true,
});
const SLOT_URLS = import.meta.glob('../../../parts-schema/data/slots.json', {
  query: '?url',
  import: 'default',
  eager: true,
});

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** The registry of the built packs plus the slot registry. */
export async function loadPackRegistry(): Promise<{
  registry: AssemblyRegistry;
  slots: SlotRegistry;
}> {
  const registry = createAssetRegistry();
  const urls = Object.entries(PACK_URLS).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [path, url] of urls) {
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    if (path.endsWith('/manifest.json')) {
      registry.registerPack(partManifestSchema.parse(await json(url)), base);
    } else if (path.endsWith('/clips.json')) {
      registry.registerClips(clipManifestSchema.parse(await json(url)), base);
    }
  }
  const slotsUrl = Object.values(SLOT_URLS)[0];
  if (slotsUrl === undefined) throw new Error('slots.json not served');
  const slots = loadSlotRegistry(await json(slotsUrl));
  if (!slots.ok) throw new Error('slots.json invalid');
  return {registry, slots: slots.value as SlotRegistry};
}

/** The P-07 perf character: the default character with 8 equipped parts besides the body. */
export function perfCharacter(): CharacterSpec {
  const base = DEFAULT_CHARACTER_DATA.character as CharacterSpec;
  return {
    ...base,
    parts: {
      ...base.parts,
      beard: {ref: 'builtin:quaternius-ubc/beard-full'},
      accessory: {ref: 'builtin:quaternius-outfits/male-ranger-pauldron'},
    },
  };
}

/** Number of equipped parts besides the body. */
export function equippedPartCount(spec: CharacterSpec): number {
  return Object.keys(spec.parts).length;
}

/** The four P-07 clips. */
export const PERF_CLIPS = [
  'builtin:quaternius-ual/idle',
  'builtin:quaternius-ual/walk',
  'builtin:quaternius-ual/jog',
  'builtin:quaternius-ual/sword-attack',
] as const;

/** Running timers of the instrumented pipeline. */
export interface PipelineTimers {
  renderCalls: number;
  renderMs: number;
  readCalls: number;
  readMs: number;
  /** CPU ms of each `render()` call since the last {@link resetTimers}. */
  readonly renderSamples: number[];
}

/** Clears the timers. */
export function resetTimers(t: PipelineTimers): void {
  t.renderCalls = 0;
  t.renderMs = 0;
  t.readCalls = 0;
  t.readMs = 0;
  t.renderSamples.length = 0;
}

/** A renderer with its timers and (WebGPU) presentation stand-in target. */
export interface PerfRenderer {
  readonly renderer: EngineCharacterRenderer;
  readonly timers: PipelineTimers;
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

/** Options of {@link createPerfRenderer}. */
export interface PerfRendererOptions {
  readonly settings: RenderSettings;
  /**
   * Palette LUT worker factory (default: {@link bundledPaletteLutWorker}, as the editor injects
   * it, REQ-GEN-014); `null` builds LUTs on the main thread.
   */
  readonly paletteLutWorker?: (() => PaletteLutWorker) | null;
}

/**
 * The engine's palette LUT worker, started the way a host does (REQ-GEN-014: the engine never
 * constructs a `Worker` itself, so without this factory the renderer builds LUTs on the main
 * thread and AC-PIX-021.2 cannot hold).
 */
export function bundledPaletteLutWorker(): PaletteLutWorker {
  return createPaletteLutWorker({
    createWorker: () =>
      new Worker(
        new URL('../../src/pipeline/palette-lut.worker.ts', import.meta.url),
        {type: 'module'},
      ),
  });
}

/**
 * Creates a character renderer for the current backend with the perf character set. The
 * pipeline's `render()` and `read()` are timed. On WebGPU the presenter draws into a cell-sized
 * target instead of the canvas (vitest browser mode drops the WebGPU instance when presenting to a
 * canvas, see `character-renderer.gpu.ts`); the work per frame is the same draw call.
 */
export async function createPerfRenderer(
  options: PerfRendererOptions,
): Promise<PerfRenderer> {
  const {registry, slots} = await loadPackRegistry();
  const canvas = document.createElement('canvas');
  canvas.width = options.settings.resolution.width;
  canvas.height = options.settings.resolution.height;
  document.body.appendChild(canvas);
  const timers: PipelineTimers = {
    renderCalls: 0,
    renderMs: 0,
    readCalls: 0,
    readMs: 0,
    renderSamples: [],
  };
  let presented: THREE.RenderTarget | null = null;
  const created = await createCharacterRenderer(canvas, {
    registry,
    slots,
    forceWebGL: currentBackend() === 'webgl2',
    settings: options.settings,
    paletteLutWorker:
      options.paletteLutWorker === undefined
        ? bundledPaletteLutWorker
        : options.paletteLutWorker,
    pipelineFactory: args => {
      const made = createPixelPipeline({
        renderer: args.renderer as unknown as THREE.WebGPURenderer,
        scene: args.scene,
        camera: args.camera,
        binder: args.binder,
        mode: 'export',
        buildPaletteLut: args.buildPaletteLut,
      });
      if (!made.ok) return made;
      const p = made.value;
      const render = p.render.bind(p);
      const read = p.read.bind(p);
      p.render = () => {
        const t0 = performance.now();
        render();
        const dt = performance.now() - t0;
        timers.renderCalls++;
        timers.renderMs += dt;
        timers.renderSamples.push(dt);
      };
      p.read = async () => {
        const t0 = performance.now();
        const out = await read();
        timers.readCalls++;
        timers.readMs += performance.now() - t0;
        return out;
      };
      return {ok: true, value: p};
    },
    ...(currentBackend() === 'webgpu'
      ? {
          presenterFactory: (r, p) => {
            presented = new THREE.RenderTarget(
              options.settings.resolution.width,
              options.settings.resolution.height,
              {
                type: THREE.UnsignedByteType,
                format: THREE.RGBAFormat,
                colorSpace: THREE.NoColorSpace,
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                generateMipmaps: false,
                depthBuffer: false,
                samples: 0,
              },
            );
            return createCanvasPresenter(r, p.cellTarget, {output: presented});
          },
        }
      : {}),
  });
  if (!created.ok) throw new Error(created.error.message);
  const renderer = created.value;
  const set = await renderer.setCharacter(perfCharacter());
  if (!set.ok) throw new Error(set.error.message);
  return {
    renderer,
    timers,
    canvas,
    dispose() {
      renderer.dispose();
      (presented as THREE.RenderTarget | null)?.dispose();
      canvas.remove();
    },
  };
}

/** Yields to the event loop without requestAnimationFrame or timer clamping. */
export function yieldTask(): Promise<void> {
  return new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/**
 * Resolves when the GPU has finished all work submitted so far (measurement only).
 * WebGPU: `queue.onSubmittedWorkDone()`. WebGL2: a fence polled once per task.
 */
export async function gpuIdle(r: THREE.WebGPURenderer): Promise<void> {
  const backend = r.backend as unknown as {
    device?: GPUDevice;
    gl?: WebGL2RenderingContext;
  };
  if (backend.device !== undefined) {
    await backend.device.queue.onSubmittedWorkDone();
    return;
  }
  const gl = backend.gl;
  if (gl === undefined) throw new Error('gpuIdle: unknown backend');
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (sync === null) throw new Error('gpuIdle: fenceSync failed');
  gl.flush();
  try {
    for (;;) {
      const res = gl.clientWaitSync(sync, 0, 0);
      if (res === gl.WAIT_FAILED) throw new Error('gpuIdle: WAIT_FAILED');
      if (res !== gl.TIMEOUT_EXPIRED) return;
      await yieldTask();
    }
  } finally {
    gl.deleteSync(sync);
  }
}

/** Percentile (nearest rank) of samples; NaN for none. */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank] ?? Number.NaN;
}

/** Rounds to 0.1 ms for reports. */
export const ms = (v: number): number => Math.round(v * 10) / 10;

/** Summary statistics of samples (ms). */
export function summary(samples: readonly number[]): {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
} {
  const n = samples.length;
  const mean = n === 0 ? Number.NaN : samples.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    mean: ms(mean),
    p50: ms(percentile(samples, 50)),
    p95: ms(percentile(samples, 95)),
    max: ms(n === 0 ? Number.NaN : Math.max(...samples)),
  };
}

/** Environment facts recorded in every report. */
export async function reportEnvironment(
  r: THREE.WebGPURenderer,
): Promise<Record<string, unknown>> {
  const env = await nodeEnv();
  const backend = r.backend as unknown as {
    gl?: WebGL2RenderingContext;
    isWebGPUBackend?: boolean;
  };
  let adapter: Record<string, unknown> = {};
  if (backend.isWebGPUBackend === true) {
    const gpu = (navigator as unknown as {gpu: GPU}).gpu;
    const a = await gpu.requestAdapter();
    adapter = {
      vendor: a?.info.vendor,
      architecture: a?.info.architecture,
      description: a?.info.description,
    };
  } else if (backend.gl !== undefined) {
    const gl = backend.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    adapter = {
      renderer: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    };
  }
  return {
    backend: currentBackend(),
    environment: env.canonical ? 'container (software rasterizer)' : 'host',
    image: env.image,
    gated: env.perfGate,
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
    adapter,
  };
}

/** Writes `test-results/perf/<name>-<backend>.json`. */
export async function writePerfReport(
  name: string,
  report: Record<string, unknown>,
): Promise<void> {
  const file = `${name}-${currentBackend()}.json`;
  console.log(`[perf] ${file} ${JSON.stringify(report)}`);
  await commands.csgWriteReport(file, report);
}

/** Whether budgets fail the test (`CSG_PERF_GATE=1`). */
export async function perfGate(): Promise<boolean> {
  return (await nodeEnv()).perfGate;
}

/**
 * Plays `clipId` continuously through the renderer's own animation loop for `durationMs` (after
 * a 1 s warm-up that compiles the pipelines) and returns the intervals between drawn preview
 * frames, the CPU time of each draw and the number of draws (AC-PIX-032.1).
 */
export async function runPreviewLoop(
  p: PerfRenderer,
  clipId: string,
  durationMs: number,
): Promise<{intervals: number[]; drawCpu: number[]; frames: number}> {
  const r = p.renderer;
  const played = await r.playClip(clipId);
  if (!played.ok) throw new Error(played.error.message);
  // Continuous playback: a new pose every frame (the worst case for the preview).
  r.setPreviewTiming(
    previewTimingFor(
      {frameCount: 8, fps: 8, loop: true},
      r.assembly.clipDurationSec ?? 1,
      false,
    ),
  );
  // Warm up (first frames compile pipelines), then measure.
  await new Promise(resolve => setTimeout(resolve, 1000));
  resetTimers(p.timers);
  const drawTimes: number[] = [];
  const pipeline = r as unknown as {pipelineStats: {frames: number}};
  let lastFrames = pipeline.pipelineStats.frames;
  const start = performance.now();
  await new Promise<void>(resolve => {
    const tick = (now: number) => {
      const frames = pipeline.pipelineStats.frames;
      if (frames !== lastFrames) {
        drawTimes.push(now);
        lastFrames = frames;
      }
      if (performance.now() - start >= durationMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  r.pause();
  const intervals: number[] = [];
  for (let i = 1; i < drawTimes.length; i++) {
    intervals.push((drawTimes[i] ?? 0) - (drawTimes[i - 1] ?? 0));
  }
  return {
    intervals,
    drawCpu: [...p.timers.renderSamples],
    frames: p.timers.renderCalls,
  };
}

/** Draw + wait for the GPU, back to back: the serial cost of one preview frame (`n` samples). */
export async function serialFrameCost(
  p: PerfRenderer,
  n: number,
): Promise<number[]> {
  const r = p.renderer;
  const duration = r.assembly.clipDurationSec ?? 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    r.seek(((i * duration) / n) % duration); // draws once
    await gpuIdle(r.renderer);
    out.push(performance.now() - t0);
  }
  return out;
}

/** Median (nearest rank, lower middle) of samples; NaN for none. */
export function median(samples: readonly number[]): number {
  return percentile(samples, 50);
}
