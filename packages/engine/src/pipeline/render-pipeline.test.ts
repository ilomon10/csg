import {describe, expect, it, vi} from 'vitest';
import type {Color, Vector2} from 'three';
import {DataTexture, Scene} from 'three';
import {float, texture} from 'three/tsl';
import {NodeFrame, RenderPipeline} from 'three/webgpu';
import type {WebGPURenderer} from 'three/webgpu';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import type {Framing} from '../contracts/pipeline';
import {buildPaletteLut} from './palette-lut';
import {
  POST_CHAIN_CACHE_SIZE,
  buildDefaultPostChain,
  cellReadbackLayout,
  createPixelPipeline,
} from './render-pipeline';
import type {PaletteLutBuilder} from './render-pipeline';
import {SettingsBinder} from './settings-binder';
import {createStageContext} from './stage-context';
import {DEFAULT_POST_STAGES} from './stages/index';

function postContext(binder: SettingsBinder) {
  const color = texture(new DataTexture(new Float32Array(4), 1, 1));
  const nd = texture(new DataTexture(new Float32Array(4), 1, 1));
  const id = texture(new DataTexture(new Float32Array(4), 1, 1));
  return createStageContext({
    binder,
    target: 'post',
    mode: 'export',
    backend: 'webgl2',
    sources: {
      'scene.color': color,
      'scene.normal': nd,
      'scene.depth': nd,
      'scene.partId': id,
      'scene.light': float(1),
    },
  });
}

describe('render pipeline (pure parts)', () => {
  it('AC-PIX-025.1: the default post chain is built in the fixed stage order', () => {
    for (const mode of ['none', 'bayer4'] as const) {
      const s = defaultRenderSettings();
      const settings = {
        ...s,
        palette: {
          ...s.palette,
          id: 'pico-8' as const,
          dither: {mode, strength: 0.5},
        },
      };
      const binder = new SettingsBinder(settings);
      const chain = buildDefaultPostChain(postContext(binder), settings);
      expect(chain.stages).toEqual([...DEFAULT_POST_STAGES]);
      expect(chain.stages).toEqual([
        'coverage',
        'rim',
        'outline',
        'srgb',
        'dither',
        'palette',
        'final-alpha',
      ]);
      expect((chain.output as {isNode?: boolean}).isNode).toBe(true);
      binder.dispose();
    }
  });

  it('AC-PIX-034.1: building the chain registers reserved uniforms once; rebuilding reuses the same nodes', () => {
    const settings = defaultRenderSettings();
    const binder = new SettingsBinder(settings);
    buildDefaultPostChain(postContext(binder), settings);
    const keys = binder.keys();
    const before = keys.map(k => binder.uniformNode(k));
    buildDefaultPostChain(postContext(binder), settings);
    expect(binder.keys()).toEqual(keys);
    expect(keys.map(k => binder.uniformNode(k))).toEqual(before);
    expect(keys).toContain('alpha.cutoff');
    expect(keys).toContain('outline.outer.widthPx');
    expect(keys).toContain('dither.strength');
    expect(keys).toContain('rim.strength');
    expect(keys).toContain('rim.enabled');
  });

  it('AC-PIX-029.1: readback layout for 48 px rows (192 B, padded to 256 on WebGPU; tight, bottom-up on WebGL2)', () => {
    expect(cellReadbackLayout('webgpu', 48)).toEqual({
      rowStrideBytes: 256,
      bottomUp: false,
    });
    expect(cellReadbackLayout('webgl2', 48)).toEqual({
      rowStrideBytes: 192,
      bottomUp: true,
    });
    expect(cellReadbackLayout('webgpu', 64).rowStrideBytes).toBe(256);
    expect(cellReadbackLayout('webgpu', 65).rowStrideBytes).toBe(512);
  });
});

/** A Node stand-in for an initialized `WebGPURenderer` (only what the pipeline calls). */
function fakeRenderer(backend: object = {isWebGPUBackend: true}) {
  const size = {w: 1, h: 1};
  const nodeFrame = new NodeFrame();
  return {
    backend,
    _nodes: {nodeFrame},
    nodeFrame,
    getDrawingBufferSize(v: Vector2) {
      return v.set(size.w, size.h);
    },
    getPixelRatio: () => 1,
    setPixelRatio: () => {},
    setSize(w: number, h: number) {
      size.w = w;
      size.h = h;
    },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    getClearColor: (c: Color) => c,
    getClearAlpha: () => 1,
    setClearColor: () => {},
  };
}

/** A pipeline over {@link fakeRenderer}; the GPU passes record the node-frame time instead. */
function fakePipeline(
  options: {buildPaletteLut?: PaletteLutBuilder; backend?: object} = {},
) {
  const r = fakeRenderer(options.backend);
  const binder = new SettingsBinder();
  const made = createPixelPipeline({
    renderer: r as unknown as WebGPURenderer,
    scene: new Scene(),
    binder,
    ...(options.buildPaletteLut === undefined
      ? {}
      : {buildPaletteLut: options.buildPaletteLut}),
  });
  if (!made.ok) throw new Error(made.error.message);
  const pipeline = made.value;
  const seen: Array<{time: number; deltaTime: number}> = [];
  pipeline.scenePass.updateBefore = () => {
    seen.push({time: r.nodeFrame.time, deltaTime: r.nodeFrame.deltaTime});
    return undefined;
  };
  // The post chains are created per structure (POST_CHAIN_CACHE_SIZE); none draws in Node.
  vi.spyOn(RenderPipeline.prototype, 'render').mockImplementation(() => {});
  return {pipeline, binder, renderer: r, seen};
}

/** `buildPaletteLut`, memoized (the OKLab LUT takes a while in Node). */
const LUTS = new Map<string, Uint8Array>();
const memoLut: PaletteLutBuilder = (colors, metric) => {
  const key = `${metric}:${colors.join(',')}`;
  let lut = LUTS.get(key);
  if (lut === undefined) {
    lut = buildPaletteLut(colors, metric);
    LUTS.set(key, lut);
  }
  return lut;
};

const PICO = (): RenderSettings => {
  const s = defaultRenderSettings();
  return {...s, palette: {...s.palette, id: 'pico-8'}};
};

describe('pixel pipeline (fake renderer)', () => {
  it('AC-PIX-027.1 / review L1: export frames see node-frame time 0 whatever the wall clock; the preview passes its frame time', async () => {
    const {pipeline, seen} = fakePipeline();
    await pipeline.setRenderSettings(defaultRenderSettings());
    pipeline.setFraming({
      worldPerPx: 0.05,
      elevationDeg: 0,
      frustum: {left: -32, right: 32, top: 60, bottom: -4},
      pivotPx: [32, 60],
      clipped: [],
    } satisfies Framing);
    const now = vi.spyOn(performance, 'now');
    try {
      for (const wall of [1000, 123_456, 9e9]) {
        now.mockReturnValue(wall);
        pipeline.render();
      }
      pipeline.render(0.25);
      pipeline.render(0.5);
      pipeline.render(0.5);
      pipeline.render();
    } finally {
      now.mockRestore();
    }
    expect(seen).toEqual([
      {time: 0, deltaTime: 0},
      {time: 0, deltaTime: 0},
      {time: 0, deltaTime: 0},
      {time: 0.25, deltaTime: 0.25},
      {time: 0.5, deltaTime: 0.25},
      {time: 0.5, deltaTime: 0},
      {time: 0, deltaTime: 0},
    ]);
    pipeline.dispose();
  });

  it(
    'AC-PIX-021.2 / review M2: a failing LUT build applies nothing; the previous settings, post node and palette stay',
    {timeout: 30_000},
    async () => {
      let fail = false;
      const builder: PaletteLutBuilder = async (colors, metric) => {
        await Promise.resolve();
        if (fail) throw new Error('worker failed');
        return memoLut(colors, metric);
      };
      const {pipeline, binder} = fakePipeline({buildPaletteLut: builder});
      const before = PICO();
      await pipeline.setRenderSettings(before);
      const rebuilds = pipeline.stats.rebuilds;
      const lut = (binder.paletteLutNode().value as DataTexture).image
        .data as Uint8Array;
      const lutBefore = lut.slice();
      fail = true;
      const next = {
        ...before,
        resolution: {width: 32, height: 48},
        alphaCutoff: 0.3,
        palette: {...before.palette, id: 'endesga-32' as const},
      };
      await expect(pipeline.setRenderSettings(next)).rejects.toThrow(
        'worker failed',
      );
      expect(pipeline.settings).toBe(before);
      expect(binder.settings).toBe(before);
      expect(binder.paletteReady).toBe(true);
      expect(pipeline.stats.rebuilds).toBe(rebuilds);
      expect(pipeline.cellTarget.width).toBe(before.resolution.width);
      expect(lut.every((v, i) => v === lutBefore[i])).toBe(true);
      // Recovers once the builder works again.
      fail = false;
      await pipeline.setRenderSettings(next);
      expect(pipeline.settings).toBe(next);
      expect(pipeline.cellTarget.width).toBe(32);
      pipeline.dispose();
    },
  );

  it(
    'review M2: a later call supersedes one still waiting for its LUT',
    {timeout: 30_000},
    async () => {
      let release!: () => void;
      const gate = new Promise<void>(r => {
        release = r;
      });
      const builder: PaletteLutBuilder = async (colors, metric) => {
        await gate;
        return memoLut(colors, metric);
      };
      const {pipeline} = fakePipeline({buildPaletteLut: builder});
      const base = defaultRenderSettings();
      await pipeline.setRenderSettings(base);
      const slow = pipeline.setRenderSettings(PICO());
      const fast = {...base, alphaCutoff: 0.3};
      await pipeline.setRenderSettings(fast);
      release();
      await slow;
      expect(pipeline.settings).toBe(fast);
      pipeline.dispose();
    },
  );

  it('AC-PIX-034.2: switching back to a recent post structure reuses its compiled chain (LRU of POST_CHAIN_CACHE_SIZE), uniform changes stay rebuild-free', async () => {
    const {pipeline} = fakePipeline({buildPaletteLut: memoLut});
    const dispose = vi.spyOn(RenderPipeline.prototype, 'dispose');
    const active = () => (pipeline as unknown as {post: RenderPipeline}).post;
    const withDither = (mode: 'none' | 'bayer2' | 'bayer4' | 'bayer8') => ({
      ...PICO(),
      palette: {...PICO().palette, dither: {mode, strength: 0.5}},
    });
    const none = {
      ...defaultRenderSettings(),
      palette: {...PICO().palette, id: 'none' as const},
    };
    try {
      await pipeline.setRenderSettings(withDither('none'));
      const first = active();
      // The first build replaces (and disposes) the uncached placeholder chain.
      expect(dispose).toHaveBeenCalledTimes(1);
      dispose.mockClear();
      await pipeline.setRenderSettings(withDither('bayer4'));
      const bayer4 = active();
      expect(pipeline.stats.rebuilds).toBe(2);
      expect(bayer4).not.toBe(first);
      // Back to a cached structure: no build, the same compiled chain.
      await pipeline.setRenderSettings(withDither('none'));
      expect(active()).toBe(first);
      await pipeline.setRenderSettings({
        ...withDither('bayer4'),
        alphaCutoff: 0.3,
      });
      expect(active()).toBe(bayer4);
      expect(pipeline.stats.rebuilds).toBe(2);
      expect(dispose).not.toHaveBeenCalled();
      // Fill the cache past its size: the least recently used chain is evicted and disposed.
      await pipeline.setRenderSettings(withDither('bayer8'));
      await pipeline.setRenderSettings(none);
      expect(POST_CHAIN_CACHE_SIZE).toBe(4);
      expect(pipeline.stats.rebuilds).toBe(4);
      expect(dispose).not.toHaveBeenCalled();
      await pipeline.setRenderSettings(withDither('bayer2'));
      expect(pipeline.stats.rebuilds).toBe(5);
      expect(dispose).toHaveBeenCalledTimes(1);
      await pipeline.setRenderSettings(withDither('bayer4'));
      expect(active()).toBe(bayer4);
      expect(pipeline.stats.rebuilds).toBe(5);
      await pipeline.setRenderSettings(withDither('none'));
      expect(active()).not.toBe(first); // evicted: built again
      expect(pipeline.stats.rebuilds).toBe(6);
      dispose.mockClear();
      pipeline.dispose();
      expect(dispose).toHaveBeenCalledTimes(POST_CHAIN_CACHE_SIZE);
    } finally {
      dispose.mockRestore();
    }
  });

  it('review L2: dispose closes the WebGL2 fence-wait channel', () => {
    const original = () => Promise.resolve();
    const utils = {_clientWaitAsync: original};
    const gl = {getExtension: () => ({})};
    const close = vi.spyOn(MessagePort.prototype, 'close');
    try {
      const {pipeline} = fakePipeline({backend: {gl, utils}});
      expect(utils._clientWaitAsync).not.toBe(original);
      expect(close).not.toHaveBeenCalled();
      pipeline.dispose();
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      close.mockRestore();
    }
  });
});
