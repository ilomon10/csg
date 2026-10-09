/**
 * GPU smoke tests for both backends (M2-08). Run with `pnpm test:gpu`.
 * AC-PIX-029.1 (GPU half), AC-PIX-021.5 (browser half), AC-PIX-021.2 (timing report),
 * AC-PIX-028.1/.3/.4/.5 (harness round trip).
 */
import {PALETTE_PRESETS} from '@csg/parts-schema';
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {
  buildPaletteLut,
  createPaletteLutWorker,
} from '../../src/pipeline/palette-lut';
import {
  compareGolden,
  createGpuHarness,
  currentBackend,
  nodeEnv,
  readbackLayout,
  renderToRgba,
  toBase64,
} from './harness';
import type {GpuHarness} from './harness';

/** Orthographic scene in pixel units: background colour plus unlit corner markers. */
function markerScene(w: number, h: number) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0000ff);
  const cam = new THREE.OrthographicCamera(
    -w / 2,
    w / 2,
    h / 2,
    -h / 2,
    0.1,
    100,
  );
  cam.position.set(0, 0, 50);
  const quad = new THREE.PlaneGeometry(6, 6);
  const red = new THREE.Mesh(
    quad,
    new THREE.MeshBasicNodeMaterial({color: 0xff0000}),
  );
  red.position.set(-w / 2 + 3, h / 2 - 3, 10);
  const green = new THREE.Mesh(
    quad,
    new THREE.MeshBasicNodeMaterial({color: 0x00ff00}),
  );
  green.position.set(w / 2 - 3, -h / 2 + 3, 10);
  scene.add(red, green);
  return {scene, cam};
}

const px = (a: ArrayLike<number>, w: number, x: number, y: number) =>
  Array.from({length: 4}, (_, i) => a[(y * w + x) * 4 + i]);

describe(`GPU harness (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(48, 40);
    await commands.csgWriteReport(`adapter-${h.backend}.json`, h.environment);
  });
  afterAll(() => h.dispose());

  it('asserts the requested backend and records adapter info', () => {
    expect(h.backend).toBe(currentBackend());
    expect(Object.keys(h.environment.adapter).length).toBeGreaterThan(0);
    expect(h.environment.three).toBe('186');
  });

  for (const [w, hh] of [
    [48, 40],
    [33, 13],
  ] as const) {
    it(`AC-PIX-029.1: ${w}x${hh} clear colour + corner markers read back tight, top-left origin`, async () => {
      const r = await (
        w === 48 ? Promise.resolve(h) : createGpuHarness(w, hh)
      ).then(async hx => {
        try {
          const {scene, cam} = markerScene(w, hh);
          return await renderToRgba(hx, scene, cam, w, hh);
        } finally {
          if (hx !== h) hx.dispose();
        }
      });
      expect(r.rgba.length).toBe(w * hh * 4);
      // Raw layout evidence: WebGPU pads rows to 256 bytes, WebGL2 is tight.
      const layout = readbackLayout(h.backend, w);
      expect(r.rawLength).toBe((hh - 1) * layout.rowStrideBytes + w * 4);
      expect(px(r.rgba, w, 0, 0)).toEqual([255, 0, 0, 255]); // index 0
      expect(Array.from(r.rgba.subarray(0, 4))).toEqual([255, 0, 0, 255]);
      expect(px(r.rgba, w, 5, 5)).toEqual([255, 0, 0, 255]);
      expect(px(r.rgba, w, 6, 0)).toEqual([0, 0, 255, 255]); // clear colour
      expect(px(r.rgba, w, 0, 6)).toEqual([0, 0, 255, 255]);
      expect(px(r.rgba, w, w - 1, hh - 1)).toEqual([0, 255, 0, 255]);
      expect(px(r.rgba, w, w - 6, hh - 6)).toEqual([0, 255, 0, 255]);
    });
  }

  it('is deterministic: 3 renders in one session are byte-equal', async () => {
    const {scene, cam} = markerScene(48, 40);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      runs.push((await renderToRgba(h, scene, cam, 48, 40)).rgba);
    }
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('AC-PIX-028.1, AC-PIX-028.3, AC-PIX-028.5: golden round trip, mismatch artifacts, tolerance override', async () => {
    const env = await nodeEnv();
    // The mismatch assertions below do not apply when the run is a golden update.
    if (env.update) return;
    const dir = `test-results/gpu-selftest/${h.backend}`;
    const {scene, cam} = markerScene(48, 40);
    const {rgba} = await renderToRgba(h, scene, cam, 48, 40);
    await commands.csgSeedGolden(
      dir,
      h.backend,
      'roundtrip',
      toBase64(new Uint8Array(rgba.buffer)),
      48,
      40,
    );
    const ok = await compareGolden(h, 'roundtrip', rgba, 48, 40, {
      goldenDir: dir,
    });
    expect(ok.status).toBe('match');
    expect(ok.diffPixels).toBe(0);

    const bent = new Uint8ClampedArray(rgba);
    bent[400] = 0xff - (bent[400] ?? 0);
    bent[404] = 0xff - (bent[404] ?? 0);
    if (env.canonical) {
      await expect(
        compareGolden(h, 'roundtrip', bent, 48, 40, {goldenDir: dir}),
      ).rejects.toThrow(/2 pixel\(s\) differ/);
    } else {
      const r = await compareGolden(h, 'roundtrip', bent, 48, 40, {
        goldenDir: dir,
      });
      expect(r.status).toBe('reported'); // AC-PIX-028.3: reported, not failing
      expect(r.diffPixels).toBe(2);
    }
    for (const f of ['actual.png', 'expected.png', 'diff.png']) {
      expect(
        await commands.csgArtifactExists(`${h.backend}/roundtrip/${f}`),
      ).toBe(true);
    }
    const within = await compareGolden(h, 'roundtrip', bent, 48, 40, {
      goldenDir: dir,
      override: {maxDiffPixels: 2, reason: 'harness self-test of overrides'},
    });
    expect(within.status).toBe('match');
    await expect(
      compareGolden(h, 'roundtrip', bent, 48, 40, {
        goldenDir: dir,
        override: {maxDiffPixels: 2, reason: ' '},
      }),
    ).rejects.toThrow(/reason/);
  });
});

/** SHA-256 of `buildPaletteLut(pico-8, 'oklab')` built in Node (see palette-lut.test.ts). */
const PICO8_OKLAB_LUT_SHA256 =
  '39abb4c60760d05ad3ce45de9df1eac4bbe3d26576f099a9bb7f042f237b0a5d';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(d)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

describe(`palette LUT module worker (${currentBackend()})`, () => {
  it('AC-PIX-021.5: the browser worker LUT equals the Node digest; AC-PIX-021.2: build time report', async () => {
    const worker = createPaletteLutWorker({
      // The host builds the worker (REQ-GEN-014); the test uses the same-origin module worker.
      createWorker: () =>
        new Worker(
          new URL('../../src/pipeline/palette-lut.worker.ts', import.meta.url),
          {type: 'module'},
        ),
    });
    try {
      const pico = [...PALETTE_PRESETS['pico-8'].colors];
      const lut = await worker.build(pico, 'oklab');
      expect(await sha256Hex(lut)).toBe(PICO8_OKLAB_LUT_SHA256);
      expect(
        Array.from(
          lut.subarray(
            ((2 * 64 + 0) * 512 + (3 * 64 + 63)) * 4,
            ((2 * 64 + 0) * 512 + (3 * 64 + 63)) * 4 + 4,
          ),
        ),
      ).toEqual([255, 0, 77, 8]);

      const endesga = [...PALETTE_PRESETS['endesga-32'].colors];
      const lutE = await worker.build(endesga, 'oklab');
      expect(await sha256Hex(lutE)).toBe(
        await sha256Hex(buildPaletteLut(endesga, 'oklab')),
      );

      // 256-colour palette, deterministic colours (no Math.random).
      const big = Array.from({length: 256}, (_, i) => {
        const v = (Math.imul(i + 1, 2654435761) >>> 8) & 0xffffff;
        return `#${v.toString(16).padStart(6, '0')}`;
      });
      const t0 = performance.now();
      const built = await worker.build(big, 'oklab');
      const workerMs = performance.now() - t0;
      expect(built.length).toBe(512 * 512 * 4);
      const t1 = performance.now();
      const main = buildPaletteLut(big, 'oklab');
      const mainMs = performance.now() - t1;
      expect(await sha256Hex(built)).toBe(await sha256Hex(main));
      const env = await nodeEnv();
      await commands.csgWriteReport(
        `palette-lut-worker-${currentBackend()}.json`,
        {
          ac: 'AC-PIX-021.2',
          colors: 256,
          workerBuildMs: +workerMs.toFixed(1),
          mainThreadBuildMs: +mainMs.toFixed(1),
          budgetMs: 250,
          gated: env.perfGate,
          userAgent: navigator.userAgent,
        },
      );
      console.log(
        `[perf] 256-colour LUT: worker ${workerMs.toFixed(1)} ms, main ${mainMs.toFixed(1)} ms`,
      );
      if (env.perfGate) expect(workerMs).toBeLessThanOrEqual(250);
    } finally {
      worker.dispose();
    }
  });
});
