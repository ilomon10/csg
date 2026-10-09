/**
 * GPU tests of the screen-space rim edge (spec 003 REQ-PIX-012 as amended by
 * FX-J; spec 006 `post.rimEdge@1`) through the full pixel pipeline, on both
 * backends. Pixel asserts only (no committed goldens, PM decision D2).
 *
 * Combine under test: the PM FX-J decision `clamp(base · (light_k +
 * strength), 0, 1)` per linear channel (spec-writer to codify; the spec text
 * of 2026-10-09 still reads `base · min(light_k + strength, 1)`).
 */
import {defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {vec4} from 'three/tsl';
import {computeFraming} from '../../src/pipeline/framing';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import type {PixelPipeline} from '../../src/pipeline/render-pipeline';
import {
  SettingsBinder,
  lightDirection,
} from '../../src/pipeline/settings-binder';
import {createStageContext} from '../../src/pipeline/stage-context';
import {rimCombine, rimOffset} from '../../src/pipeline/stages/rim';
import {toonBandLight} from '../../src/pipeline/stages/toon';
import {
  PART_ID_USER_DATA,
  createToonMaterial,
} from '../../src/pipeline/toon-material';
import {createGpuHarness, currentBackend} from './harness';
import type {GpuHarness} from './harness';

type Mutable<T> = {-readonly [K in keyof T]: Mutable<T[K]>};

const W = 64;
const BASE: readonly [number, number, number] = [0.5, 0.25, 0.1];
const STRENGTH = 0.3;
const THRESHOLDS = [1 / 4, 1 / 2, 3 / 4];

/** Settings of AC-PIX-012.4: side, 64², s = 0.125, pivot 3, 4 bands, rim 0.3, no outline, no palette. */
function cubeSettings(
  edit: (s: Mutable<RenderSettings>) => void = () => {},
): RenderSettings {
  const s = structuredClone(
    defaultRenderSettings('side'),
  ) as Mutable<RenderSettings>;
  s.resolution = {width: W, height: W};
  s.camera.framing = 0.125;
  s.camera.pivotRowPx = 3;
  s.lighting = {azimuthDeg: 135, elevationDeg: 45, ambient: 0.15};
  s.toon = {
    bands: 4,
    thresholds: [...THRESHOLDS],
    rim: {enabled: true, strength: STRENGTH},
  };
  s.outline.outer.enabled = false;
  s.outline.inner.enabled = false;
  s.palette = {...s.palette, id: 'none'};
  edit(s);
  return s as RenderSettings;
}

/** One toon-lit mesh with base colour {@link BASE} on its own scene. */
function toonScene(
  binder: SettingsBinder,
  backend: 'webgpu' | 'webgl2',
  geometry: THREE.BufferGeometry,
) {
  const ctx = createStageContext({
    binder,
    target: 'material',
    mode: 'export',
    backend,
  });
  const material = createToonMaterial({
    ctx,
    base: vec4(BASE[0], BASE[1], BASE[2], 1),
    lighting: 'toon',
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData[PART_ID_USER_DATA] = 1;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return {
    scene,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

async function pipelineFor(
  h: GpuHarness,
  scene: THREE.Scene,
  binder: SettingsBinder,
  settings: RenderSettings,
): Promise<PixelPipeline> {
  const created = createPixelPipeline({renderer: h.renderer, scene, binder});
  if (!created.ok) throw new Error(created.error.message);
  const p = created.value;
  await p.setRenderSettings(settings);
  p.setFraming(computeFraming([], settings));
  return p;
}

async function renderWith(
  p: PixelPipeline,
  settings: RenderSettings,
): Promise<Uint8ClampedArray> {
  await p.setRenderSettings(settings);
  p.render();
  return p.read();
}

/** Indices (y · W + x) whose RGBA differs. */
function diff(a: Uint8ClampedArray, b: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < W * W; i++) {
    for (let c = 0; c < 4; c++) {
      if (a[i * 4 + c] !== b[i * 4 + c]) {
        out.push(i);
        break;
      }
    }
  }
  return out;
}

const decode = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** The cube face's rim pixels for offset `(dx, dy)` given the face box. */
function faceRim(
  box: {minX: number; maxX: number; minY: number; maxY: number},
  o: readonly [number, number],
): number[] {
  const out: number[] = [];
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      const nx = x + o[0];
      const ny = y + o[1];
      const inside =
        nx >= box.minX && nx <= box.maxX && ny >= box.minY && ny <= box.maxY;
      if (!inside) out.push(y * W + x);
    }
  }
  return out.sort((a, b) => a - b);
}

function coverageBox(rgba: Uint8ClampedArray) {
  let minX = W;
  let maxX = -1;
  let minY = W;
  let maxY = -1;
  for (let i = 0; i < W * W; i++) {
    if (rgba[i * 4 + 3] !== 255) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {minX, maxX, minY, maxY};
}

describe(`screen-space rim edge (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(W, W);
  });
  afterAll(() => h?.dispose());

  /** Renders the AC-PIX-012.4 cube under each settings value in turn. */
  async function cube(
    settings: readonly RenderSettings[],
    onPipeline?: (p: PixelPipeline) => Promise<void>,
  ): Promise<Uint8ClampedArray[]> {
    const binder = new SettingsBinder();
    const t = toonScene(
      binder,
      h.backend,
      new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0),
    );
    const first = settings[0];
    if (first === undefined) throw new Error('no settings');
    const p = await pipelineFor(h, t.scene, binder, first);
    try {
      const out: Uint8ClampedArray[] = [];
      for (const s of settings) out.push(await renderWith(p, s));
      if (onPipeline !== undefined) await onPipeline(p);
      return out;
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  }

  it('AC-PIX-012.4, AC-PIX-012.6: cube face rim is exactly the top row + left column (31 px) with clamp(base · (light_k + 0.3))', async () => {
    const [on, off] = await cube([
      cubeSettings(),
      cubeSettings(s => {
        s.toon.rim.enabled = false;
      }),
    ]);
    if (on === undefined || off === undefined) throw new Error('render');
    const box = coverageBox(off);
    expect([box.maxX - box.minX + 1, box.maxY - box.minY + 1]).toEqual([
      16, 16,
    ]);
    const rim = diff(on, off);
    expect(rim).toHaveLength(31);
    expect(rim).toEqual(faceRim(box, [-1, -1]));
    // Face N = (0, 0, 1): λ = 0.707 → band 2 of 0..3.
    const light = toonBandLight(2, 4, 0.15);
    for (const i of rim) {
      for (let c = 0; c < 3; c++) {
        const expected = rimCombine(BASE[c]! * light, light, STRENGTH);
        expect(Math.abs(decode(on[i * 4 + c]!) - expected)).toBeLessThan(
          1 / 255 + 1e-6,
        );
      }
      expect(on[i * 4 + 3]).toBe(255);
    }
  });

  it('AC-PIX-012.10: with the black outer outline the 31 rim pixels are unchanged and every outer outline pixel is #000000', async () => {
    const [plain, outlined, outlinedOff] = await cube([
      cubeSettings(),
      cubeSettings(s => {
        s.outline.outer = {enabled: true, widthPx: 1};
        s.outline.colorMode = 'black';
      }),
      cubeSettings(s => {
        s.outline.outer = {enabled: true, widthPx: 1};
        s.outline.colorMode = 'black';
        s.toon.rim.enabled = false;
      }),
    ]);
    if (!plain || !outlined || !outlinedOff) throw new Error('render');
    const rim = diff(outlined, outlinedOff);
    expect(rim).toHaveLength(31);
    for (const i of rim) {
      expect(Array.from(outlined.subarray(i * 4, i * 4 + 4))).toEqual(
        Array.from(plain.subarray(i * 4, i * 4 + 4)),
      );
    }
    let outlinePixels = 0;
    for (let i = 0; i < W * W; i++) {
      if (plain[i * 4 + 3] === 0 && outlined[i * 4 + 3] === 255) {
        outlinePixels++;
        expect(Array.from(outlined.subarray(i * 4, i * 4 + 3))).toEqual([
          0, 0, 0,
        ]);
        expect(rim).not.toContain(i);
      }
    }
    expect(outlinePixels).toBe(4 * 16);
  });

  it('AC-PIX-012.3 (GPU): light from the viewer (elevation 90°) → rim-on equals rim-off byte for byte', async () => {
    const [on, off] = await cube([
      cubeSettings(s => {
        s.lighting.elevationDeg = 90;
      }),
      cubeSettings(s => {
        s.lighting.elevationDeg = 90;
        s.toon.rim.enabled = false;
      }),
    ]);
    expect(
      rimOffset(
        lightDirection({azimuthDeg: 135, elevationDeg: 90, ambient: 0}),
      ),
    ).toBeNull();
    expect(on).toEqual(off);
  });

  it('AC-PIX-012.9: toggling rim.enabled, 100 strength changes and azimuth 135° → 45° never rebuild; the rim moves to the new side', async () => {
    const off = cubeSettings(s => {
      s.toon.rim.enabled = false;
    });
    const settings: RenderSettings[] = [off];
    for (let i = 0; i < 10; i++) {
      settings.push(
        cubeSettings(s => {
          s.toon.rim.enabled = i % 2 === 0;
        }),
      );
    }
    for (let i = 0; i < 100; i++) {
      settings.push(
        cubeSettings(s => {
          s.toon.rim.strength = (i % 10) / 10;
        }),
      );
    }
    const rotated = cubeSettings(s => {
      s.lighting.azimuthDeg = 45;
    });
    const rotatedOff = cubeSettings(s => {
      s.lighting.azimuthDeg = 45;
      s.toon.rim.enabled = false;
    });
    settings.push(rotatedOff, rotated);
    let rebuilds = -1;
    let frames: Uint8ClampedArray[] = [];
    frames = await cube(settings, async p => {
      rebuilds = p.stats.rebuilds;
    });
    expect(rebuilds).toBe(1);
    const a = frames[frames.length - 2];
    const b = frames[frames.length - 1];
    if (a === undefined || b === undefined) throw new Error('render');
    expect(rimOffset(lightDirection(rotated.lighting))).toEqual([1, -1]);
    expect(diff(b, a)).toEqual(faceRim(coverageBox(a), [1, -1]));
  });

  it('AC-PIX-012.5, AC-PIX-012.6: sphere rim = covered pixels with p + (-1, -1) uncovered, 1 px thick, on the lit half, colour clamp(base · (light_k + 0.3))', async () => {
    const binder = new SettingsBinder();
    const t = toonScene(
      binder,
      h.backend,
      new THREE.SphereGeometry(1, 96, 48).translate(0, 1.2, 0),
    );
    const settings = cubeSettings(s => {
      s.camera.framing = 0.05;
    });
    const p = await pipelineFor(h, t.scene, binder, settings);
    try {
      const on = await renderWith(p, settings);
      const off = await renderWith(
        p,
        cubeSettings(s => {
          s.camera.framing = 0.05;
          s.toon.rim.enabled = false;
        }),
      );
      const covered = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < W && y < W && off[(y * W + x) * 4 + 3] === 255;
      const expected: number[] = [];
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          if (!covered(x, y)) continue;
          sx += x + 0.5;
          sy += y + 0.5;
          n++;
          if (!covered(x - 1, y - 1)) expected.push(y * W + x);
        }
      }
      const rim = diff(on, off);
      // (a) the rim set (every rim pixel changes: max channel 0.5 · 1.3 < 1).
      expect(rim).toEqual(expected);
      // (b) 1 px thick along the offset.
      const set = new Set(rim);
      for (const i of rim) expect(set.has(i + W + 1)).toBe(false);
      // (c) lit half and (d) not empty.
      expect(rim.length).toBeGreaterThan(10);
      const [cx, cy] = [sx / n, sy / n];
      for (const i of rim) {
        const px = (i % W) + 0.5 - cx;
        const py = Math.floor(i / W) + 0.5 - cy;
        expect((-px - py) / Math.SQRT2).toBeGreaterThan(-1);
      }
      // Colour: each rim pixel is the rim-off colour scaled by (light_k + 0.3) / light_k.
      const bands = [0, 1, 2, 3].map(k => toonBandLight(k, 4, 0.15));
      for (const i of rim) {
        const r = decode(off[i * 4]!);
        // Recover light_k from the rim-off red channel (base.r = 0.5).
        const light = bands.reduce((best, l) =>
          Math.abs(BASE[0] * l - r) < Math.abs(BASE[0] * best - r) ? l : best,
        );
        for (let c = 0; c < 3; c++) {
          const want = rimCombine(BASE[c]! * light, light, STRENGTH);
          expect(Math.abs(decode(on[i * 4 + c]!) - want)).toBeLessThan(
            1 / 255 + 1e-6,
          );
        }
      }
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });
});
