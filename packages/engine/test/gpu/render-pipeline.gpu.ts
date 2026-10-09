/**
 * GPU tests of the full pixel pipeline (M2-14) on both backends: scene MRT pass
 * → default post chain → RGBA8 cell target → normalized readback. Pixel
 * asserts only (no committed goldens, PM decision D2).
 *
 * AC-PIX-002.1, 003.1, 003.2 (GPU cross-check), 003.3, 008.4, 014.2, 029.1,
 * 034.1 (GPU: no node rebuild on uniform changes), 034.2.
 */
import {defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {vec4} from 'three/tsl';
import {cameraElevationOf} from '../../src/pipeline/camera';
import {computeFraming} from '../../src/pipeline/framing';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import type {PixelPipeline} from '../../src/pipeline/render-pipeline';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createStageContext} from '../../src/pipeline/stage-context';
import {
  PART_ID_USER_DATA,
  SCENE_MRT_KEYS,
  createToonMaterial,
} from '../../src/pipeline/toon-material';
import {commands} from 'vitest/browser';
import {createGpuHarness, currentBackend, nodeEnv} from './harness';
import type {GpuHarness} from './harness';

type Mutable<T> = {-readonly [K in keyof T]: Mutable<T[K]>};

function settingsWith(
  preset: RenderSettings['camera']['preset'],
  edit: (s: Mutable<RenderSettings>) => void = () => {},
): RenderSettings {
  const s = structuredClone(
    defaultRenderSettings(preset),
  ) as Mutable<RenderSettings>;
  edit(s);
  return s as RenderSettings;
}

/** A scene of unlit toon meshes (exact base colors), all on one binder. */
class TestScene {
  readonly scene = new THREE.Scene();
  private readonly owned: Array<{dispose(): void}> = [];
  constructor(
    readonly binder: SettingsBinder,
    readonly backend: 'webgpu' | 'webgl2',
  ) {}

  add(
    geometry: THREE.BufferGeometry,
    rgb: readonly [number, number, number],
    partId = 1,
    lighting: 'toon' | 'unlit' = 'unlit',
  ): THREE.Mesh {
    const ctx = createStageContext({
      binder: this.binder,
      target: 'material',
      mode: 'export',
      backend: this.backend,
    });
    const material = createToonMaterial({
      ctx,
      base: vec4(rgb[0], rgb[1], rgb[2], 1),
      lighting,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData[PART_ID_USER_DATA] = partId;
    this.scene.add(mesh);
    this.owned.push(geometry, material);
    return mesh;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
  }
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

const alphaAt = (rgba: Uint8ClampedArray, w: number, x: number, y: number) =>
  rgba[(y * w + x) * 4 + 3];

/** Covered (alpha 255) pixels as a sorted "x,y" list. */
function covered(rgba: Uint8ClampedArray, w: number): string[] {
  const out: string[] = [];
  for (let i = 0; i * 4 < rgba.length; i++) {
    if (rgba[i * 4 + 3] === 255) out.push(`${i % w},${Math.floor(i / w)}`);
  }
  return out.sort();
}

function coverageBox(rgba: Uint8ClampedArray, w: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i * 4 < rgba.length; i++) {
    if (rgba[i * 4 + 3] !== 255) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {minX, maxX, minY, maxY};
}

const noOutline = (s: Mutable<RenderSettings>) => {
  s.outline.outer.enabled = false;
  s.outline.inner.enabled = false;
};

describe(`pixel pipeline (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(64, 64);
  });
  afterAll(() => h?.dispose());

  it('AC-PIX-002.1: every render target is 64×64, samples 0, nearest, no mipmaps; cell RGBA8 NoColorSpace, MRT HalfFloat named by key', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    t.add(new THREE.BoxGeometry(1, 1, 1), [0.5, 0.25, 0.75]);
    const p = await pipelineFor(h, t.scene, binder, settingsWith('side'));
    try {
      p.render();
      await p.read();
      const size = h.renderer.getDrawingBufferSize(new THREE.Vector2());
      expect([size.x, size.y]).toEqual([64, 64]);
      const targets = p.renderTargets();
      expect(targets).toHaveLength(2);
      for (const rt of targets) {
        expect([rt.width, rt.height]).toEqual([64, 64]);
        expect(rt.samples).toBe(0);
        for (const tex of rt.textures) {
          expect(tex.minFilter).toBe(THREE.NearestFilter);
          expect(tex.magFilter).toBe(THREE.NearestFilter);
          expect(tex.generateMipmaps).toBe(false);
        }
      }
      const [scene, cell] = targets as [THREE.RenderTarget, THREE.RenderTarget];
      expect(scene.textures.map(x => x.name)).toEqual([...SCENE_MRT_KEYS]);
      for (const tex of scene.textures) {
        expect(tex.type).toBe(THREE.HalfFloatType);
      }
      expect(cell.texture.type).toBe(THREE.UnsignedByteType);
      expect(cell.texture.format).toBe(THREE.RGBAFormat);
      expect(cell.texture.colorSpace).toBe(THREE.NoColorSpace);
      expect(cell.depthBuffer).toBe(false);
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-003.1, AC-PIX-008.4: side preset is orthographic and horizontal; a 1-unit box at s = 0.25 covers columns 30–33 and stands on row pivotRowPx', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    t.add(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), [1, 1, 1]);
    const s = settingsWith('side', x => {
      x.camera.framing = 0.25;
      // Explicit pivot (the default is resolution/outline-relative, AC-PIX-008.5).
      x.camera.pivotRowPx = 2;
      noOutline(x);
    });
    const p = await pipelineFor(h, t.scene, binder, s);
    try {
      expect(p.camera.isOrthographicCamera).toBe(true);
      expect(Math.abs(cameraElevationOf(p.camera))).toBeLessThan(0.001);
      p.render();
      const rgba = await p.read();
      const box = coverageBox(rgba, 64);
      expect([box.minX, box.maxX]).toEqual([30, 33]);
      // 4 px tall, lowest row = pivotRowPx (2) from the bottom = top-left row 61.
      expect([box.minY, box.maxY]).toEqual([58, 64 - 1 - s.camera.pivotRowPx]);
      expect(covered(rgba, 64)).toHaveLength(16);
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-003.3: three-quarter elevation is 35° ± 0.001° and the box projects as y·cos e − z·sin e', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    t.add(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), [1, 1, 1]);
    const s = settingsWith('three-quarter', x => {
      x.camera.framing = 0.25;
      x.camera.pivotRowPx = 4;
      noOutline(x);
    });
    const p = await pipelineFor(h, t.scene, binder, s);
    try {
      expect(Math.abs(cameraElevationOf(p.camera) - 35)).toBeLessThan(0.001);
      p.render();
      const box = coverageBox(await p.read(), 64);
      // Screen y ∈ [−0.5 sin 35°, cos 35° + 0.5 sin 35°] = [−1.147, 4.424] px
      // around the pivot corner y = 60 (pivotRowPx 4): centers 56.5..60.5.
      expect([box.minX, box.maxX]).toEqual([30, 33]);
      expect([box.minY, box.maxY]).toEqual([56, 60]);
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-003.2: isometric ground square rotated 45° renders the exact 2:1 diamond', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    const side = 2 * Math.SQRT2; // diagonal 4 world units = 32 px at s = 0.125
    t.add(
      new THREE.PlaneGeometry(side, side)
        .rotateX(-Math.PI / 2)
        .rotateY(Math.PI / 4),
      [1, 1, 1],
    );
    const s = settingsWith('isometric', x => {
      x.camera.framing = 0.125;
      x.camera.pivotRowPx = 30;
      noOutline(x);
    });
    const p = await pipelineFor(h, t.scene, binder, s);
    try {
      p.render();
      const rgba = await p.read();
      // Projected diamond: half-width 16 px, half-height 16·sin 30° = 8 px, centred
      // on the pivot corner (32, 34). No pixel centre lies on an edge.
      const expected: string[] = [];
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          if (Math.abs(x + 0.5 - 32) / 16 + Math.abs(y + 0.5 - 34) / 8 < 1) {
            expected.push(`${x},${y}`);
          }
        }
      }
      expect(covered(rgba, 64)).toEqual(expected.sort());
      const box = coverageBox(rgba, 64);
      // Covered centres: 30 × 16 of the 32 × 16 px diamond (the two side tips are
      // thinner than a pixel centre's reach).
      expect([box.maxX - box.minX + 1, box.maxY - box.minY + 1]).toEqual([
        30, 16,
      ]);
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-014.2: exactly one scene render per frame', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    const mesh = t.add(new THREE.BoxGeometry(1, 1, 1), [0.5, 0.5, 0.5]);
    const p = await pipelineFor(
      h,
      t.scene,
      binder,
      settingsWith('side', x => {
        x.camera.framing = 0.0625;
      }),
    );
    const r = h.renderer;
    const original = r.render.bind(r);
    let sceneRenders = 0;
    let otherRenders = 0;
    r.render = ((scene: THREE.Object3D, camera: THREE.Camera) => {
      if (scene === t.scene) sceneRenders++;
      else otherRenders++;
      return original(scene, camera);
    }) as typeof r.render;
    try {
      for (let i = 0; i < 3; i++) p.render();
      expect(sceneRenders).toBe(3);
      // One post quad per frame.
      expect(otherRenders).toBe(3);
      expect(p.stats.frames).toBe(3);
      // Back-to-back frames (no animation-loop tick between them) see the
      // scene change: the pass is not cached per tick.
      const before = covered(await p.read(), 64);
      mesh.position.x += 0.25;
      p.render();
      mesh.position.x -= 0.25;
      p.render();
      mesh.position.x += 0.5;
      p.render();
      const after = covered(await p.read(), 64);
      expect(sceneRenders).toBe(6);
      expect(after).not.toEqual(before);
      expect(after.length).toBe(before.length);
    } finally {
      r.render = original;
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-034.1 (GPU), AC-PIX-034.2: uniform-only changes build no node; bayer4 → bayer8 rebuilds and shows the new frame within 300 ms', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    t.add(
      new THREE.SphereGeometry(0.9, 32, 16).translate(0, 1, 0),
      [0.8, 0.6, 0.4],
      1,
      'toon',
    );
    const base = settingsWith('side', x => {
      x.camera.framing = 0.04;
      x.palette.id = 'pico-8';
      x.palette.dither = {mode: 'bayer4', strength: 1};
    });
    const p = await pipelineFor(h, t.scene, binder, base);
    const backend = h.renderer.backend as unknown as {
      createNodeBuilder: (...args: unknown[]) => unknown;
    };
    const originalBuilder = backend.createNodeBuilder;
    let builds = 0;
    backend.createNodeBuilder = function (this: unknown, ...args: unknown[]) {
      builds++;
      return originalBuilder.apply(this, args);
    };
    try {
      p.render();
      const bayer4 = await p.read();
      builds = 0;
      const rebuilds = p.stats.rebuilds;
      for (let i = 1; i <= 20; i++) {
        const s = settingsWith('side', x => {
          x.camera.framing = 0.04;
          x.palette.id = 'pico-8';
          x.palette.dither = {mode: 'bayer4', strength: 1 - i / 40};
          x.toon.rim.strength = i / 20;
          x.outline.darkenAmount = i / 40;
          x.alphaCutoff = 0.4 + i / 100;
        });
        const diff = await p.setRenderSettings(s);
        expect(diff.post || diff.material || diff.resize).toBe(false);
        p.render();
      }
      const u0 = performance.now();
      await p.setRenderSettings(base);
      p.render();
      await p.read();
      const uniformMs = performance.now() - u0;
      expect(builds).toBe(0);
      expect(p.stats.rebuilds).toBe(rebuilds);

      const t0 = performance.now();
      const diff = await p.setRenderSettings({
        ...base,
        palette: {...base.palette, dither: {mode: 'bayer8', strength: 1}},
      });
      const tApplied = performance.now();
      p.render();
      const tRendered = performance.now();
      const bayer8 = await p.read();
      const elapsed = performance.now() - t0;
      expect(diff.post).toBe(true);
      expect(p.stats.rebuilds).toBe(rebuilds + 1);
      expect(builds).toBeGreaterThan(0);
      expect(Array.from(bayer8)).not.toEqual(Array.from(bayer4));
      const report = {
        backend: h.backend,
        uniformChangeFrameMs: uniformMs,
        bayer4ToBayer8FrameMs: elapsed,
        applyMs: tApplied - t0,
        renderMs: tRendered - tApplied,
        readMs: elapsed - (tRendered - t0),
        budgetMs: 300,
      };
      console.log(`[m2-14] ${JSON.stringify(report)}`);
      await commands.csgWriteReport(`m2-14-rebuild-${h.backend}.json`, report);
      // The REQ-PIX-034 budget is gated on the reference machine
      // (CSG_PERF_GATE=1, m2-plan 3 "Perf"); elsewhere it is reported only.
      if ((await nodeEnv()).perfGate) expect(elapsed).toBeLessThanOrEqual(300);
    } finally {
      backend.createNodeBuilder = originalBuilder;
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });
});

describe(`pixel pipeline readback (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(48, 40);
  });
  afterAll(() => h?.dispose());

  it('AC-PIX-029.1: a 48×40 frame reads back tight (7680 B) with the top-left marker at index 0', async () => {
    const binder = new SettingsBinder();
    const t = new TestScene(binder, h.backend);
    const s = settingsWith('side', x => {
      x.resolution = {width: 48, height: 40};
      x.camera.framing = 0.1;
      x.camera.pivotRowPx = 2;
      noOutline(x);
    });
    const px = s.camera.framing as number;
    // Pivot corner at continuous (24, 38): cell px (0..2, 0..1) ↔ world
    // x ∈ [−24, −21]·s, y ∈ [36, 38]·s.
    t.add(
      new THREE.PlaneGeometry(3 * px, 2 * px).translate(-22.5 * px, 37 * px, 0),
      [1, 0, 0],
    );
    const p = await pipelineFor(h, t.scene, binder, s);
    try {
      p.render();
      const rgba = await p.read();
      expect(rgba.length).toBe(48 * 40 * 4);
      expect(Array.from(rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
      expect(covered(rgba, 48)).toEqual(
        ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1'].sort(),
      );
      expect(alphaAt(rgba, 48, 47, 0)).toBe(0);
      expect(alphaAt(rgba, 48, 0, 39)).toBe(0);
      expect(alphaAt(rgba, 48, 47, 39)).toBe(0);
    } finally {
      p.dispose();
      t.dispose();
      binder.dispose();
    }
  });
});
