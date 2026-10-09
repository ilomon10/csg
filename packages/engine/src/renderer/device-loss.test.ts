/**
 * Device-loss detection on fakes (Node has no GPU): spec 003 REQ-PIX-036 and
 * spec 009 REQ-UX-046 (engine part). The WebGL2 path on a real context is
 * covered by `test/gpu/device-loss.gpu.ts`; WebGPU loss cannot be forced in
 * SwiftShader, so it is covered here only.
 */
import {describe, expect, it} from 'vitest';
import {RenderTarget} from 'three';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {
  createTestRegistry,
  fixtureSpec,
  ref,
} from '../composition/assembly-test-env';
import type {EngineError} from '../contracts/errors';
import type {Framing} from '../contracts/pipeline';
import {FrameSamplerError} from '../sampler/frame-sampler';
import {diffRenderSettings} from '../pipeline/settings-binder';
import type {RendererParameters} from './backend';
import {createCharacterRenderer} from './character-renderer';
import type {PreviewRenderer, RendererPipeline} from './character-renderer';
import {PIX_DEVICE_LOST, watchDeviceLoss} from './device-loss';

/** A fake `GPUDevice` whose `lost` promise the test resolves. */
class FakeDevice {
  resolveLost!: (info: {reason: string; message: string}) => void;
  readonly lost = new Promise<{reason: string; message: string}>(resolve => {
    this.resolveLost = resolve;
  });
}

/** A fake canvas with `webglcontextlost` listeners. */
class FakeCanvas {
  width = 64;
  height = 64;
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string, statusMessage = ''): Event {
    const state = {defaultPrevented: false};
    const event = {
      type,
      statusMessage,
      get defaultPrevented() {
        return state.defaultPrevented;
      },
      preventDefault() {
        state.defaultPrevented = true;
      },
    } as unknown as Event;
    for (const l of [...(this.listeners.get(type) ?? [])]) l(event);
    return event;
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeRenderer implements PreviewRenderer {
  readonly backend: object;
  readonly device = new FakeDevice();
  loop: ((timeMs: number) => void) | null = null;
  disposed = false;
  disposeThrows = false;
  constructor(
    readonly parameters: RendererParameters,
    private readonly canvas: FakeCanvas,
  ) {
    this.backend = parameters.forceWebGL
      ? {isWebGLBackend: true}
      : {isWebGPUBackend: true, device: this.device};
  }
  async init(): Promise<this> {
    return this;
  }
  setPixelRatio(): void {}
  setSize(): void {}
  setAnimationLoop(callback: ((timeMs: number) => void) | null): void {
    this.loop = callback;
  }
  dispose(): void {
    if (this.disposeThrows) throw new Error('device is lost');
    this.disposed = true;
    if (this.parameters.forceWebGL) {
      // three's WebGLBackend.dispose() calls WEBGL_lose_context.loseContext().
      this.canvas.fire('webglcontextlost');
    } else {
      this.device.resolveLost({reason: 'destroyed', message: ''});
    }
  }
}

class FakePipeline implements RendererPipeline {
  readonly cellTarget = new RenderTarget(1, 1);
  frames = 0;
  disposed = false;
  private current: RenderSettings | undefined;
  get stats() {
    return {rebuilds: 0, frames: this.frames};
  }
  get settings() {
    return this.current;
  }
  async setRenderSettings(settings: RenderSettings) {
    await Promise.resolve();
    const diff = diffRenderSettings(this.current, settings);
    this.current = settings;
    this.cellTarget.setSize(
      settings.resolution.width,
      settings.resolution.height,
    );
    return diff;
  }
  setFraming(_framing: Framing): void {}
  render(): void {
    this.frames++;
  }
  async read(): Promise<Uint8ClampedArray> {
    const {width, height} = this.cellTarget;
    return new Uint8ClampedArray(width * height * 4);
  }
  dispose(): void {
    this.disposed = true;
  }
}

async function create(forceWebGL: boolean) {
  const canvas = new FakeCanvas();
  const errors: EngineError[] = [];
  let fake: FakeRenderer | undefined;
  let pipeline: FakePipeline | undefined;
  const result = await createCharacterRenderer(
    canvas as unknown as OffscreenCanvas,
    {
      registry: createTestRegistry(),
      forceWebGL,
      factory: p => (fake = new FakeRenderer(p, canvas)),
      pipelineFactory: () => ({
        ok: true,
        value: (pipeline = new FakePipeline()),
      }),
      presenterFactory: () => ({present: () => {}, dispose: () => {}}),
      settings: defaultRenderSettings('side'),
      onError: e => errors.push(e),
    },
  );
  if (!result.ok || fake === undefined || pipeline === undefined) {
    throw new Error('renderer creation failed');
  }
  return {renderer: result.value, fake, pipeline, canvas, errors};
}

/** Lets promise callbacks run. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('device loss (REQ-PIX-036, REQ-UX-046 engine part)', () => {
  it('AC-UX-046.1 (engine part): WebGPU device.lost with reason unknown reports PIX_DEVICE_LOST once', async () => {
    const {fake, errors} = await create(false);
    fake.device.resolveLost({reason: 'unknown', message: 'GPU hung'});
    await flush();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(PIX_DEVICE_LOST);
    expect(errors[0]?.message).toContain('GPU hung');
    expect(errors[0]?.details).toEqual({backend: 'webgpu', reason: 'unknown'});
  });

  it('REQ-UX-046: WebGPU device.lost with reason destroyed reports nothing', async () => {
    const {fake, errors} = await create(false);
    fake.device.resolveLost({reason: 'destroyed', message: ''});
    await flush();
    expect(errors).toEqual([]);
  });

  it('AC-UX-046.1 (engine part): WebGL2 webglcontextlost reports PIX_DEVICE_LOST once, without preventDefault', async () => {
    const {canvas, errors} = await create(true);
    const event = canvas.fire('webglcontextlost', 'context reset');
    canvas.fire('webglcontextlost');
    expect(errors.map(e => e.code)).toEqual([PIX_DEVICE_LOST]);
    expect(errors[0]?.details).toEqual({backend: 'webgl2', reason: null});
    // No restore is attempted: the web layer recreates the renderer.
    expect(event.defaultPrevented).toBe(false);
  });

  it('AC-UX-046.1 (engine part): after a loss draw, tick and play are no-ops and the loop stops', async () => {
    const {renderer, fake, pipeline, canvas, errors} = await create(true);
    await renderer.setCharacter(fixtureSpec());
    await renderer.playClip(ref('fixture-clip'));
    const tick = fake.loop;
    expect(tick).not.toBeNull();
    const before = pipeline.frames;
    expect(before).toBeGreaterThan(0);
    canvas.fire('webglcontextlost');
    expect(fake.loop).toBeNull();
    expect(() => tick?.(1000)).not.toThrow();
    expect(() => renderer.draw()).not.toThrow();
    expect(renderer.resume()).toBe(false);
    expect(fake.loop).toBeNull();
    renderer.seek(0.5);
    expect(pipeline.frames).toBe(before);
    expect(errors).toHaveLength(1);
  });

  it('AC-PIX-036.2 (engine part): an export after a loss fails with PIX_DEVICE_LOST and yields nothing', async () => {
    const {renderer, canvas} = await create(true);
    await renderer.setCharacter(fixtureSpec());
    canvas.fire('webglcontextlost');
    const prepared = await renderer.prepareFrames(
      defaultRenderSettings('side'),
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const frames: unknown[] = [];
    let thrown: unknown;
    try {
      for await (const f of renderer.renderFrames(prepared.value)) {
        frames.push(f);
      }
    } catch (error) {
      thrown = error;
    }
    expect(frames).toEqual([]);
    expect(thrown).toBeInstanceOf(FrameSamplerError);
    expect((thrown as FrameSamplerError).code).toBe(PIX_DEVICE_LOST);
    await expect(renderer.readCell()).rejects.toMatchObject({
      code: PIX_DEVICE_LOST,
    });
  });

  it('REQ-UX-046: dispose() reports nothing on either backend (destroyed / loseContext)', async () => {
    for (const forceWebGL of [false, true]) {
      const {renderer, fake, canvas, errors} = await create(forceWebGL);
      renderer.dispose();
      await flush();
      expect(fake.disposed).toBe(true);
      expect(errors).toEqual([]);
      expect(canvas.count('webglcontextlost')).toBe(0);
    }
  });

  it('REQ-UX-046: dispose() after a loss is safe when GPU frees throw', async () => {
    const {renderer, fake, pipeline, canvas, errors} = await create(true);
    canvas.fire('webglcontextlost');
    fake.disposeThrows = true;
    expect(() => renderer.dispose()).not.toThrow();
    expect(pipeline.disposed).toBe(true);
    expect(errors).toHaveLength(1);
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('REQ-UX-046: watchDeviceLoss stop() prevents a later report', async () => {
    const device = new FakeDevice();
    const errors: EngineError[] = [];
    const stop = watchDeviceLoss({
      rendererBackend: {device},
      backend: 'webgpu',
      canvas: null,
      onLost: e => errors.push(e),
    });
    stop();
    device.resolveLost({reason: 'unknown', message: 'late'});
    await flush();
    expect(errors).toEqual([]);
  });
});
