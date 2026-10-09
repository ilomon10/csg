/**
 * The frame sampler on the real pipeline (M2-16), both backends: the M1
 * fixture character (body, shirt, sword) assembled with toon materials and
 * part IDs (`CharacterAssembly` + `TintMaterialOptions`), exported through
 * `prepareFrames` → `renderFrames` → `PixelPipeline.render()` + readback.
 *
 * - REQ-PIX-027 / AC-PIX-010.1: 8 directions × 2 frames, byte-identical over
 *   2 fresh pipelines.
 * - AC-PIX-007.1: one camera matrix for every frame; no opaque pixel on a
 *   cell edge unless the frame is reported clipped.
 * - AC-PIX-014.1: the part-ID attachment reads back identically when the
 *   parts finish loading in opposite orders.
 * - AC-EXP-024.1: abort at 50 % rejects with EXP_CANCELLED within 250 ms.
 * - Review strip (not a golden, D2): `test-results/m2-16/<backend>/sampler-three-quarter-64.png`.
 */
import {
  V1_SLOT_IDS,
  characterSpecSchema,
  clipManifestSchema,
  defaultRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {createCharacterAssembly} from '../../src/composition/character-assembly';
import type {
  AssemblyRegistry,
  CharacterAssembly,
} from '../../src/composition/character-assembly';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import type {PixelPipeline} from '../../src/pipeline/render-pipeline';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {
  PART_ID_USER_DATA,
  TOON_MATERIAL_USER_DATA,
} from '../../src/pipeline/toon-material';
import {
  EXP_CANCELLED,
  createPipelineFrameTarget,
  prepareFrames,
  renderFrames,
} from '../../src/sampler/frame-sampler';
import type {
  FrameLogEntry,
  PreparedFrames,
} from '../../src/sampler/frame-sampler';
import {createGpuHarness, currentBackend, toBase64} from './harness';
import type {GpuHarness} from './harness';

const FIXTURES = `${location.origin}/test/fixtures/`;
const PACK = `${FIXTURES}pack/`;
const SPEC_URL = `${FIXTURES}character.valid.json`;
const CLIP = 'builtin:fixture-pack/fixture-clip';
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

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** A fresh registry over the fixture pack; part loads finish after `delayMs(ref)`. */
async function fixtureRegistry(
  delayMs: (ref: string) => number = () => 0,
): Promise<AssemblyRegistry> {
  const inner = createAssetRegistry();
  inner.registerPack(
    partManifestSchema.parse(await json(`${PACK}manifest.json`)),
    PACK,
  );
  inner.registerClips(
    clipManifestSchema.parse(await json(`${PACK}clips.json`)),
    PACK,
  );
  return {
    async resolve(ref) {
      const result = await inner.resolve(ref);
      await new Promise(r => setTimeout(r, delayMs(ref)));
      return result as Awaited<ReturnType<AssemblyRegistry['resolve']>>;
    },
    resolveClip: ref => inner.resolveClip(ref),
    clipEntry: ref => inner.clipEntry(ref),
  };
}

interface Fixture {
  readonly scene: THREE.Scene;
  readonly stage: THREE.Group;
  readonly assembly: CharacterAssembly;
  dispose(): void;
}

async function loadFixture(
  binder: SettingsBinder,
  backend: 'webgpu' | 'webgl2',
  delayMs?: (ref: string) => number,
): Promise<Fixture> {
  const assembly = createCharacterAssembly({
    registry: await fixtureRegistry(delayMs),
    slots: SLOT_REGISTRY,
    material: {binder, backend, mode: 'export'},
  });
  const set = await assembly.setCharacter(
    characterSpecSchema.parse(await json(SPEC_URL)),
  );
  if (!set.ok) throw new Error(set.error.message);
  const scene = new THREE.Scene();
  const stage = new THREE.Group();
  stage.add(assembly.root);
  scene.add(stage);
  return {scene, stage, assembly, dispose: () => assembly.dispose()};
}

function exportSettings(): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  return {
    ...s,
    directions: 8,
    palette: {
      ...s.palette,
      id: 'pico-8',
      dither: {mode: 'bayer4', strength: 0.5},
    },
    animations: [
      {clipId: CLIP, label: 'walk', frameCount: 2, fps: 8, loop: true},
    ],
  };
}

async function newPipeline(
  h: GpuHarness,
  f: Fixture,
  binder: SettingsBinder,
  settings: RenderSettings,
): Promise<PixelPipeline> {
  const created = createPixelPipeline({
    renderer: h.renderer,
    scene: f.scene,
    binder,
  });
  if (!created.ok) throw new Error(created.error.message);
  await created.value.setRenderSettings(settings);
  return created.value;
}

interface ExportRun {
  readonly prepared: PreparedFrames;
  readonly frames: RenderedFrame[];
  readonly cameras: string[];
  readonly log: FrameLogEntry[];
}

async function runExport(
  h: GpuHarness,
  f: Fixture,
  binder: SettingsBinder,
  settings: RenderSettings,
): Promise<ExportRun> {
  const pipeline = await newPipeline(h, f, binder, settings);
  try {
    const target = createPipelineFrameTarget({
      pipeline,
      character: f.assembly,
      stage: f.stage,
    });
    const prepared = await prepareFrames(target, settings);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const frames: RenderedFrame[] = [];
    const cameras: string[] = [];
    const log: FrameLogEntry[] = [];
    for await (const frame of renderFrames(target, prepared.value, {
      log,
      onProgress: () => {
        cameras.push(
          [
            ...pipeline.camera.matrixWorld.elements,
            ...pipeline.camera.projectionMatrix.elements,
          ].join(','),
        );
      },
    })) {
      frames.push(frame);
    }
    return {prepared: prepared.value, frames, cameras, log};
  } finally {
    pipeline.dispose();
  }
}

/** FNV-1a 32-bit (log only). */
function fnv1a(bytes: ArrayLike<number>): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i] as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function edgeOpaque(frame: RenderedFrame): number {
  const {width: w, height: h, pixels} = frame;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x !== 0 && y !== 0 && x !== w - 1 && y !== h - 1) continue;
      if (pixels[(y * w + x) * 4 + 3] !== 0) n++;
    }
  }
  return n;
}

describe(`frame sampler on the pipeline (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let fixture: Fixture;
  beforeAll(async () => {
    h = await createGpuHarness(64, 64);
    binder = new SettingsBinder();
    fixture = await loadFixture(binder, h.backend);
  });
  afterAll(() => {
    fixture?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  it('REQ-PIX-011, REQ-PIX-014: the assembly gives every mesh, the static sword included, a toon material and a part ID', () => {
    let meshes = 0;
    fixture.assembly.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      meshes++;
      const list = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of list)
        expect(m.userData[TOON_MATERIAL_USER_DATA]).toBe('toon');
      expect(mesh.userData[PART_ID_USER_DATA]).toBeGreaterThanOrEqual(1);
    });
    expect(meshes).toBeGreaterThanOrEqual(3);
    expect(fixture.assembly.parts.get('prop-main-hand')?.part.entry.kind).toBe(
      'static',
    );
  });

  it('REQ-PIX-027, AC-PIX-010.1, AC-PIX-007.1, AC-ANM-011.1: 8 directions × 2 frames through renderFrames are byte-identical over 2 runs, share one camera, and stay off the cell edges unless clipped', async () => {
    const settings = exportSettings();
    const a = await runExport(h, fixture, binder, settings);
    const b = await runExport(h, fixture, binder, settings);
    expect(a.frames).toHaveLength(16);
    expect(a.frames.map(f => [f.clipId, f.direction, f.frame])).toEqual(
      a.prepared.jobs.map(j => [j.label, j.direction, j.frame]),
    );
    // Same sample time for frame i in every direction (frame log).
    for (const frame of [0, 1]) {
      const times = new Set(
        a.log.filter(e => e.frame === frame).map(e => e.timeSec),
      );
      expect(times.size).toBe(1);
    }
    // One camera matrix (16 + 16 floats) for every frame.
    expect(new Set(a.cameras).size).toBe(1);
    expect(b.prepared.framing).toEqual(a.prepared.framing);
    for (let i = 0; i < a.frames.length; i++) {
      const fa = a.frames[i] as RenderedFrame;
      const fb = b.frames[i] as RenderedFrame;
      expect(fb.pixels.length).toBe(fa.pixels.length);
      expect(fnv1a(fb.pixels)).toBe(fnv1a(fa.pixels));
      expect(Array.from(fb.pixels)).toEqual(Array.from(fa.pixels));
    }
    let opaque = 0;
    for (const f of a.frames)
      for (let i = 3; i < f.pixels.length; i += 4)
        if (f.pixels[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(16 * 50);
    const clipped = new Set(
      a.prepared.framing.clipped.map(c => `${c.label}/${c.direction}`),
    );
    for (const f of a.frames) {
      if (!clipped.has(`${f.clipId}/${f.direction}`))
        expect(edgeOpaque(f)).toBe(0);
    }
    console.log(
      `[m2-16] ${h.backend} digest ${fnv1a(a.frames.flatMap(f => Array.from(f.pixels)))}; ` +
        `worldPerPx ${a.prepared.framing.worldPerPx}; clipped ${a.prepared.framing.clipped.length}; ` +
        `warnings ${a.prepared.warnings.map(w => w.code).join(',') || 'none'}`,
    );

    // Review strip: 8 directions side by side, frame 0 on top, frame 1 below.
    const {width: w, height: hh} = settings.resolution;
    const strip = new Uint8ClampedArray(w * 8 * hh * 2 * 4);
    for (const f of a.frames) {
      for (let y = 0; y < hh; y++) {
        strip.set(
          f.pixels.subarray(y * w * 4, (y + 1) * w * 4),
          ((f.frame * hh + y) * w * 8 + f.direction * w) * 4,
        );
      }
    }
    await commands.csgSeedGolden(
      'test-results/m2-16',
      h.backend,
      'sampler-three-quarter-64',
      toBase64(new Uint8Array(strip.buffer)),
      w * 8,
      hh * 2,
    );
  });

  it('REQ-PIX-007 (FX-G): with room below the pivot (pivotRowPx 12) the auto-framed fixture fills ≥ 70 % of the 64 px cell in every frame, unclipped and off the cell edges', async () => {
    const base = exportSettings();
    const settings: RenderSettings = {
      ...base,
      camera: {...base.camera, pivotRowPx: 12},
    };
    const run = await runExport(h, fixture, binder, settings);
    expect(run.prepared.framing.clipped).toEqual([]);
    expect(new Set(run.cameras).size).toBe(1);
    let minHeight = settings.resolution.height;
    for (const f of run.frames) {
      let top = f.height;
      let bottom = -1;
      for (let i = 3; i < f.pixels.length; i += 4) {
        if (f.pixels[i] === 0) continue;
        const y = Math.floor((i - 3) / 4 / f.width);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      minHeight = Math.min(minHeight, bottom - top + 1);
      expect(edgeOpaque(f)).toBe(0);
    }
    console.log(
      `[fx-g] ${h.backend} fixture three-quarter pivotRowPx 12: worldPerPx ${run.prepared.framing.worldPerPx.toFixed(5)} minFrameHeight ${minHeight}px`,
    );
    expect(minHeight).toBeGreaterThanOrEqual(Math.ceil(0.7 * 64));
  });

  it('AC-PIX-014.1: the part-ID target reads back identically when the parts finish loading in opposite orders', async () => {
    const order = [
      'builtin:fixture-pack/fixture-body',
      'builtin:fixture-pack/fixture-shirt',
      'builtin:fixture-pack/fixture-sword',
    ];
    const readbacks: Uint16Array[] = [];
    for (const delays of [
      [1, 20, 40],
      [40, 20, 1],
    ]) {
      const b = new SettingsBinder();
      const f = await loadFixture(
        b,
        h.backend,
        ref => delays[order.indexOf(ref)] ?? 0,
      );
      const settings = exportSettings();
      const pipeline = await newPipeline(h, f, b, settings);
      try {
        const target = createPipelineFrameTarget({
          pipeline,
          character: f.assembly,
          stage: f.stage,
        });
        const prepared = await prepareFrames(target, settings);
        if (!prepared.ok) throw new Error(prepared.error.message);
        target.configure(settings);
        target.setFraming(prepared.value.framing);
        await target.setClip(CLIP, 'in-place');
        target.setRootReference(0);
        target.pose(0.25, 7);
        target.render();
        target.restore();
        const rt = pipeline.scenePass.renderTarget;
        const index = rt.textures.findIndex(t => t.name === 'partId');
        expect(index).toBeGreaterThanOrEqual(0);
        const raw = await h.renderer.readRenderTargetPixelsAsync(
          rt,
          0,
          0,
          rt.width,
          rt.height,
          index,
        );
        const view = raw as unknown as ArrayBufferView;
        readbacks.push(
          new Uint16Array(view.buffer, view.byteOffset, view.byteLength / 2),
        );
      } finally {
        pipeline.dispose();
        f.dispose();
        b.dispose();
      }
    }
    const [first, second] = readbacks as [Uint16Array, Uint16Array];
    expect(first.length).toBeGreaterThan(0);
    // Non-background IDs exist (fp16 1.0 = 0x3c00, 2.0 = 0x4000, …).
    const ids = new Set<number>();
    for (let i = 0; i < first.length; i += 4) ids.add(first[i] as number);
    expect(ids.size).toBeGreaterThanOrEqual(3);
    expect(
      fnv1a(
        new Uint8Array(second.buffer, second.byteOffset, second.byteLength),
      ),
    ).toBe(
      fnv1a(new Uint8Array(first.buffer, first.byteOffset, first.byteLength)),
    );
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('AC-EXP-024.1: an abort at 50 % render progress rejects with EXP_CANCELLED within 250 ms', async () => {
    const settings = exportSettings();
    const pipeline = await newPipeline(h, fixture, binder, settings);
    try {
      const target = createPipelineFrameTarget({
        pipeline,
        character: fixture.assembly,
        stage: fixture.stage,
      });
      const prepared = await prepareFrames(target, settings);
      if (!prepared.ok) throw new Error(prepared.error.message);
      const controller = new AbortController();
      let abortedAt = 0;
      let count = 0;
      let error: unknown;
      try {
        for await (const _frame of renderFrames(target, prepared.value, {
          signal: controller.signal,
        })) {
          count++;
          if (count === 8) {
            abortedAt = performance.now();
            controller.abort();
          }
        }
      } catch (e) {
        error = e;
      }
      const elapsed = performance.now() - abortedAt;
      expect(count).toBe(8);
      expect((error as {code?: string}).code).toBe(EXP_CANCELLED);
      expect(elapsed).toBeLessThanOrEqual(250);
      // The stage is restored for the preview.
      expect(fixture.stage.rotation.y).toBe(0);
      expect(fixture.stage.position.toArray()).toEqual([0, 0, 0]);
      console.log(
        `[m2-16] ${h.backend} abort → reject ${elapsed.toFixed(1)} ms`,
      );
    } finally {
      pipeline.dispose();
    }
  });
});
