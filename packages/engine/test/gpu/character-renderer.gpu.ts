/**
 * The character renderer on the real pixel pipeline (M2-17), both backends:
 * `createCharacterRenderer` on its own canvas with the M1 fixture character
 * (body, shirt, sword) and the fixture clip.
 *
 * - AC-PIX-030.1: preview paused on frame 3, direction `ne` = the exported
 *   frame byte for byte (cell target), and the canvas shows the cell texel
 *   for texel (drawing buffer = cell, no filtering, no color transform).
 * - AC-PIX-010.1: a static pose drawn twice (also after turning away and
 *   back) reads back byte-identically.
 * - AC-PIX-001.1: resolution 48×64 → the drawing buffer and the next
 *   RenderedFrame are 48×64.
 * - AC-PIX-034.1: 100 rim-strength changes through the renderer → zero post
 *   rebuilds, zero material recompiles; the change shows on the next frame.
 */
import {
  V1_SLOT_IDS,
  characterSpecSchema,
  clipManifestSchema,
  defaultRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {computeSampleTimes} from '../../src/animation/sample-times';
import type {AssemblyRegistry} from '../../src/composition/character-assembly';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {cellReadbackLayout} from '../../src/pipeline/render-pipeline';
import {normalizeReadback} from '../../src/pipeline/readback';
import {mirrorFrame} from '../../src/sampler/frame-sampler';
import {createCanvasPresenter} from '../../src/renderer/canvas-presenter';
import {createCharacterRenderer} from '../../src/renderer/character-renderer';
import type {EngineCharacterRenderer} from '../../src/renderer/character-renderer';
import {currentBackend} from './harness';

const FIXTURES = `${location.origin}/test/fixtures/`;
const PACK = `${FIXTURES}pack/`;
const SPEC_URL = `${FIXTURES}character.valid.json`;
const CLIP = 'builtin:fixture-pack/fixture-clip';
const NE = 1;
const SLOT_REGISTRY = {
  format: 'sprite-slot-registry' as const,
  version: 1 as const,
  slots: V1_SLOT_IDS.map((id, order) => ({
    id,
    order,
    label: id,
    kinds: ['skinned' as const, 'static' as const],
    required: id === 'body',
    randomize: {emptyChance: 0},
  })),
};
const WALK = {
  clipId: CLIP,
  label: 'walk',
  frameCount: 4,
  fps: 8,
  loop: true,
} as const;

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function fixtureRegistry(): Promise<AssemblyRegistry> {
  const inner = createAssetRegistry();
  inner.registerPack(
    partManifestSchema.parse(await json(`${PACK}manifest.json`)),
    PACK,
  );
  inner.registerClips(
    clipManifestSchema.parse(await json(`${PACK}clips.json`)),
    PACK,
  );
  return inner as unknown as AssemblyRegistry;
}

function walkSettings(overrides: Partial<RenderSettings> = {}): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  return {
    ...s,
    directions: 8,
    palette: {
      ...s.palette,
      id: 'pico-8',
      dither: {mode: 'bayer4', strength: 0.5},
    },
    animations: [{...WALK}],
    ...overrides,
  };
}

let live: EngineCharacterRenderer | undefined;
let canvas: HTMLCanvasElement;
/**
 * WebGPU: the presenter draws into this target instead of the canvas, because
 * vitest browser mode loses the WebGPU instance ("Instance dropped") as soon as
 * anything is presented to a WebGPU canvas (also with plain three, both the
 * Vulkan host and the SwiftShader container). WebGL2 presents to the canvas.
 */
let presented: THREE.RenderTarget | null = null;

async function createRenderer(
  settings: RenderSettings,
): Promise<EngineCharacterRenderer> {
  canvas = document.createElement('canvas');
  canvas.width = 300;
  canvas.height = 200;
  const created = await createCharacterRenderer(canvas, {
    registry: await fixtureRegistry(),
    slots: SLOT_REGISTRY,
    forceWebGL: currentBackend() === 'webgl2',
    settings,
    ...(currentBackend() === 'webgpu'
      ? {
          presenterFactory: (r, p) => {
            presented = new THREE.RenderTarget(64, 64, {
              type: THREE.UnsignedByteType,
              format: THREE.RGBAFormat,
              colorSpace: THREE.NoColorSpace,
              minFilter: THREE.NearestFilter,
              magFilter: THREE.NearestFilter,
              generateMipmaps: false,
              depthBuffer: false,
              samples: 0,
            });
            return createCanvasPresenter(r, p.cellTarget, {output: presented});
          },
        }
      : {}),
  });
  if (!created.ok) throw new Error(created.error.message);
  live = created.value;
  expect(live.backend).toBe(currentBackend());
  const set = await live.setCharacter(
    characterSpecSchema.parse(await json(SPEC_URL)),
  );
  if (!set.ok) throw new Error(set.error.message);
  return live;
}

afterEach(() => {
  live?.dispose();
  live = undefined;
  presented?.dispose();
  presented = null;
});

/**
 * What the presenter drew for the last draw: the canvas (WebGL2, copied in
 * the same task) or the stand-in target (WebGPU, read back).
 */
async function readPresented(
  r: EngineCharacterRenderer,
): Promise<Uint8ClampedArray> {
  if (presented === null) return captureCanvas(canvas);
  const {width, height} = presented;
  const raw = (await r.renderer.readRenderTargetPixelsAsync(
    presented,
    0,
    0,
    width,
    height,
  )) as Uint8Array;
  return normalizeReadback(
    raw,
    width,
    height,
    cellReadbackLayout(r.backend, width),
  );
}

/** Covered pixels must match exactly; alpha everywhere. */
function expectShown(
  shown: Uint8ClampedArray,
  cell: Uint8ClampedArray,
): number {
  let compared = 0;
  for (let i = 0; i < cell.length; i += 4) {
    expect(shown[i + 3], `alpha @${i / 4}`).toBe(cell[i + 3]);
    if (cell[i + 3] !== 255) continue;
    compared++;
    expect([shown[i], shown[i + 1], shown[i + 2]], `rgb @${i / 4}`).toEqual([
      cell[i],
      cell[i + 1],
      cell[i + 2],
    ]);
  }
  return compared;
}

async function exportAll(
  r: EngineCharacterRenderer,
  settings?: RenderSettings,
): Promise<RenderedFrame[]> {
  const prepared = await r.prepareFrames(settings);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const frames: RenderedFrame[] = [];
  for await (const f of r.renderFrames(prepared.value)) frames.push(f);
  return frames;
}

/** Copies the canvas drawing buffer now (same task as the draw). */
function captureCanvas(c: HTMLCanvasElement): Uint8ClampedArray {
  const copy = document.createElement('canvas');
  copy.width = c.width;
  copy.height = c.height;
  const ctx = copy.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.drawImage(c, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

function opaqueCount(pixels: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 255) n++;
  return n;
}

function materialVersions(r: EngineCharacterRenderer): number[] {
  const out: number[] = [];
  r.assembly.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) out.push(m.version);
  });
  return out;
}

describe(`character renderer on the pixel pipeline (${currentBackend()})`, () => {
  it('AC-PIX-030.1: the preview paused on walk frame 3, direction ne equals the exported frame byte for byte; the canvas shows the cell', async () => {
    const settings = walkSettings();
    const r = await createRenderer(settings);
    expect((await r.playClip(CLIP)).ok).toBe(true);
    r.pause();
    r.setDirection(NE);
    const duration = r.assembly.clipDurationSec ?? 0;
    const t3 = computeSampleTimes(WALK, duration).times[3] as number;
    r.seek(t3);
    // REQ-PIX-031: the drawing buffer is the cell; the canvas shows it 1:1.
    expect([canvas.width, canvas.height]).toEqual([64, 64]);
    const shown =
      presented === null ? captureCanvas(canvas) : await readPresented(r);
    const cell = await r.readCell();
    expect(opaqueCount(cell)).toBeGreaterThan(50);
    expect(expectShown(shown, cell)).toBeGreaterThan(50);

    // Export with only `walk`: same pipeline, same framing.
    const frames = await exportAll(r, settings);
    expect(frames).toHaveLength(8 * 4);
    const exported = frames.find(f => f.direction === NE && f.frame === 3);
    if (exported === undefined) throw new Error('no ne/3 frame');
    expect(exported.timeSec).toBe(t3);
    expect(Array.from(exported.pixels)).toEqual(Array.from(cell));

    // After the export the preview is restored and redrawn identically.
    expect(r.busy).toBe(false);
    expect(Array.from(await r.readCell())).toEqual(Array.from(cell));
  });

  it('REQ-PIX-006 / AC-PIX-030.1: with mirrorWest the preview of w shows the flipped e cell, equal to the exported w frame', async () => {
    const settings = walkSettings({mirrorWest: true});
    const r = await createRenderer(settings);
    expect((await r.playClip(CLIP)).ok).toBe(true);
    r.pause();
    r.setDirection(4); // w
    const duration = r.assembly.clipDurationSec ?? 0;
    const t1 = computeSampleTimes(WALK, duration).times[1] as number;
    r.seek(t1);
    const shown =
      presented === null ? captureCanvas(canvas) : await readPresented(r);
    const cell = await r.readCell(); // the e pose
    const pivotX = r.framing?.pivotPx[0] ?? 32;
    const mirrored = mirrorFrame(cell, 64, 64, pivotX);
    expect(expectShown(shown, mirrored)).toBeGreaterThan(50);
    const frames = await exportAll(r, settings);
    const w = frames.find(f => f.direction === 4 && f.frame === 1);
    if (w === undefined) throw new Error('no w/1 frame');
    expect(Array.from(w.pixels)).toEqual(Array.from(mirrored));
  });

  it('AC-PIX-010.1: a static pose drawn twice in a row is byte-identical, also after turning away and back', async () => {
    const r = await createRenderer(walkSettings());
    expect((await r.playClip(CLIP)).ok).toBe(true);
    r.pause();
    r.setDirection(NE);
    r.seek(0.3);
    const a = await r.readCell();
    r.draw();
    const b = await r.readCell();
    r.setDirection(4);
    r.setDirection(NE);
    const c = await r.readCell();
    expect(opaqueCount(a)).toBeGreaterThan(50);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).toEqual(Array.from(a));
  });

  it('AC-PIX-001.1: resolution 48×64 → drawing buffer and the next RenderedFrame are 48×64', async () => {
    const r = await createRenderer(walkSettings());
    const next = walkSettings({
      resolution: {width: 48, height: 64},
      camera: {...walkSettings().camera, pivotRowPx: 12},
      directions: 1,
    });
    const set = await r.setRenderSettings(next);
    expect(set.ok).toBe(true);
    const size = r.renderer.getDrawingBufferSize(new THREE.Vector2());
    expect([size.x, size.y]).toEqual([48, 64]);
    expect([r.cellTarget.width, r.cellTarget.height]).toEqual([48, 64]);
    expect(r.resize(400, 400, 1.5)).toMatchObject({
      cellW: 48,
      cellH: 64,
      scale: 9,
    });
    const frames = await exportAll(r);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect([f.width, f.height]).toEqual([48, 64]);
      expect(f.pixels.length).toBe(48 * 64 * 4);
    }
  });

  it('AC-PIX-034.1: 100 rim-strength changes through the renderer rebuild nothing; the next frame shows the change', async () => {
    const base = walkSettings({
      palette: {...walkSettings().palette, id: 'none'},
    });
    const r = await createRenderer(base);
    expect((await r.playClip(CLIP)).ok).toBe(true);
    r.pause();
    r.setDirection(NE);
    r.seek(0);
    const rim = (strength: number): RenderSettings => ({
      ...base,
      toon: {...base.toon, rim: {enabled: true, strength}},
    });
    await r.setRenderSettings(rim(0));
    const off = await r.readCell();
    const rebuilds = r.pipelineStats.rebuilds;
    const versions = materialVersions(r);
    for (let i = 1; i <= 100; i++) {
      const result = await r.setRenderSettings(rim(i / 100));
      expect(result.ok).toBe(true);
    }
    expect(r.pipelineStats.rebuilds).toBe(rebuilds);
    expect(materialVersions(r)).toEqual(versions);
    const on = await r.readCell();
    let differing = 0;
    for (let i = 0; i < on.length; i++) if (on[i] !== off[i]) differing++;
    expect(differing).toBeGreaterThan(0);
  });
});
