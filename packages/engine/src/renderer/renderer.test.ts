import {describe, expect, it} from 'vitest';
import {RenderTarget, Vector3} from 'three';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {computeSampleTimes} from '../animation/sample-times';
import {
  createTestRegistry,
  fixtureSpec,
  ref,
} from '../composition/assembly-test-env';
import {ENGINE_DISPOSED} from '../composition/character-assembly';
import {backendOf, createRendererBackend} from './backend';
import type {RendererParameters} from './backend';
import {createCharacterRenderer} from './character-renderer';
import type {
  PipelineFactory,
  PreviewRenderer,
  RendererPipeline,
} from './character-renderer';
import type {PreviewPresenter} from './canvas-presenter';
import type {Framing} from '../contracts/pipeline';
import {EXP_CANCELLED, FrameSamplerError} from '../sampler/frame-sampler';
import {diffRenderSettings} from '../pipeline/settings-binder';
import {previewLayout} from './preview-layout';
import {previewTimeAt, previewTimingFor} from './preview-clock';
import {
  DIRECTION_ORDER,
  MODEL_FORWARD_YAW_OFFSET_RAD,
  directionYaw,
  stageYaw,
} from './preview-scene';

/** Failure modes of {@link FakeRenderer}. */
interface Behaviour {
  readonly initFails?: boolean;
  /** Simulates three's own WebGPU → WebGL2 swap inside init(). */
  readonly fallsBackInInit?: boolean;
}

/** A stand-in for `WebGPURenderer` (Node has no GPU). */
class FakeRenderer implements PreviewRenderer {
  backend: object;
  readonly calls: string[] = [];
  loop: ((timeMs: number) => void) | null = null;
  disposed = false;
  constructor(
    readonly parameters: RendererParameters,
    private readonly behaviour: Behaviour = {},
  ) {
    this.backend = parameters.forceWebGL
      ? {isWebGLBackend: true}
      : {isWebGPUBackend: true};
  }
  async init(): Promise<this> {
    this.calls.push('init');
    if (this.behaviour.initFails === true) throw new Error('no adapter');
    if (this.behaviour.fallsBackInInit === true) {
      this.backend = {isWebGLBackend: true};
    }
    return this;
  }
  setPixelRatio(ratio: number): void {
    this.calls.push(`pixelRatio:${ratio}`);
  }
  setSize(width: number, height: number): void {
    this.calls.push(`size:${width}x${height}`);
  }
  setAnimationLoop(callback: ((timeMs: number) => void) | null): void {
    this.loop = callback;
  }
  dispose(): void {
    this.disposed = true;
  }
}

const CANVAS = {width: 256, height: 256} as unknown as OffscreenCanvas;

function factoryOf(behaviour: (forceWebGL: boolean) => Behaviour) {
  const made: FakeRenderer[] = [];
  return {
    made,
    factory: (p: RendererParameters) => {
      const r = new FakeRenderer(p, behaviour(p.forceWebGL));
      made.push(r);
      return r;
    },
  };
}

describe('renderer backend (REQ-GEN-001/002)', () => {
  it('AC-GEN-002.1: reports webgpu when the WebGPU backend initializes', async () => {
    const {factory, made} = factoryOf(() => ({}));
    const result = await createRendererBackend(CANVAS, {factory});
    expect(result.ok && result.value.backend).toBe('webgpu');
    expect(made).toHaveLength(1);
    expect(made[0]?.parameters).toMatchObject({
      forceWebGL: false,
      antialias: false,
    });
  });

  it('REQ-GEN-001: three swapping to WebGL2 inside init() is reported as webgl2', async () => {
    const {factory} = factoryOf(() => ({fallsBackInInit: true}));
    const result = await createRendererBackend(CANVAS, {factory});
    expect(result.ok && result.value.backend).toBe('webgl2');
  });

  it('REQ-GEN-001: a failing WebGPU renderer is disposed and WebGL2 (forceWebGL) is tried', async () => {
    const {factory, made} = factoryOf(force => ({initFails: !force}));
    const result = await createRendererBackend(CANVAS, {factory});
    expect(result.ok && result.value.backend).toBe('webgl2');
    expect(made.map(r => r.parameters.forceWebGL)).toEqual([false, true]);
    expect(made[0]?.disposed).toBe(true);
  });

  it('AC-PIX-026.1 (backend part): forceWebGL creates only a WebGL2 renderer', async () => {
    const {factory, made} = factoryOf(() => ({}));
    const result = await createRendererBackend(CANVAS, {
      factory,
      forceWebGL: true,
    });
    expect(result.ok && result.value.backend).toBe('webgl2');
    expect(made.map(r => r.parameters.forceWebGL)).toEqual([true]);
  });

  it('AC-GEN-001.3 (engine part): no backend yields PIX_BACKEND_UNAVAILABLE', async () => {
    const {factory} = factoryOf(() => ({initFails: true}));
    const result = await createRendererBackend(CANVAS, {factory});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PIX_BACKEND_UNAVAILABLE');
      expect(result.error.details?.['attempts']).toHaveLength(2);
    }
  });

  it('backendOf reads the backend flag', () => {
    expect(
      backendOf({
        backend: {isWebGPUBackend: true},
        init: async () => 0,
        dispose: () => {},
      }),
    ).toBe('webgpu');
    expect(
      backendOf({
        backend: {isWebGLBackend: true},
        init: async () => 0,
        dispose: () => {},
      }),
    ).toBe('webgl2');
  });
});

describe('preview timing (REQ-ANM-018)', () => {
  const selection = {frameCount: 8, fps: 8, loop: true} as const;

  it('AC-ANM-018.1 (timing part): show export frames steps through the export sample times at fps', () => {
    const timing = previewTimingFor(selection, 1);
    const times = computeSampleTimes(selection, 1).times;
    const shown = [0, 0.1, 0.13, 0.26, 0.99, 1.01].map(e =>
      previewTimeAt(timing, e),
    );
    expect(shown).toEqual([
      times[0],
      times[0],
      times[1],
      times[2],
      times[7],
      times[0],
    ]);
  });

  it('AC-ANM-018.2: with export frames off, wall-clock elapsed time drives continuous playback', () => {
    const timing = previewTimingFor(selection, 1, false);
    expect(previewTimeAt(timing, 0.37)).toBeCloseTo(0.37, 12);
    expect(previewTimeAt(timing, 1.25)).toBeCloseTo(0.25, 12);
    expect(
      previewTimeAt({showExportFrames: false, durationSec: 1, loop: false}, 3),
    ).toBe(1);
  });
});

/** A stand-in for `PixelPipeline` (Node has no GPU): records what the renderer asks. */
class FakePipeline implements RendererPipeline {
  readonly cellTarget = new RenderTarget(1, 1);
  readonly calls: string[] = [];
  readonly applied: RenderSettings[] = [];
  readonly framings: Framing[] = [];
  rebuilds = 0;
  frames = 0;
  disposed = false;
  /** Resolves `read()`; tests may hold it to abort mid-readback. */
  readGate: Promise<void> = Promise.resolve();
  private current: RenderSettings | undefined;
  constructor(private readonly renderer: PreviewRenderer) {}
  get stats() {
    return {rebuilds: this.rebuilds, frames: this.frames};
  }
  async setRenderSettings(settings: RenderSettings) {
    const diff = diffRenderSettings(this.current, settings);
    if (this.current === undefined || diff.post) this.rebuilds++;
    if (this.current === undefined || diff.resize) {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(
        settings.resolution.width,
        settings.resolution.height,
        false,
      );
      this.cellTarget.setSize(
        settings.resolution.width,
        settings.resolution.height,
      );
    }
    this.current = settings;
    this.applied.push(settings);
    return diff;
  }
  setFraming(framing: Framing): void {
    this.framings.push(framing);
  }
  render(): void {
    this.frames++;
    this.calls.push('render');
  }
  async read(): Promise<Uint8ClampedArray> {
    await this.readGate;
    const {width, height} = this.cellTarget;
    return new Uint8ClampedArray(width * height * 4);
  }
  dispose(): void {
    this.disposed = true;
  }
}

class FakePresenter implements PreviewPresenter {
  readonly presented: Array<number | null> = [];
  disposed = false;
  present(mirrorAxisPx: number | null): void {
    this.presented.push(mirrorAxisPx);
  }
  dispose(): void {
    this.disposed = true;
  }
}

const FIXTURE_CLIP = ref('fixture-clip');

/** Default settings with `fixture-clip` selected (frameCount 4 at 4 fps). */
function selectedSettings(overrides: Partial<RenderSettings> = {}) {
  return {
    ...defaultRenderSettings('side'),
    animations: [
      {
        clipId: FIXTURE_CLIP,
        label: 'walk',
        frameCount: 4,
        fps: 4,
        loop: true,
      },
    ],
    ...overrides,
  } as RenderSettings;
}

async function createWithFakes(
  options: {settings?: RenderSettings; onError?: (code: string) => void} = {},
) {
  const registry = createTestRegistry();
  const {factory, made} = factoryOf(() => ({}));
  const pipelines: FakePipeline[] = [];
  const presenters: FakePresenter[] = [];
  const pipelineFactory: PipelineFactory<FakeRenderer> = args => {
    const p = new FakePipeline(args.renderer);
    pipelines.push(p);
    return {ok: true, value: p};
  };
  const result = await createCharacterRenderer(CANVAS, {
    registry,
    factory,
    pipelineFactory,
    presenterFactory: () => {
      const p = new FakePresenter();
      presenters.push(p);
      return p;
    },
    settings: options.settings,
    onError: e => options.onError?.(e.code),
  });
  if (!result.ok) throw new Error(result.error.message);
  return {
    renderer: result.value,
    fake: made[0] as FakeRenderer,
    pipeline: pipelines[0] as FakePipeline,
    presenter: presenters[0] as FakePresenter,
    registry,
  };
}

const create = createWithFakes;

/** Continuous preview timing (export frames off) for wall-clock tests. */
const CONTINUOUS = {
  showExportFrames: false,
  durationSec: 1,
  loop: true,
} as const;

describe('preview layout (REQ-PIX-031)', () => {
  it('AC-PIX-031.1: dpr 1.5, a 64 px cell in a 400 CSS px viewport: whole multiple of 64 device px, equal squares', () => {
    const l = previewLayout(64, 64, 400, 400, 1.5);
    expect(l).toMatchObject({cellW: 64, cellH: 64, scale: 9});
    // 9 device px per sprite px: 576 device px = 384 CSS px at dpr 1.5.
    expect(l.cssW * 1.5).toBe(576);
    expect((l.cssW * 1.5) % 64).toBe(0);
    expect(l.cssH).toBe(l.cssW);
  });

  it('AC-PIX-031.1: largest integer scale that fits, for every cell size and common dpr', () => {
    for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
      for (const [w, h] of [
        [32, 32],
        [48, 64],
        [64, 64],
        [128, 96],
      ] as const) {
        for (const vw of [100, 333, 400, 801]) {
          const vh = vw * 0.75;
          const l = previewLayout(w, h, vw, vh, dpr);
          const deviceW = l.cssW * dpr;
          const deviceH = l.cssH * dpr;
          // One sprite pixel = scale x scale device pixels, an integer.
          expect(Number.isInteger(l.scale)).toBe(true);
          expect(deviceW).toBeCloseTo(w * l.scale, 9);
          expect(deviceH).toBeCloseTo(h * l.scale, 9);
          const fits = (k: number) => w * k <= vw * dpr && h * k <= vh * dpr;
          if (l.scale > 1) expect(fits(l.scale)).toBe(true);
          expect(fits(l.scale + 1)).toBe(false);
        }
      }
    }
  });

  it('REQ-PIX-031: a viewport smaller than the cell keeps scale 1; invalid input falls back', () => {
    expect(previewLayout(128, 128, 50, 50, 1).scale).toBe(1);
    expect(previewLayout(64, 64, 640, 640, Number.NaN)).toMatchObject({
      scale: 10,
      cssW: 640,
    });
    // 383.9999999 CSS px at dpr 1 still fits 6 x 64.
    expect(previewLayout(64, 64, 383.9999999, 400, 1).scale).toBe(6);
  });
});

describe('character renderer', () => {
  it('AC-CMP-036.2 (engine part): setCharacter on the fixture spec is ok and draws once through the pipeline', async () => {
    const {renderer, fake, pipeline, presenter} = await create();
    expect(renderer.backend).toBe('webgpu');
    // REQ-PIX-002 / m2-plan 2.1 item 6: drawing buffer = cell size, ratio 1.
    expect(fake.calls).toContain('size:64x64');
    expect(fake.calls).toContain('pixelRatio:1');
    const result = await renderer.setCharacter(fixtureSpec());
    expect(result.ok).toBe(true);
    expect(pipeline.frames).toBe(1);
    expect(presenter.presented).toEqual([null]);
    expect(renderer.framing).toBeDefined();
    expect(renderer.assembly.root.parent).toBe(renderer.preview.stage);
  });

  it('REQ-PIX-031: resize keeps the drawing buffer at the cell size and returns the integer CSS layout', async () => {
    const {renderer, fake} = await create();
    const sizes = fake.calls.filter(c => c.startsWith('size:'));
    const l = renderer.resize(400, 300, 2);
    expect(l).toEqual(previewLayout(64, 64, 400, 300, 2));
    expect(renderer.layout).toEqual(l);
    expect(fake.calls.filter(c => c.startsWith('size:'))).toEqual(sizes);
    // A resolution change updates the layout for the same viewport.
    const res = await renderer.setRenderSettings({
      ...defaultRenderSettings('side'),
      resolution: {width: 32, height: 48},
    });
    expect(res.ok).toBe(true);
    expect(renderer.layout).toEqual(previewLayout(32, 48, 400, 300, 2));
    expect(fake.calls).toContain('size:32x48');
  });

  it('AC-PIX-001.1 / AC-PIX-001.2: setRenderSettings validates; invalid keeps the previous settings', async () => {
    const {renderer, pipeline} = await create();
    const ok = await renderer.setRenderSettings({
      ...defaultRenderSettings('side'),
      resolution: {width: 48, height: 64},
    });
    expect(ok.ok).toBe(true);
    expect(renderer.renderSettings.resolution).toEqual({width: 48, height: 64});
    const applied = pipeline.applied.length;
    for (const bad of [31, 129, 64.5, Number.NaN]) {
      const result = await renderer.setRenderSettings({
        ...defaultRenderSettings('side'),
        resolution: {width: bad, height: 64},
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PIX_INVALID_RESOLUTION');
        expect(Array.isArray(result.error.details?.['issues'])).toBe(true);
      }
    }
    expect(pipeline.applied.length).toBe(applied);
    expect(renderer.renderSettings.resolution).toEqual({width: 48, height: 64});
  });

  it('AC-PIX-034.1 (renderer part): 100 rim-strength changes rebuild nothing and never reframe', async () => {
    const {renderer, pipeline, registry} = await create({
      settings: selectedSettings(),
    });
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(FIXTURE_CLIP);
    renderer.pause();
    const rebuilds = renderer.pipelineStats.rebuilds;
    const framing = renderer.framing;
    const clipLoads = registry.resolveClipCalls.length;
    const base = renderer.renderSettings;
    for (let i = 0; i < 100; i++) {
      const result = await renderer.setRenderSettings({
        ...base,
        toon: {...base.toon, rim: {...base.toon.rim, strength: i / 100}},
      });
      expect(result.ok).toBe(true);
    }
    expect(renderer.pipelineStats.rebuilds).toBe(rebuilds);
    expect(pipeline.applied.at(-1)?.toon.rim.strength).toBe(0.99);
    // Same framing object: no union-bounds pass, no clip reloads.
    expect(renderer.framing).toBe(framing);
    expect(registry.resolveClipCalls.length).toBe(clipLoads);
    // A structural change does rebuild (dither mode).
    await renderer.setRenderSettings({
      ...base,
      palette: {
        ...base.palette,
        id: 'pico-8',
        dither: {mode: 'bayer4', strength: 0.5},
      },
    });
    expect(renderer.pipelineStats.rebuilds).toBe(rebuilds + 1);
  });

  it('REQ-PIX-030: a framing setting (camera preset) recomputes the preview framing', async () => {
    const {renderer} = await create({settings: selectedSettings()});
    await renderer.setCharacter(fixtureSpec());
    const side = renderer.framing;
    await renderer.setRenderSettings(
      selectedSettings({camera: defaultRenderSettings('isometric').camera}),
    );
    expect(renderer.framing).not.toBe(side);
    expect(renderer.framing?.elevationDeg).toBe(30);
  });

  it('AC-PIX-030.2: the playing preview advances in whole frames at the export fps (export sample times)', async () => {
    const {renderer, fake} = await create({settings: selectedSettings()});
    await renderer.setCharacter(fixtureSpec());
    expect((await renderer.playClip(FIXTURE_CLIP)).ok).toBe(true);
    const times = computeSampleTimes(
      {frameCount: 4, fps: 4, loop: true},
      1,
    ).times;
    const loop = fake.loop;
    if (loop === null) throw new Error('no animation loop');
    const seen: number[] = [];
    for (let ms = 1000; ms <= 3000; ms += 37) {
      loop(ms);
      seen.push(renderer.timeSec);
      expect(times).toContain(renderer.timeSec);
      // Frame index floor(elapsed * fps) mod N.
      const elapsed = (ms - 1000) / 1000;
      expect(renderer.timeSec).toBe(times[Math.floor(elapsed * 4) % 4]);
    }
    expect(new Set(seen).size).toBe(4);
  });

  it('AC-ANM-018.2: play() uses only the loop timestamps; seek output equals a fresh renderer (export unchanged)', async () => {
    const a = await create();
    await a.renderer.setCharacter(fixtureSpec());
    a.renderer.setPreviewTiming(CONTINUOUS);
    const played = await a.renderer.playClip(FIXTURE_CLIP, 'metadata');
    expect(played.ok).toBe(true);
    expect(a.renderer.playing).toBe(true);
    const loop = a.fake.loop;
    if (loop === null) throw new Error('no animation loop');
    loop(5000); // first timestamp = elapsed 0
    loop(5370); // 0.37 s of wall clock later
    expect(a.renderer.timeSec).toBeCloseTo(0.37, 9);
    loop(6250);
    expect(a.renderer.timeSec).toBeCloseTo(0.25, 9); // loops at durationSec 1
    a.renderer.pause();
    expect(a.fake.loop).toBeNull();

    // Deterministic seek: same matrices as a renderer that never played.
    a.renderer.seek(0.6);
    const b = await create();
    await b.renderer.setCharacter(fixtureSpec());
    await b.renderer.playClip(FIXTURE_CLIP, 'metadata');
    b.renderer.pause();
    b.renderer.seek(0.6);
    const matrices = (r: typeof a.renderer) =>
      r.assembly.body?.skeleton.bones.flatMap(x => x.matrixWorld.elements);
    expect(matrices(a.renderer)).toEqual(matrices(b.renderer));
  });

  it('REQ-ANM-018: setPreviewTiming with export frames steps the preview', async () => {
    const {renderer, fake} = await create();
    await renderer.setCharacter(fixtureSpec());
    renderer.setPreviewTiming(
      previewTimingFor({frameCount: 4, fps: 4, loop: true}, 1),
    );
    await renderer.playClip(FIXTURE_CLIP);
    fake.loop?.(0);
    fake.loop?.(600); // frame floor(0.6 * 4) = 2 → t = 2/4
    expect(renderer.timeSec).toBe(0.5);
  });

  it('REQ-ANM-018: an unselected clip previews at its manifest defaults (8 frames, round(N/D) fps)', async () => {
    const {renderer, fake} = await create();
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(FIXTURE_CLIP);
    fake.loop?.(0);
    fake.loop?.(300); // 8 fps: frame 2 of 8 → t = 2/8
    expect(renderer.timeSec).toBe(0.25);
  });

  it('REQ-PIX-005: setDirection turns the stage (model); the camera stays at the framing', async () => {
    const {renderer} = await create();
    await renderer.setCharacter(fixtureSpec());
    const cameraBefore = renderer.preview.camera.matrixWorld.clone();
    renderer.setDirection(2);
    expect(renderer.preview.stage.rotation.y).toBeCloseTo(stageYaw(2), 12);
    expect(renderer.preview.camera.matrixWorld.equals(cameraBefore)).toBe(true);
    expect(() => renderer.setDirection(8)).toThrow();
    expect(() => directionYaw(8)).toThrow();
    expect(() => stageYaw(-1)).toThrow();
  });

  it('AC-PIX-005.1: index i faces i x 45 degrees counter-clockwise from screen-right; labels e..se', async () => {
    expect([...DIRECTION_ORDER]).toEqual([
      'e',
      'ne',
      'n',
      'nw',
      'w',
      'sw',
      's',
      'se',
    ]);
    const {renderer} = await create();
    await renderer.setCharacter(fixtureSpec());
    const {camera, stage} = renderer.preview;
    camera.updateMatrixWorld(true);
    // Camera basis: screen-right and "away from the camera" (into the screen).
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const away = new Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 2)
      .negate();
    const forward = new Vector3();
    for (let i = 0; i < DIRECTION_ORDER.length; i++) {
      renderer.setDirection(i);
      stage.updateMatrixWorld(true);
      // Built models face +Z (REQ-AST-011); the stage turns them.
      forward.set(0, 0, 1).transformDirection(stage.matrixWorld);
      const yawDeg =
        (Math.atan2(forward.dot(away), forward.dot(right)) * 180) / Math.PI;
      const expected = i * 45;
      expect(((yawDeg % 360) + 360) % 360).toBeCloseTo(expected, 9);
      expect(directionYaw(i)).toBeCloseTo((expected * Math.PI) / 180, 12);
    }
    renderer.setDirection(DIRECTION_ORDER.indexOf('s'));
    stage.updateMatrixWorld(true);
    forward.set(0, 0, 1).transformDirection(stage.matrixWorld);
    expect(forward.dot(away)).toBeCloseTo(-1, 12);
    expect(stageYaw(0)).toBeCloseTo(MODEL_FORWARD_YAW_OFFSET_RAD, 12);
  });

  it('REQ-PIX-006 / REQ-PIX-030: with mirrorWest the preview of w shows the flipped e cell, like the export', async () => {
    const {renderer, presenter} = await create({
      settings: selectedSettings({mirrorWest: true}),
    });
    await renderer.setCharacter(fixtureSpec());
    const framing = renderer.framing;
    if (framing === undefined) throw new Error('no framing');
    renderer.setDirection(DIRECTION_ORDER.indexOf('w'));
    expect(presenter.presented.at(-1)).toBe(2 * framing.pivotPx[0] - 1);
    // The e pose is what gets rendered.
    expect(renderer.preview.stage.rotation.y).toBeCloseTo(stageYaw(0), 12);
    renderer.setDirection(DIRECTION_ORDER.indexOf('n'));
    expect(presenter.presented.at(-1)).toBeNull();
  });

  it('D5 / REQ-EXP-001: renderFrames pauses the preview, yields in plan order and restores clip, settings and loop', async () => {
    const {renderer, fake, pipeline} = await create();
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(FIXTURE_CLIP);
    const exportSettings = selectedSettings({
      resolution: {width: 48, height: 64},
      directions: 2,
    });
    const prepared = await renderer.prepareFrames(exportSettings);
    if (!prepared.ok) throw new Error(prepared.error.message);
    expect(renderer.playing).toBe(true);
    expect(fake.loop).not.toBeNull();
    const frames = [];
    for await (const frame of renderer.renderFrames(prepared.value)) {
      // Exclusive: the loop is off and preview draws are skipped.
      expect(fake.loop).toBeNull();
      expect(renderer.busy).toBe(true);
      frames.push(frame);
    }
    expect(frames.map(f => [f.direction, f.frame])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(frames.every(f => f.width === 48 && f.height === 64)).toBe(true);
    expect(frames[0]?.pixels.length).toBe(48 * 64 * 4);
    // Restored: preview settings, clip, loop.
    expect(renderer.busy).toBe(false);
    expect(pipeline.applied.at(-1)).toBe(renderer.renderSettings);
    expect(renderer.renderSettings.resolution).toEqual({width: 64, height: 64});
    expect(fake.loop).not.toBeNull();
    expect(
      renderer.assembly.player?.log.filter(l => l.startsWith('source:')).at(-1),
    ).toContain('fixture-clip');
  });

  it('AC-EXP-024.1 (render side): abort mid-export throws EXP_CANCELLED and restores the preview', async () => {
    const {renderer, fake, pipeline} = await create({
      settings: selectedSettings(),
    });
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(FIXTURE_CLIP);
    const prepared = await renderer.prepareFrames();
    if (!prepared.ok) throw new Error(prepared.error.message);
    const controller = new AbortController();
    let release!: () => void;
    let count = 0;
    const run = (async () => {
      for await (const _ of renderer.renderFrames(prepared.value, {
        signal: controller.signal,
      })) {
        count++;
        if (count === 2) {
          pipeline.readGate = new Promise(r => {
            release = r;
          });
          setTimeout(() => controller.abort(), 0);
        }
      }
    })();
    await expect(run).rejects.toSatisfy(
      e => e instanceof FrameSamplerError && e.code === EXP_CANCELLED,
    );
    release();
    expect(count).toBe(2);
    expect(renderer.busy).toBe(false);
    expect(fake.loop).not.toBeNull();
    // The preview draws again after the export.
    const before = pipeline.frames;
    renderer.pause();
    renderer.seek(0.25);
    expect(pipeline.frames).toBe(before + 1);
  });

  it('D5: setRenderSettings during an export waits for it; draws are skipped while busy', async () => {
    const {renderer, pipeline} = await create({settings: selectedSettings()});
    await renderer.setCharacter(fixtureSpec());
    const prepared = await renderer.prepareFrames();
    if (!prepared.ok) throw new Error(prepared.error.message);
    const it = renderer.renderFrames(prepared.value)[Symbol.asyncIterator]();
    await it.next();
    const drawsBefore = pipeline.calls.length;
    const order: string[] = [];
    const settled = renderer
      .setRenderSettings({...renderer.renderSettings, alphaCutoff: 0.4})
      .then(() => order.push('settings'));
    renderer.seek(0.5); // skipped: busy
    renderer.draw();
    expect(pipeline.calls.length).toBe(drawsBefore);
    await Promise.resolve();
    expect(order).toEqual([]);
    await it.return?.(undefined);
    await settled;
    expect(order).toEqual(['settings']);
    expect(renderer.renderSettings.alphaCutoff).toBe(0.4);
  });

  it('play() reports a clip load failure through onError and keeps playing state off', async () => {
    const errors: string[] = [];
    const {renderer} = await create({onError: c => errors.push(c)});
    await renderer.setCharacter(fixtureSpec());
    const result = await renderer.playClip(ref('no-such-clip'));
    expect(result.ok).toBe(false);
    expect(errors).toEqual(['ANM_CLIP_LOAD_FAILED']);
    expect(renderer.playing).toBe(false);
  });

  it('AC-ANM-022.3: a failing clip B keeps clip A playing; the next pose equals clip A bit-identically', async () => {
    const errors: string[] = [];
    const {renderer: r, fake} = await create({onError: c => errors.push(c)});
    await r.setCharacter(fixtureSpec());
    r.setPreviewTiming(CONTINUOUS);
    expect((await r.playClip(FIXTURE_CLIP, 'metadata')).ok).toBe(true);
    fake.loop?.(1000);
    fake.loop?.(1250);
    const failed = await r.playClip(ref('no-such-clip'), 'metadata');
    expect(failed.ok).toBe(false);
    expect(errors).toEqual(['ANM_CLIP_LOAD_FAILED']);
    // The player still names clip A and the loop keeps running.
    expect(
      r.assembly.player?.log.filter(l => l.startsWith('source:')).at(-1),
    ).toBe(`source:${FIXTURE_CLIP}`);
    expect(r.playing).toBe(true);
    fake.loop?.(1600); // next sample: elapsed 0.6 s
    expect(r.timeSec).toBeCloseTo(0.6, 9);
    const matrices = (x: typeof r) =>
      x.assembly.body?.skeleton.bones.flatMap(b => b.matrixWorld.elements);
    const played = matrices(r);
    // Reference: clip A alone, seeked to the same time.
    const other = await create();
    await other.renderer.setCharacter(fixtureSpec());
    await other.renderer.playClip(FIXTURE_CLIP, 'metadata');
    other.renderer.pause();
    other.renderer.seek(r.timeSec);
    expect(played).toEqual(matrices(other.renderer));
  });

  it('REQ-ANM-018: resume() after pause continues from the paused time without reloading the clip', async () => {
    const {renderer, fake, registry} = await create();
    await renderer.setCharacter(fixtureSpec());
    renderer.setPreviewTiming(CONTINUOUS);
    expect(renderer.resume()).toBe(false); // nothing played yet
    await renderer.playClip(FIXTURE_CLIP, 'metadata');
    fake.loop?.(1000);
    fake.loop?.(1300);
    renderer.pause();
    expect(renderer.timeSec).toBeCloseTo(0.3, 9);
    const clipLoads = registry.resolveClipCalls.length;
    const playerLog = renderer.assembly.player?.log.length;
    expect(renderer.resume()).toBe(true);
    expect(renderer.playing).toBe(true);
    // Wall clock jumped while paused; playback continues from 0.3 s.
    fake.loop?.(9000);
    expect(renderer.timeSec).toBeCloseTo(0.3, 9);
    fake.loop?.(9200);
    expect(renderer.timeSec).toBeCloseTo(0.5, 9);
    // Pause, seek, resume: continues from the seek time.
    renderer.pause();
    renderer.seek(0.75);
    expect(renderer.resume()).toBe(true);
    fake.loop?.(20_000);
    fake.loop?.(20_100);
    expect(renderer.timeSec).toBeCloseTo(0.85, 9);
    // No reload and no re-retarget.
    expect(registry.resolveClipCalls.length).toBe(clipLoads);
    expect(renderer.assembly.player?.log.length).toBe(playerLog);
    renderer.dispose();
    expect(renderer.resume()).toBe(false);
  });

  it('dispose during an in-flight playClip resolves to ENGINE_DISPOSED, starts no loop and calls no onError', async () => {
    const errors: string[] = [];
    const {renderer: r, fake} = await create({onError: c => errors.push(c)});
    await r.setCharacter(fixtureSpec());
    const pending = r.playClip(FIXTURE_CLIP);
    const spec = r.setCharacter(fixtureSpec());
    r.dispose();
    const [played, set] = await Promise.all([pending, spec]);
    expect(played).toMatchObject({ok: false, error: {code: ENGINE_DISPOSED}});
    expect(set).toMatchObject({ok: false, error: {code: ENGINE_DISPOSED}});
    expect(errors).toEqual([]);
    expect(fake.loop).toBeNull();
    expect(r.playing).toBe(false);
    // play() after dispose does not throw or reject.
    expect(() => r.play(FIXTURE_CLIP)).not.toThrow();
    await Promise.resolve();
  });

  it('dispose stops the loop, detaches the character and disposes renderer, pipeline and presenter', async () => {
    const {renderer, fake, pipeline, presenter} = await create();
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(FIXTURE_CLIP);
    renderer.dispose();
    expect(fake.loop).toBeNull();
    expect(fake.disposed).toBe(true);
    expect(pipeline.disposed).toBe(true);
    expect(presenter.disposed).toBe(true);
    expect(renderer.preview.stage.children).toHaveLength(0);
    expect(renderer.assembly.parts.size).toBe(0);
  });

  it('REQ-GEN-001: a pipeline that cannot run (PIX_BACKEND_UNAVAILABLE) disposes the renderer', async () => {
    const {factory, made} = factoryOf(() => ({}));
    const result = await createCharacterRenderer(CANVAS, {
      registry: createTestRegistry(),
      factory,
      pipelineFactory: () => ({
        ok: false,
        error: {code: 'PIX_BACKEND_UNAVAILABLE', message: 'no half float'},
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      error: {code: 'PIX_BACKEND_UNAVAILABLE'},
    });
    expect(made[0]?.disposed).toBe(true);
  });
});
