/**
 * GPU tests of the M2-13 post stages on both backends (`pnpm test:gpu`):
 * sRGB conversion, Bayer dither, palette lookup and final alpha, chained in the
 * REQ-PIX-025 order through a `RenderPipeline` with `outputColorTransform`
 * off into an RGBA8 `NoColorSpace` target. Pixel asserts against the CPU
 * references (`linearToSrgb8` codes, `quantizeReference`, `bayerMatrix`); no
 * golden PNGs (D2 pending).
 *
 * AC-PIX-018.1, 018.2, 021.3, 022.1, 022.2, 022.3, 002.2 (synthetic input),
 * 023.1 (synthetic input), REQ-PIX-024.
 */
import {
  PALETTE_PRESETS,
  defaultRenderSettings,
  hexToRgb,
} from '@csg/parts-schema';
import type {HexColor, RenderSettings} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {ivec2, texture, vec4} from 'three/tsl';
import type {Node} from 'three/webgpu';
import type {TslNode} from '@csg/shader-graph/tsl';
import {bayerMatrix} from '../../src/pipeline/bayer';
import {
  buildPaletteLut,
  quantizeReference,
} from '../../src/pipeline/palette-lut';
import {normalizeReadback} from '../../src/pipeline/readback';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {SRGB8_TO_LINEAR} from '../../src/pipeline/srgb8';
import {createStageContext} from '../../src/pipeline/stage-context';
import type {StageContext} from '../../src/pipeline/stage-context';
import {
  DITHER_SPREAD,
  bayerDither,
  defaultBayerDitherInputs,
  finalAlpha,
  defaultFinalAlphaInputs,
  linearToSrgb,
  paletteLutTexel,
  paletteQuantize,
  defaultPaletteQuantizeInputs,
  srgb8Code,
} from '../../src/pipeline/stages/index';
import {createGpuHarness, currentBackend, readbackLayout} from './harness';
import type {GpuHarness} from './harness';

const W = 64;
const H = 64;

/** A linear RGBA float input image, fed to the post graph as `scene.color`. */
function floatInput(
  fill: (x: number, y: number) => readonly [number, number, number, number],
): THREE.DataTexture {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      data.set(fill(x, y), (y * W + x) * 4);
    }
  }
  const tex = new THREE.DataTexture(
    data,
    W,
    H,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

function settingsWith(
  palette: Partial<RenderSettings['palette']>,
): RenderSettings {
  const s = defaultRenderSettings();
  return {...s, palette: {...s.palette, ...palette}};
}

/** Binder + post context; uploads the LUT of a palette. */
function setup(
  h: GpuHarness,
  settings: RenderSettings,
  colors: readonly HexColor[] | null,
): {binder: SettingsBinder; ctx: StageContext; lut: Uint8Array | null} {
  const binder = new SettingsBinder(settings);
  let lut: Uint8Array | null = null;
  if (colors !== null) {
    lut = buildPaletteLut(colors, settings.palette.metric);
    binder.setPaletteLut(lut);
  }
  expect(binder.paletteReady).toBe(true);
  const ctx = createStageContext({
    binder,
    target: 'post',
    mode: 'export',
    backend: h.backend,
  });
  return {binder, ctx, lut};
}

interface Chain {
  srgb: TslNode;
  dithered: TslNode;
  quantized: TslNode;
  final: TslNode;
}

/** The REQ-PIX-025 chain from the sRGB stage on, with the matrix field default. */
function chain(
  ctx: StageContext,
  input: THREE.DataTexture,
  matrix?: 0 | 2 | 4 | 8,
): Chain {
  const px = ctx.builtin('screenPos') as Node<'vec2'>;
  const color = texture(input).load(ivec2(px));
  const {out: srgb} = linearToSrgb(ctx, {color}, {});
  const {color: dithered} = bayerDither(
    ctx,
    {color: srgb, ...defaultBayerDitherInputs(ctx)},
    {matrix: matrix ?? ctx.ditherMatrixSize},
  );
  const {color: quantized} = paletteQuantize(
    ctx,
    {color: dithered, ...defaultPaletteQuantizeInputs(ctx)},
    {},
  );
  const {color: final} = finalAlpha(
    ctx,
    {color: quantized, ...defaultFinalAlphaInputs(ctx)},
    {},
  );
  return {srgb, dithered, quantized, final};
}

/** A post output rendered with `outputColorTransform` off (REQ-PIX-024). */
interface PostRender {
  read(): Promise<Uint8ClampedArray>;
  dispose(): void;
}

function postRender(h: GpuHarness, output: TslNode): PostRender {
  const rt = new THREE.RenderTarget(W, H, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    samples: 0,
  });
  const pipeline = new THREE.RenderPipeline(h.renderer, output as Node<'vec4'>);
  pipeline.outputColorTransform = false;
  return {
    async read() {
      h.renderer.setRenderTarget(rt);
      pipeline.render();
      h.renderer.setRenderTarget(null);
      const raw = (await h.renderer.readRenderTargetPixelsAsync(
        rt,
        0,
        0,
        W,
        H,
      )) as Uint8Array;
      return normalizeReadback(raw, W, H, readbackLayout(h.backend, W));
    },
    dispose() {
      pipeline.dispose();
      rt.dispose();
    },
  };
}

async function renderOnce(
  h: GpuHarness,
  output: TslNode,
): Promise<Uint8ClampedArray> {
  const r = postRender(h, output);
  try {
    return await r.read();
  } finally {
    r.dispose();
  }
}

const at = (a: Uint8ClampedArray, x: number, y: number): number[] =>
  Array.from(a.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));

const lin = (c8: number): number => SRGB8_TO_LINEAR[c8] as number;

/** Deterministic linear gradient: every pixel a different 8-bit code triple. */
const gradient = (x: number, y: number) =>
  [
    lin((x * 4 + y) & 255),
    lin((y * 4 + 3 * x) & 255),
    lin((x * 7 + y * 13) & 255),
    1,
  ] as const;

describe(`post stages (${currentBackend()})`, () => {
  let h: GpuHarness;
  const disposables: Array<{dispose(): void}> = [];
  beforeAll(async () => {
    h = await createGpuHarness(W, H);
  });
  afterAll(() => {
    for (const d of disposables) d.dispose();
    h.dispose();
  });

  it('AC-PIX-018.2: palette none outputs the 8-bit sRGB codes of the explicit conversion (REQ-PIX-024)', async () => {
    const input = floatInput((x, y) => {
      const i = y * W + x;
      return [lin(i & 255), lin(255 - (i & 255)), lin((i * 7) & 255), 1];
    });
    const {binder, ctx} = setup(
      h,
      settingsWith({id: 'none', dither: {mode: 'none', strength: 0.5}}),
      null,
    );
    disposables.push(input, binder);
    const out = await renderOnce(h, chain(ctx, input).final);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        expect(at(out, x, y), `pixel ${x},${y}`).toEqual([
          i & 255,
          255 - (i & 255),
          (i * 7) & 255,
          255,
        ]);
      }
    }
  });

  it('AC-PIX-022.3: dither enabled with palette none is ignored', async () => {
    const input = floatInput(gradient);
    const none = setup(
      h,
      settingsWith({id: 'none', dither: {mode: 'none', strength: 1}}),
      null,
    );
    const dithered = setup(
      h,
      settingsWith({id: 'none', dither: {mode: 'bayer8', strength: 1}}),
      null,
    );
    disposables.push(input, none.binder, dithered.binder);
    expect(dithered.ctx.ditherMatrixSize).toBe(0);
    const a = await renderOnce(h, chain(none.ctx, input).final);
    const b = await renderOnce(h, chain(dithered.ctx, input).final);
    expect(b).toEqual(a);
  });

  for (const id of ['pico-8', 'endesga-32'] as const) {
    it(`AC-PIX-021.3 / AC-PIX-018.1: GPU indices equal quantizeReference on a dithered gradient (${id})`, async () => {
      const colors = PALETTE_PRESETS[id].colors;
      const input = floatInput(gradient);
      const {binder, ctx, lut} = setup(
        h,
        settingsWith({
          id,
          metric: 'oklab',
          dither: {mode: 'bayer4', strength: 0.5},
        }),
        colors,
      );
      disposables.push(input, binder);
      const c = chain(ctx, input);
      // Debug target: the pre-quantization colors as the GPU encodes them (c8 / 255).
      const pre = await renderOnce(
        h,
        vec4(
          (srgb8Code((c.dithered as Node<'vec4'>).rgb) as Node<'vec3'>).div(
            255,
          ),
          1,
        ),
      );
      const idx = await renderOnce(
        h,
        paletteLutTexel(ctx.builtin('render.paletteLut'), c.dithered),
      );
      const out = await renderOnce(h, c.final);
      const palette = colors.map(hex => hexToRgb(hex));
      const paletteKeys = new Set(
        palette.map(p => (p === null ? '' : p.join(','))),
      );
      let matches = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const [r, g, b] = at(pre, x, y) as [number, number, number];
          const ref = quantizeReference(lut as Uint8Array, [r, g, b]);
          const gpuIndex = at(idx, x, y)[3];
          if (gpuIndex === ref) matches++;
          const o = at(out, x, y);
          expect(o[3]).toBe(255);
          // AC-PIX-018.1: every opaque pixel is a palette color, the one of its index.
          expect(paletteKeys.has(o.slice(0, 3).join(','))).toBe(true);
          expect(o.slice(0, 3)).toEqual(palette[ref]);
        }
      }
      expect(matches).toBe(W * H); // 100 % of pixels
      // The dither actually moved some colors (the test is not vacuous).
      const undithered = setup(
        h,
        settingsWith({
          id,
          metric: 'oklab',
          dither: {mode: 'none', strength: 0.5},
        }),
        colors,
      );
      disposables.push(undithered.binder);
      const plain = await renderOnce(h, chain(undithered.ctx, input).final);
      expect(plain).not.toEqual(out);
    });
  }

  it('AC-PIX-022.1: strength 0 equals the undithered output byte for byte', async () => {
    const colors = PALETTE_PRESETS['endesga-32'].colors;
    const input = floatInput(gradient);
    const zero = setup(
      h,
      settingsWith({id: 'endesga-32', dither: {mode: 'bayer4', strength: 0}}),
      colors,
    );
    const off = setup(
      h,
      settingsWith({id: 'endesga-32', dither: {mode: 'none', strength: 0}}),
      colors,
    );
    disposables.push(input, zero.binder, off.binder);
    expect(zero.ctx.ditherMatrixSize).toBe(4);
    for (const m of [2, 4, 8] as const) {
      const a = await renderOnce(h, chain(zero.ctx, input, m).final);
      const b = await renderOnce(h, chain(off.ctx, input).final);
      expect(a).toEqual(b);
    }
  });

  it('AC-PIX-022.2: bayer4 on flat blocks repeats every 4 px, is identical across frames and matches the CPU model', async () => {
    const colors = PALETTE_PRESETS['endesga-32'].colors;
    // 8×8 flat blocks of one gray code each.
    const code = (x: number, y: number) => 24 + 3 * ((y >> 3) * 8 + (x >> 3));
    const input = floatInput((x, y) => {
      const v = lin(code(x, y));
      return [v, v, v, 1];
    });
    const strength = 1;
    const {binder, ctx, lut} = setup(
      h,
      settingsWith({
        id: 'endesga-32',
        metric: 'oklab',
        dither: {mode: 'bayer4', strength},
      }),
      colors,
    );
    disposables.push(input, binder);
    const r = postRender(h, chain(ctx, input).final);
    disposables.push(r);
    const frame1 = await r.read();
    const frame2 = await r.read();
    expect(frame2).toEqual(frame1);
    const m4 = bayerMatrix(4);
    const palette = colors.map(hex => hexToRgb(hex));
    let patterned = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = at(frame1, x, y);
        if ((x & 7) < 4) expect(at(frame1, x + 4, y)).toEqual(o);
        if ((y & 7) < 4) expect(at(frame1, x, y + 4)).toEqual(o);
        const t = ((m4[y % 4]?.[x % 4] ?? 0) + 0.5) / 16 - 0.5;
        const c8 = Math.min(
          255,
          Math.max(
            0,
            Math.floor(code(x, y) + t * strength * DITHER_SPREAD * 255 + 0.5),
          ),
        );
        const ref = quantizeReference(lut as Uint8Array, [c8, c8, c8]);
        expect(o, `pixel ${x},${y}`).toEqual([
          ...(palette[ref] as number[]),
          255,
        ]);
      }
    }
    for (let by = 0; by < H; by += 8) {
      for (let bx = 0; bx < W; bx += 8) {
        const seen = new Set<string>();
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++)
            seen.add(at(frame1, bx + x, by + y).join(','));
        }
        if (seen.size > 1) patterned++;
      }
    }
    expect(patterned).toBeGreaterThan(0);
  });

  it('AC-PIX-022.5: the bayer4 threshold + 0.5 on R reads 8, 135, 199, 72 at (0,0), (1,0), (0,1), (1,1) (top-left origin, y down)', async () => {
    const input = floatInput(() => [0, 0, 0, 1]);
    const {binder, ctx} = setup(
      h,
      settingsWith({id: 'none', dither: {mode: 'bayer4', strength: 1}}),
      null,
    );
    disposables.push(input, binder);
    const {threshold} = bayerDither(
      ctx,
      {color: vec4(0, 0, 0, 1), ...defaultBayerDitherInputs(ctx)},
      {matrix: 4},
    );
    const out = await renderOnce(
      h,
      vec4((threshold as Node<'float'>).add(0.5), 0, 0, 1),
    );
    const want: Array<[number, number, number]> = [
      [0, 0, 8],
      [1, 0, 135],
      [0, 1, 199],
      [1, 1, 72],
    ];
    for (const [x, y, r] of want)
      expect(
        Math.abs((at(out, x, y)[0] as number) - r),
        `(${x},${y})`,
      ).toBeLessThanOrEqual(1);
    const r = (x: number, y: number) => at(out, x, y)[0] as number;
    // A transposed index or a bottom-left origin breaks this ordering.
    expect(r(0, 1)).toBeGreaterThan(r(1, 0));
    expect(r(1, 0)).toBeGreaterThan(r(1, 1));
    expect(r(1, 1)).toBeGreaterThan(r(0, 0));
  });

  it('AC-PIX-002.2 / AC-PIX-023.1: final alpha is binary, transparent pixels are exactly (0,0,0,0), cutoff is a live uniform', async () => {
    const alpha = (x: number, y: number) => (y * W + x) / (W * H - 1);
    const input = floatInput((x, y) => [
      lin(200),
      lin(100),
      lin(50),
      alpha(x, y),
    ]);
    const {binder, ctx} = setup(h, settingsWith({id: 'none'}), null);
    disposables.push(input, binder);
    const r = postRender(h, chain(ctx, input).final);
    disposables.push(r);
    for (const cutoff of [0.5, 0.3]) {
      binder.apply({...defaultRenderSettings(), alphaCutoff: cutoff});
      const out = await r.read();
      let opaque = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const o = at(out, x, y);
          const covered = Math.fround(alpha(x, y)) >= Math.fround(cutoff);
          expect(o, `pixel ${x},${y} cutoff ${cutoff}`).toEqual(
            covered ? [200, 100, 50, 255] : [0, 0, 0, 0],
          );
          if (covered) opaque++;
        }
      }
      expect(opaque).toBeGreaterThan(0);
      expect(opaque).toBeLessThan(W * H);
    }
  });
});
