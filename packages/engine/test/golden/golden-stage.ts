/**
 * Shared helpers of the golden suite (M2-18, REQ-PIX-028). Not a test file: builds settings,
 * loads the fixture character, renders a strip through the pixel pipeline and frame sampler
 * directly (not through the renderer) and compares it with the committed golden.
 */
import {
  characterSpecSchema,
  clipManifestSchema,
  loadSlotRegistry,
  parseRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import type {RenderSettings, SlotRegistry} from '@csg/parts-schema';
import * as THREE from 'three/webgpu';
import {createCharacterAssembly} from '../../src/composition/character-assembly';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import type {SettingsBinder} from '../../src/pipeline/settings-binder';
import {
  createPipelineFrameTarget,
  prepareFrames,
  renderFrames,
} from '../../src/sampler/frame-sampler';
import type {GpuHarness} from '../gpu/harness';
import {compareGolden} from '../gpu/harness';
import type {RealStage} from '../gpu/real-character';

/** Camera presets of the golden matrix. */
export type Preset = 'side' | 'three-quarter' | 'isometric';

/** Options of {@link goldenSettings}. */
export interface GoldenSettingsOptions {
  preset: Preset;
  /** Square cell size in px. */
  size: number;
  clipId: string;
  /** Frames of the single clip (strip rows). */
  frames: number;
  /** pico-8 palette with bayer4 dither instead of the default look. */
  pico8?: boolean;
  /** Extra top-level RenderSettings input fields (replace the defaults of that key as a whole). */
  extra?: Record<string, unknown>;
}

/** RenderSettings of one golden case: 8 directions, one clip, resolution-relative pivot row. */
export function goldenSettings(o: GoldenSettingsOptions): RenderSettings {
  const result = parseRenderSettings({
    resolution: {width: o.size, height: o.size},
    camera: {preset: o.preset},
    directions: 8,
    animations: [
      {
        clipId: o.clipId,
        label: 'clip',
        frameCount: o.frames,
        fps: 8,
        loop: true,
      },
    ],
    ...(o.pico8 === true
      ? {palette: {id: 'pico-8', dither: {mode: 'bayer4', strength: 0.5}}}
      : {}),
    ...o.extra,
  });
  if (!result.ok)
    throw new Error(`bad golden settings: ${JSON.stringify(result.issues)}`);
  return result.value;
}

// The GPU projects serve `packages/engine` at the dev-server root.
const FIXTURES = `${location.origin}/test/fixtures/`;
const PACK = `${FIXTURES}pack/`;
const SLOTS_URL = Object.values(
  (
    import.meta as unknown as {
      glob(
        pattern: string,
        options: {query: '?url'; import: 'default'; eager: true},
      ): Record<string, string>;
    }
  ).glob('../../../parts-schema/data/slots.json', {
    query: '?url',
    import: 'default',
    eager: true,
  }),
)[0];

/** Clip of the fixture pack. */
export const FIXTURE_CLIP = 'builtin:fixture-pack/fixture-clip';

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Loads the M1 fixture character (body, shirt, sword) with export-mode toon materials. */
export async function loadFixtureStage(
  binder: SettingsBinder,
  backend: 'webgpu' | 'webgl2',
): Promise<RealStage> {
  const registry = createAssetRegistry();
  registry.registerPack(
    partManifestSchema.parse(await json(`${PACK}manifest.json`)),
    PACK,
  );
  registry.registerClips(
    clipManifestSchema.parse(await json(`${PACK}clips.json`)),
    PACK,
  );
  if (SLOTS_URL === undefined) throw new Error('slots.json not served');
  const slots = loadSlotRegistry(await json(SLOTS_URL));
  if (!slots.ok) throw new Error('slots.json invalid');
  const assembly = createCharacterAssembly({
    registry,
    slots: slots.value as SlotRegistry,
    material: {binder, backend, mode: 'export'},
  });
  const set = await assembly.setCharacter(
    characterSpecSchema.parse(await json(`${FIXTURES}character.valid.json`)),
  );
  if (!set.ok) throw new Error(set.error.message);
  const scene = new THREE.Scene();
  const stage = new THREE.Group();
  stage.add(assembly.root);
  scene.add(stage);
  return {scene, stage, assembly, dispose: () => assembly.dispose()};
}

/** Renders every frame of `settings` through a fresh pixel pipeline (pipeline + sampler, no renderer). */
export async function renderAll(
  h: GpuHarness,
  f: RealStage,
  binder: SettingsBinder,
  settings: RenderSettings,
): Promise<{frames: RenderedFrame[]; warnings: string[]}> {
  const created = createPixelPipeline({
    renderer: h.renderer,
    scene: f.scene,
    binder,
  });
  if (!created.ok) throw new Error(created.error.message);
  const pipeline = created.value;
  try {
    await pipeline.setRenderSettings(settings);
    const target = createPipelineFrameTarget({
      pipeline,
      character: f.assembly,
      stage: f.stage,
    });
    const prepared = await prepareFrames(target, settings);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const frames: RenderedFrame[] = [];
    for await (const frame of renderFrames(target, prepared.value))
      frames.push(frame);
    return {frames, warnings: prepared.value.warnings.map(w => w.code)};
  } finally {
    pipeline.dispose();
  }
}

/** Strip image: column = direction index, row = frame index. */
export interface Strip {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Lays the frames of one clip out as `directions` columns by `frames` rows. */
export function layoutStrip(
  frames: readonly RenderedFrame[],
  cell: number,
  directions: number,
  rows: number,
): Strip {
  const width = cell * directions;
  const height = cell * rows;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const f of frames) {
    if (f.direction >= directions || f.frame >= rows)
      throw new Error(`frame ${f.direction}/${f.frame} outside the strip`);
    for (let y = 0; y < cell; y++) {
      rgba.set(
        f.pixels.subarray(y * cell * 4, (y + 1) * cell * 4),
        ((f.frame * cell + y) * width + f.direction * cell) * 4,
      );
    }
  }
  return {rgba, width, height};
}

/** Renders a case and compares its strip with the golden `name` (tolerance 0). */
export async function goldenCase(
  h: GpuHarness,
  f: RealStage,
  binder: SettingsBinder,
  name: string,
  settings: RenderSettings,
): Promise<{frames: RenderedFrame[]; strip: Strip}> {
  const {frames, warnings} = await renderAll(h, f, binder, settings);
  const cell = settings.resolution.width;
  const rows = settings.animations[0]?.frameCount ?? 1;
  const strip = layoutStrip(frames, cell, 8, rows);
  // Framing must not clip (a clipped golden would freeze a broken look).
  if (warnings.includes('PIX_FRAMING_CLIPPED'))
    throw new Error(`${name}: PIX_FRAMING_CLIPPED`);
  await compareGolden(h, name, strip.rgba, strip.width, strip.height);
  return {frames, strip};
}
