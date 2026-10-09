/**
 * GPU tests of the coverage, edge-detect and outline stages (M2-12) on both
 * backends, on hand-built fp16 scene MRT cells (no scene render). Each case
 * renders the stage chain through a `RenderPipeline` (outputColorTransform
 * off) into an RGBA8 NoColorSpace cell target and asserts pixels, both by hand
 * and against the CPU reference of the same rules.
 *
 * AC-PIX-015.1/.2, AC-PIX-016.1/.2/.3, AC-PIX-017.1/.2/.3, AC-PIX-023.1,
 * AC-PIX-034.1 (width is a uniform: no recompile across widths).
 */
import {defaultRenderSettings, hexToRgb} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {texture, vec4} from 'three/tsl';
import type {TslNode} from '@csg/shader-graph/tsl';
import type {Node} from 'three/webgpu';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {srgb8ToLinear} from '../../src/pipeline/srgb8';
import {createStageContext} from '../../src/pipeline/stage-context';
import type {StageContext} from '../../src/pipeline/stage-context';
import {
  alphaCutoff,
  defaultAlphaCutoffInputs,
} from '../../src/pipeline/stages/coverage';
import {
  defaultEdgeDetectInputs,
  edgeDetect,
  edgeSourcesFromSettings,
  referenceEdgeDetect,
} from '../../src/pipeline/stages/edge-detect';
import type {MrtCell} from '../../src/pipeline/stages/edge-detect';
import {
  CellBuilder,
  disc,
  referenceOutlineChain,
  toUnorm8,
} from '../../src/pipeline/stages/outline-test-cells';
import type {OutlineParams} from '../../src/pipeline/stages/outline-test-cells';
import {
  defaultOutlineInputs,
  outline,
  outlineFieldsFromSettings,
} from '../../src/pipeline/stages/outline';
import {createGpuHarness, currentBackend, readbackLayout} from './harness';
import type {GpuHarness} from './harness';
import {normalizeReadback} from '../../src/pipeline/readback';

const RED = [0.75, 0.25, 0.375, 1] as const;
const BLUE = [0.25, 0.375, 0.75, 1] as const;
const GREEN = [0.25, 0.75, 0.375, 1] as const;

type Output = 'chain' | 'masks';

/** Half-float RGBA DataTexture over `rgba` (top-left rows; DataTexture loads are not flipped). */
function halfTexture(
  rgba: Float32Array,
  w: number,
  h: number,
): THREE.DataTexture {
  const data = new Uint16Array(rgba.length);
  for (let i = 0; i < rgba.length; i++) {
    data[i] = THREE.DataUtils.toHalfFloat(rgba[i] ?? 0);
  }
  const t = new THREE.DataTexture(
    data,
    w,
    h,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** A compiled stage chain over one cell; re-renderable after uniform changes. */
class StageRig {
  readonly binder: SettingsBinder;
  private readonly textures: THREE.DataTexture[];
  private readonly pipeline: THREE.RenderPipeline;
  private readonly target: THREE.RenderTarget;

  constructor(
    private readonly h: GpuHarness,
    readonly cell: MrtCell,
    settings: RenderSettings,
    output: Output,
  ) {
    const {width: w, height: hh} = cell;
    this.binder = new SettingsBinder();
    this.apply(settings);
    const ids = new Float32Array(w * hh * 4);
    cell.partId.forEach((v, i) => (ids[i * 4] = v));
    this.textures = [
      halfTexture(cell.color, w, hh),
      halfTexture(cell.normalDepth, w, hh),
      halfTexture(ids, w, hh),
    ];
    const [color, nd, id] = this.textures.map(t => texture(t));
    const ctx: StageContext = createStageContext({
      binder: this.binder,
      target: 'post',
      mode: 'export',
      backend: h.backend,
      sources: {
        'scene.color': color!,
        'scene.normal': nd!,
        'scene.depth': nd!,
        'scene.partId': id!,
      },
    });
    const cov = alphaCutoff(ctx, defaultAlphaCutoffInputs(ctx), {});
    const e = edgeDetect(ctx, defaultEdgeDetectInputs(ctx), {
      sources: edgeSourcesFromSettings(settings.outline.inner),
    });
    const o = outline(
      ctx,
      {
        color: cov.color,
        outer: e.outer,
        inner: e.inner,
        source: e.source,
        ...defaultOutlineInputs(ctx),
      },
      outlineFieldsFromSettings(settings.outline),
    );
    const node: TslNode =
      output === 'chain'
        ? o.color
        : vec4(e.outer as Node<'float'>, e.inner as Node<'float'>, 0, 1);
    this.pipeline = new THREE.RenderPipeline(h.renderer, node);
    this.pipeline.outputColorTransform = false;
    this.target = new THREE.RenderTarget(w, hh, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      samples: 0,
    });
  }

  /** Writes settings into the uniforms (no recompile) and the cell resolution. */
  apply(settings: RenderSettings): void {
    this.binder.apply(settings);
    this.binder.resolution.value.set(this.cell.width, this.cell.height);
  }

  async render(): Promise<Uint8ClampedArray> {
    const {width: w, height: hh} = this.cell;
    const r = this.h.renderer;
    r.setRenderTarget(this.target);
    this.pipeline.render();
    r.setRenderTarget(null);
    const raw = (await r.readRenderTargetPixelsAsync(
      this.target,
      0,
      0,
      w,
      hh,
    )) as Uint8Array;
    return normalizeReadback(raw, w, hh, readbackLayout(this.h.backend, w));
  }

  dispose(): void {
    this.pipeline.dispose();
    this.target.dispose();
    for (const t of this.textures) t.dispose();
    this.binder.dispose();
  }
}

type Mutable<T> = {-readonly [K in keyof T]: Mutable<T[K]>};

function settingsWith(
  edit: (s: Mutable<RenderSettings>) => void,
): RenderSettings {
  const s = structuredClone(defaultRenderSettings()) as Mutable<RenderSettings>;
  s.outline.inner.enabled = false;
  // These cases were written for one mode on both line kinds (FX-J made the
  // outer default `black` and added `inner.colorMode`).
  s.outline.colorMode = 'darken';
  s.outline.inner.colorMode = 'darken';
  // 0.5 keeps every expected channel away from a .5 rounding boundary.
  s.outline.darkenAmount = 0.5;
  edit(s);
  return s as RenderSettings;
}

function linearHex(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex);
  if (rgb === null) throw new Error(hex);
  return [srgb8ToLinear(rgb[0]), srgb8ToLinear(rgb[1]), srgb8ToLinear(rgb[2])];
}

function paramsOf(
  s: RenderSettings,
  black: readonly [number, number, number] = [0, 0, 0],
): OutlineParams {
  return {
    cutoff: s.alphaCutoff,
    widthPx: s.outline.outer.widthPx,
    outerEnabled: s.outline.outer.enabled,
    innerEnabled: s.outline.inner.enabled,
    depthThresholdPx: s.outline.inner.depthThresholdPx,
    normalThresholdDeg: s.outline.inner.normalThresholdDeg,
    sources: edgeSourcesFromSettings(s.outline.inner),
    mode: s.outline.colorMode,
    darkenAmount: s.outline.darkenAmount,
    customColor: linearHex(s.outline.color ?? '#000000'),
    black,
  };
}

const px = (a: ArrayLike<number>, w: number, x: number, y: number) =>
  Array.from({length: 4}, (_, i) => a[(y * w + x) * 4 + i]);

/** "x,y" of every pixel whose channel `c` is 255. */
function maskPixels(rgba: ArrayLike<number>, w: number, c: number): string[] {
  const out: string[] = [];
  for (let i = 0; i * 4 < rgba.length; i++) {
    if (rgba[i * 4 + c] === 255) out.push(`${i % w},${Math.floor(i / w)}`);
  }
  return out.sort();
}

function refPixels(mask: Uint8Array, w: number): string[] {
  const out: string[] = [];
  mask.forEach((v, i) => {
    if (v === 1) out.push(`${i % w},${Math.floor(i / w)}`);
  });
  return out.sort();
}

async function renderOnce(
  h: GpuHarness,
  cell: MrtCell,
  s: RenderSettings,
  output: Output,
): Promise<Uint8ClampedArray> {
  const rig = new StageRig(h, cell, s, output);
  try {
    return await rig.render();
  } finally {
    rig.dispose();
  }
}

describe(`outline stages on synthetic MRT (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(32, 32);
  });
  afterAll(() => h?.dispose());

  it('AC-PIX-015.1, AC-PIX-023.1: width 1 outline = transparent 4-neighbours of coverage; alpha only 0/255, alpha 0 ⇒ RGB 0', async () => {
    // A blob touching the left and top cell borders (no clamped-fetch artefacts).
    const b = disc(new CellBuilder(32, 32), 14, 15, 9, {color: RED})
      .rect(0, 0, 4, 2, {color: BLUE})
      .rect(28, 20, 31, 31, {color: GREEN});
    // Semi-transparent pixels below the cutoff are not coverage.
    b.rect(20, 2, 24, 4, {color: [0.75, 0.75, 0.75, 0.375]});
    const cell = b.build();
    const s = settingsWith(() => {});
    const masks = await renderOnce(h, cell, s, 'masks');
    const ref = referenceEdgeDetect(cell, paramsOf(s));
    expect(maskPixels(masks, 32, 0)).toEqual(refPixels(ref.outer, 32));
    expect(maskPixels(masks, 32, 1)).toEqual([]);
    // Hand check: transparent pixels 4-adjacent to coverage, nothing else.
    const cov = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x < 32 &&
      y < 32 &&
      (cell.color[(y * 32 + x) * 4 + 3] ?? 0) >= 0.5;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const adj =
          cov(x, y - 1) || cov(x - 1, y) || cov(x + 1, y) || cov(x, y + 1);
        expect(px(masks, 32, x, y)[0]).toBe(!cov(x, y) && adj ? 255 : 0);
      }
    }
    const chain = await renderOnce(h, cell, s, 'chain');
    expect(Array.from(chain)).toEqual(
      Array.from(toUnorm8(referenceOutlineChain(cell, paramsOf(s)))),
    );
    for (let i = 0; i < chain.length; i += 4) {
      expect([0, 255]).toContain(chain[i + 3]);
      if (chain[i + 3] === 0) {
        expect([chain[i], chain[i + 1], chain[i + 2]]).toEqual([0, 0, 0]);
      }
    }
  });

  it('AC-PIX-015.2: width 1 is exactly 1 px at 32 px and 128 px; widths 2–3 via uniforms only (AC-PIX-034.1)', async () => {
    for (const size of [32, 128]) {
      const cell = disc(
        new CellBuilder(size, size),
        size / 2,
        size / 2,
        size / 4,
        {
          color: RED,
        },
      ).build();
      const s1 = settingsWith(() => {});
      const rig = new StageRig(h, cell, s1, 'masks');
      try {
        for (const widthPx of [1, 2, 3] as const) {
          const s = settingsWith(x => {
            x.outline.outer.widthPx = widthPx;
          });
          rig.apply(s);
          const masks = await rig.render();
          const ref = referenceEdgeDetect(cell, paramsOf(s));
          expect(maskPixels(masks, size, 0)).toEqual(
            refPixels(ref.outer, size),
          );
          if (widthPx === 1) {
            // Along the row through the centre the band is 1 px on each side.
            const row = size / 2;
            const xs = maskPixels(masks, size, 0)
              .map(p => p.split(',').map(Number))
              .filter(([, y]) => y === row)
              .map(([x]) => x);
            expect(xs).toHaveLength(2);
          }
        }
      } finally {
        rig.dispose();
      }
    }
  });

  it('AC-PIX-016.1: part-ID source only, sword in front of torso → 1 px line on torso pixels', async () => {
    const cell = new CellBuilder(16, 16)
      .rect(2, 2, 13, 13, {color: RED, id: 2, depth: 0})
      .rect(7, 0, 8, 15, {color: BLUE, id: 5, depth: 3})
      .build();
    const s = settingsWith(x => {
      x.outline.inner.enabled = true;
      x.outline.inner.partId = true;
      x.outline.outer.enabled = false;
    });
    const masks = await renderOnce(h, cell, s, 'masks');
    const expected: string[] = [];
    for (let y = 2; y <= 13; y++) expected.push(`6,${y}`, `9,${y}`);
    expect(maskPixels(masks, 16, 1)).toEqual(expected.sort());
    expect(maskPixels(masks, 16, 0)).toEqual([]);
    const chain = await renderOnce(h, cell, s, 'chain');
    expect(Array.from(chain)).toEqual(
      Array.from(toUnorm8(referenceOutlineChain(cell, paramsOf(s)))),
    );
    // Darken 0.5 of the torso's own colour on the line.
    expect(px(chain, 16, 6, 5)).toEqual([
      Math.round(0.75 * 0.5 * 255),
      Math.round(0.25 * 0.5 * 255),
      Math.round(0.375 * 0.5 * 255),
      255,
    ]);
  });

  it('AC-PIX-016.2: all sources off → inner region equals the render without inner lines', async () => {
    const cell = new CellBuilder(16, 16)
      .rect(2, 2, 13, 13, {color: RED, id: 2, depth: 0})
      .rect(7, 0, 8, 15, {color: BLUE, id: 5, depth: 9, normal: [1, 0, 0]})
      .build();
    const noInner = await renderOnce(
      h,
      cell,
      settingsWith(() => {}),
      'chain',
    );
    const off = await renderOnce(
      h,
      cell,
      settingsWith(x => {
        x.outline.inner.enabled = true;
        x.outline.inner.partId = false;
        x.outline.inner.depth = false;
        x.outline.inner.normal = false;
      }),
      'chain',
    );
    expect(Array.from(off)).toEqual(Array.from(noInner));
  });

  it('AC-PIX-016.3: depth only, threshold 4 → line on the farther quad at B/C (5 px), none at A/B (3 px)', async () => {
    const cell = new CellBuilder(12, 4)
      .rect(0, 0, 3, 3, {color: RED, depth: 8})
      .rect(4, 0, 7, 3, {color: GREEN, depth: 5})
      .rect(8, 0, 11, 3, {color: BLUE, depth: 0})
      .build();
    const s = settingsWith(x => {
      x.outline.inner.enabled = true;
      x.outline.inner.partId = false;
      x.outline.inner.depth = true;
      x.outline.inner.depthThresholdPx = 4;
    });
    const masks = await renderOnce(h, cell, s, 'masks');
    expect(maskPixels(masks, 12, 1)).toEqual(['8,0', '8,1', '8,2', '8,3']);
  });

  it('REQ-PIX-016 (normal source, AC-PIX-016.2 counterpart): creases above normalThresholdDeg draw', async () => {
    const cell = new CellBuilder(8, 2)
      .rect(0, 0, 3, 1, {color: RED, normal: [0, 0, 1], depth: 1})
      .rect(4, 0, 7, 1, {color: RED, normal: [1, 0, 0], depth: 0})
      .build();
    const s = settingsWith(x => {
      x.outline.inner.enabled = true;
      x.outline.inner.partId = false;
      x.outline.inner.normal = true;
      x.outline.inner.normalThresholdDeg = 60;
    });
    const rig = new StageRig(h, cell, s, 'masks');
    try {
      expect(maskPixels(await rig.render(), 8, 1)).toEqual(['4,0', '4,1']);
      rig.apply(
        settingsWith(x => {
          x.outline.inner.enabled = true;
          x.outline.inner.partId = false;
          x.outline.inner.normal = true;
          x.outline.inner.normalThresholdDeg = 95;
        }),
      );
      expect(maskPixels(await rig.render(), 8, 1)).toEqual([]);
    } finally {
      rig.dispose();
    }
  });

  it('AC-PIX-016.4: equal depth: the higher part ID draws the line, normals tie-break row-major; both backends equal the reference', async () => {
    const lineSet = async (
      cell: MrtCell,
      sources: (x: Mutable<RenderSettings>) => void,
    ) => {
      const s = settingsWith(x => {
        x.outline.inner.enabled = true;
        x.outline.outer.enabled = false;
        x.outline.inner.partId = false;
        x.outline.inner.depth = false;
        x.outline.inner.normal = false;
        sources(x);
      });
      const masks = await renderOnce(h, cell, s, 'masks');
      const ref = referenceEdgeDetect(cell, paramsOf(s));
      expect(maskPixels(masks, cell.width, 1)).toEqual(
        refPixels(ref.inner, cell.width),
      );
      return maskPixels(masks, cell.width, 1);
    };
    const ids = (left: number, right: number) =>
      new CellBuilder(8, 8)
        .rect(3, 3, 3, 3, {color: RED, id: left, depth: 1})
        .rect(4, 3, 4, 3, {color: RED, id: right, depth: 1})
        .build();
    const byId = (x: Mutable<RenderSettings>) => {
      x.outline.inner.partId = true;
    };
    expect(await lineSet(ids(3, 5), byId)).toEqual(['4,3']);
    expect(await lineSet(ids(5, 3), byId)).toEqual(['3,3']);
    const creased = new CellBuilder(8, 8)
      .rect(3, 3, 3, 3, {color: RED, normal: [0, 0, 1], depth: 1})
      .rect(3, 4, 3, 4, {color: RED, normal: [1, 0, 0], depth: 1})
      .build();
    expect(
      await lineSet(creased, x => {
        x.outline.inner.normal = true;
        x.outline.inner.normalThresholdDeg = 60;
      }),
    ).toEqual(['3,4']);
  });

  it('AC-PIX-017.5: default outer black + inner darken 0.4; inner black; outer darken + inner black; inner custom #203040', async () => {
    const cell = new CellBuilder(16, 16)
      .rect(2, 2, 13, 13, {color: RED, id: 2, depth: 0})
      .rect(7, 0, 8, 15, {color: BLUE, id: 5, depth: 3})
      .build();
    const make = (edit: (x: Mutable<RenderSettings>) => void) => {
      const x = structuredClone(
        defaultRenderSettings(),
      ) as Mutable<RenderSettings>;
      x.palette.id = 'none';
      x.outline.inner.enabled = true;
      x.outline.inner.partId = true;
      x.outline.inner.depth = false;
      x.outline.inner.normal = false;
      edit(x);
      return x as RenderSettings;
    };
    const defaults = make(() => {});
    expect(defaults.outline.colorMode).toBe('black');
    expect(defaults.outline.inner.colorMode).toBe('darken');
    expect(defaults.outline.darkenAmount).toBe(0.6);
    const ref = referenceEdgeDetect(cell, paramsOf(defaults));
    const inner: number[] = [];
    const outer: number[] = [];
    for (let i = 0; i < 256; i++) {
      if (ref.inner[i] === 1) inner.push(i);
      if (ref.outer[i] === 1) outer.push(i);
    }
    expect(inner.length).toBe(24);
    expect(outer.length).toBeGreaterThan(20);
    const near = (got: Uint8ClampedArray, i: number, want: number[]) => {
      for (let c = 0; c < 3; c++)
        expect(
          Math.abs((got[i * 4 + c] as number) - Math.round(want[c]! * 255)),
        ).toBeLessThanOrEqual(1);
      expect(got[i * 4 + 3]).toBe(255);
    };
    const own = (i: number) =>
      [0, 1, 2].map(c => (cell.color[i * 4 + c] as number) * 0.4);
    const src = (i: number) =>
      [0, 1, 2].map(c => (ref.source[i * 4 + c] as number) * 0.4);
    const black = [0, 0, 0];

    const a = await renderOnce(h, cell, defaults, 'chain');
    for (const i of outer) near(a, i, black);
    for (const i of inner) near(a, i, own(i));

    const b = await renderOnce(
      h,
      cell,
      make(x => {
        x.outline.inner.colorMode = 'black';
      }),
      'chain',
    );
    for (const i of outer) near(b, i, black);
    for (const i of inner) near(b, i, black);

    const c = await renderOnce(
      h,
      cell,
      make(x => {
        x.outline.colorMode = 'darken';
        x.outline.inner.colorMode = 'black';
      }),
      'chain',
    );
    for (const i of outer) near(c, i, src(i));
    for (const i of inner) near(c, i, black);

    const d = await renderOnce(
      h,
      cell,
      make(x => {
        x.outline.inner.colorMode = 'custom';
        x.outline.color = '#203040';
      }),
      'chain',
    );
    for (const i of outer) near(d, i, black);
    for (const i of inner) near(d, i, linearHex('#203040'));
  });

  it('AC-PIX-017.1, AC-PIX-017.4: mode black = render.paletteDarkest (#000000 none/pico-8, #181425 endesga-32, #102030 custom)', async () => {
    const cell = new CellBuilder(8, 8).rect(2, 2, 5, 5, {color: RED}).build();
    for (const [id, hex] of [
      ['none', '#000000'],
      ['pico-8', '#000000'],
      ['endesga-32', '#181425'],
      ['custom', '#102030'],
    ] as const) {
      const s = settingsWith(x => {
        x.outline.colorMode = 'black';
        x.palette.id = id;
        if (id === 'custom') x.palette.colors = ['#ffffff', '#102030'];
      });
      const chain = await renderOnce(h, cell, s, 'chain');
      const lin = linearHex(hex);
      const expected = [...lin.map(v => Math.round(v * 255)), 255];
      expect(px(chain, 8, 1, 3)).toEqual(expected);
      expect(px(chain, 8, 3, 6)).toEqual(expected);
      expect(Array.from(chain)).toEqual(
        Array.from(toUnorm8(referenceOutlineChain(cell, paramsOf(s, lin)))),
      );
    }
  });

  it('AC-PIX-017.2: darken 0.5, palette none: neighbour × 0.5; ties pick up, left, right, down', async () => {
    // P (3, 3) is transparent with covered up (RED), left (BLUE), right (GREEN) and down (GREEN).
    const cell = new CellBuilder(8, 8)
      .pixel(3, 2, {color: RED})
      .pixel(2, 3, {color: BLUE})
      .pixel(4, 3, {color: GREEN})
      .pixel(3, 4, {color: GREEN})
      // Q (6, 6): only left (BLUE) and down-right diagonal (RED, ignored at width 1).
      .pixel(5, 6, {color: BLUE})
      .pixel(7, 7, {color: RED})
      .build();
    const s = settingsWith(x => {
      x.outline.colorMode = 'darken';
      x.outline.darkenAmount = 0.5;
    });
    const chain = await renderOnce(h, cell, s, 'chain');
    const half = (c: readonly number[]) => [
      ...c.slice(0, 3).map(v => Math.round(v * 0.5 * 255)),
      255,
    ];
    expect(px(chain, 8, 3, 3)).toEqual(half(RED));
    expect(px(chain, 8, 6, 6)).toEqual(half(BLUE));
    expect(Array.from(chain)).toEqual(
      Array.from(toUnorm8(referenceOutlineChain(cell, paramsOf(s)))),
    );
  });

  it('AC-PIX-017.3: width 2: distance 1 beats distance 2, row-major within the ring', async () => {
    const A = [0.75, 0.25, 0.25, 1] as const;
    const B = [0.25, 0.75, 0.25, 1] as const;
    const C = [0.25, 0.25, 0.75, 1] as const;
    const cell = new CellBuilder(11, 11)
      .pixel(4, 4, {color: A})
      .pixel(6, 4, {color: B})
      .pixel(5, 3, {color: C})
      .build();
    const s = settingsWith(x => {
      x.outline.colorMode = 'darken';
      x.outline.darkenAmount = 0.5;
      x.outline.outer.widthPx = 2;
    });
    const chain = await renderOnce(h, cell, s, 'chain');
    expect(px(chain, 11, 5, 5)).toEqual([
      Math.round(0.375 * 255),
      Math.round(0.125 * 255),
      Math.round(0.125 * 255),
      255,
    ]);
    expect(Array.from(chain)).toEqual(
      Array.from(toUnorm8(referenceOutlineChain(cell, paramsOf(s)))),
    );
  });

  it('REQ-PIX-017 custom mode (AC-PIX-017.2 counterpart): outline pixels take the custom colour', async () => {
    const cell = new CellBuilder(8, 8).rect(2, 2, 5, 5, {color: RED}).build();
    const s = settingsWith(x => {
      x.outline.colorMode = 'custom';
      x.outline.color = '#336699';
    });
    const chain = await renderOnce(h, cell, s, 'chain');
    expect(px(chain, 8, 1, 3)).toEqual([
      ...linearHex('#336699').map(v => Math.round(v * 255)),
      255,
    ]);
    expect(px(chain, 8, 3, 3)).toEqual([
      ...RED.slice(0, 3).map(v => Math.round(v * 255)),
      255,
    ]);
    expect(px(chain, 8, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});
