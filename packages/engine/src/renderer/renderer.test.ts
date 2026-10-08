import {describe, expect, it} from 'vitest';
import type {Camera, Scene} from 'three';
import {computeSampleTimes} from '../animation/sample-times';
import {
  createTestRegistry,
  fixtureSpec,
  ref,
} from '../composition/assembly-test-env';
import {backendOf, createRendererBackend} from './backend';
import type {RendererParameters} from './backend';
import {createCharacterRenderer} from './character-renderer';
import type {PreviewRenderer} from './character-renderer';
import {previewTimeAt, previewTimingFor} from './preview-clock';
import {DIRECTION_ORDER, directionYaw} from './preview-scene';

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
  renders = 0;
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
  render(_scene: Scene, _camera: Camera): void {
    this.renders++;
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

describe('character renderer (M1)', () => {
  async function create() {
    const registry = createTestRegistry();
    const {factory, made} = factoryOf(() => ({}));
    const result = await createCharacterRenderer(CANVAS, {
      registry,
      factory,
      previewScale: 2,
    });
    if (!result.ok) throw new Error(result.error.message);
    return {renderer: result.value, fake: made[0] as FakeRenderer, registry};
  }

  it('AC-CMP-036.2 (engine part): setCharacter on the fixture spec is ok and draws once', async () => {
    const {renderer, fake} = await create();
    expect(renderer.backend).toBe('webgpu');
    expect(fake.calls).toContain('size:128x128');
    expect(fake.calls).toContain('pixelRatio:1');
    const result = await renderer.setCharacter(fixtureSpec());
    expect(result.ok).toBe(true);
    expect(fake.renders).toBe(1);
    expect(renderer.assembly.root.parent).toBe(renderer.preview.stage);
  });

  it('AC-ANM-018.2: play() uses only the loop timestamps; seek output equals a fresh renderer (export unchanged)', async () => {
    const a = await create();
    await a.renderer.setCharacter(fixtureSpec());
    const played = await a.renderer.playClip(ref('fixture-clip'), 'metadata');
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
    await b.renderer.assembly.setClip(ref('fixture-clip'), 'metadata');
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
    await renderer.playClip(ref('fixture-clip'));
    fake.loop?.(0);
    fake.loop?.(600); // frame floor(0.6 * 4) = 2 → t = 2/4
    expect(renderer.timeSec).toBe(0.5);
  });

  it('REQ-PIX-005: setDirection turns the stage by index x 45 degrees, camera fixed', async () => {
    const {renderer} = await create();
    const cameraBefore = renderer.preview.camera.matrixWorld.clone();
    renderer.setDirection(2);
    expect(renderer.preview.stage.rotation.y).toBeCloseTo(Math.PI / 2, 12);
    expect(renderer.preview.camera.matrixWorld.equals(cameraBefore)).toBe(true);
    expect(DIRECTION_ORDER[2]).toBe('n');
    expect(() => directionYaw(8)).toThrow();
  });

  it('play() reports a clip load failure through onError and keeps playing state off', async () => {
    const registry = createTestRegistry();
    const errors: string[] = [];
    const {factory} = factoryOf(() => ({}));
    const created = await createCharacterRenderer(CANVAS, {
      registry,
      factory,
      onError: e => errors.push(e.code),
    });
    if (!created.ok) throw new Error('create failed');
    await created.value.setCharacter(fixtureSpec());
    const result = await created.value.playClip(ref('no-such-clip'));
    expect(result.ok).toBe(false);
    expect(errors).toEqual(['ANM_CLIP_LOAD_FAILED']);
    expect(created.value.playing).toBe(false);
  });

  it('dispose stops the loop, detaches the character and disposes the renderer', async () => {
    const {renderer, fake} = await create();
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(ref('fixture-clip'));
    renderer.dispose();
    expect(fake.loop).toBeNull();
    expect(fake.disposed).toBe(true);
    expect(renderer.preview.stage.children).toHaveLength(0);
    expect(renderer.assembly.parts.size).toBe(0);
  });
});
