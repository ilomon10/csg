/**
 * Shared loader of the real default Quaternius character for GPU review
 * tests (FX-G look review, FX-I light-edge diagnosis): registers the built
 * packs from `assets/packs`, assembles `data/default-character.json` with
 * pixel-pipeline toon materials, and runs one export through
 * `prepareFrames` -> `renderFrames`. Not a test file itself.
 */
import {
  DEFAULT_CHARACTER_DATA,
  clipManifestSchema,
  loadSlotRegistry,
  partManifestSchema,
} from '@csg/parts-schema';
import type {RenderSettings, SlotRegistry} from '@csg/parts-schema';
import * as THREE from 'three/webgpu';
import {createCharacterAssembly} from '../../src/composition/character-assembly';
import type {CharacterAssembly} from '../../src/composition/character-assembly';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import type {SettingsBinder} from '../../src/pipeline/settings-binder';
import {
  createPipelineFrameTarget,
  prepareFrames,
  renderFrames,
} from '../../src/sampler/frame-sampler';
import type {PreparedFrames} from '../../src/sampler/frame-sampler';
import type {GpuHarness} from './harness';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: {query: '?url'; import: 'default'; eager: true},
    ): Record<string, string>;
  }
}

/** Served URLs (`/@fs/…`) of the built packs and the slot registry. */
const PACK_URLS = import.meta.glob('../../../../assets/packs/*/*.json', {
  query: '?url',
  import: 'default',
  eager: true,
});
const SLOT_URLS = import.meta.glob('../../../parts-schema/data/slots.json', {
  query: '?url',
  import: 'default',
  eager: true,
});

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** The pack base URL (with trailing slash) of a served manifest URL. */
function baseOf(url: string): string {
  return url.slice(0, url.lastIndexOf('/') + 1);
}

/** The assembled default character on its stage group. */
export interface RealStage {
  readonly scene: THREE.Scene;
  readonly stage: THREE.Group;
  readonly assembly: CharacterAssembly;
  dispose(): void;
}

/** Review-only variations of {@link loadDefaultCharacter}. */
export interface RealCharacterOptions {
  /** Replaces the character-wide tints of `data/default-character.json`. */
  readonly tints?: Readonly<Record<string, string>>;
}

/** Loads and assembles the default character with export-mode toon materials. */
export async function loadDefaultCharacter(
  binder: SettingsBinder,
  backend: 'webgpu' | 'webgl2',
  options: RealCharacterOptions = {},
): Promise<RealStage> {
  const registry = createAssetRegistry();
  const urls = Object.entries(PACK_URLS).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [path, url] of urls) {
    if (path.endsWith('/manifest.json')) {
      registry.registerPack(
        partManifestSchema.parse(await json(url)),
        baseOf(url),
      );
    } else if (path.endsWith('/clips.json'))
      registry.registerClips(
        clipManifestSchema.parse(await json(url)),
        baseOf(url),
      );
  }
  const slotsUrl = Object.values(SLOT_URLS)[0];
  if (slotsUrl === undefined) throw new Error('slots.json not served');
  const slots = loadSlotRegistry(await json(slotsUrl));
  if (!slots.ok) throw new Error('slots.json invalid');
  const assembly = createCharacterAssembly({
    registry,
    slots: slots.value as SlotRegistry,
    material: {binder, backend, mode: 'export'},
  });
  const character =
    options.tints === undefined
      ? DEFAULT_CHARACTER_DATA.character
      : {
          ...DEFAULT_CHARACTER_DATA.character,
          tints: {...DEFAULT_CHARACTER_DATA.character.tints, ...options.tints},
        };
  const set = await assembly.setCharacter(
    character as typeof DEFAULT_CHARACTER_DATA.character,
  );
  if (!set.ok) throw new Error(set.error.message);
  const scene = new THREE.Scene();
  const stage = new THREE.Group();
  stage.add(assembly.root);
  scene.add(stage);
  return {scene, stage, assembly, dispose: () => assembly.dispose()};
}

/** Renders every frame of `settings` through a fresh pixel pipeline. */
export async function runExport(
  h: GpuHarness,
  f: RealStage,
  binder: SettingsBinder,
  settings: RenderSettings,
): Promise<{prepared: PreparedFrames; frames: RenderedFrame[]}> {
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
    return {prepared: prepared.value, frames};
  } finally {
    pipeline.dispose();
  }
}

/**
 * FX-I light pixel: covered, sRGB luminance > 0.6 and not skin-like (chroma
 * `max − min` < 0.25), so lit faces and hands do not count.
 */
export function isLightPixel(
  p: Uint8ClampedArray | Uint8Array,
  i: number,
): boolean {
  if (p[i + 3] === 0) return false;
  const r = p[i]! / 255;
  const g = p[i + 1]! / 255;
  const b = p[i + 2]! / 255;
  return (
    srgbLuminance(p, i) > 0.6 && Math.max(r, g, b) - Math.min(r, g, b) < 0.25
  );
}

/**
 * Rec. 709 luminance of the encoded sRGB bytes at byte offset `i`, in [0, 1]
 * (FX-I metric: weights applied to the sRGB values, not to linear light).
 */
export function srgbLuminance(
  p: Uint8ClampedArray | Uint8Array,
  i: number,
): number {
  return (0.2126 * p[i]! + 0.7152 * p[i + 1]! + 0.0722 * p[i + 2]!) / 255;
}

/** sRGB luminance below which a rim-off pixel counts as dark (AC-PIX-012.8). */
export const RIM_MADE_OFF_LUMINANCE = 0.4;

/** AC-PIX-012.8 rim-made light-pixel statistics of a rim-on / rim-off pair. */
export interface RimMadeStats {
  /** Light pixels (rim on) that are dark (luminance < 0.4) with the rim off. */
  readonly rimMade: number;
  /** Rim-made light pixels without a light 8-neighbour in the rim-on frame. */
  readonly isolatedRimMade: number;
}

/**
 * AC-PIX-012.8 gate metric. A pixel is rim-made light when it is an FX-I
 * light pixel ({@link isLightPixel}) in the rim-on frame and its sRGB
 * luminance ({@link srgbLuminance}) in the rim-off frame is below
 * {@link RIM_MADE_OFF_LUMINANCE}; it is isolated when none of its in-frame
 * 8-neighbours is light in the rim-on frame.
 *
 * @param rimOn - Square frames of side `cell`, rim enabled.
 * @param rimOff - The same frames (same order and settings) with the rim off.
 * @param cell - Frame side in px.
 */
export function rimMadeStats(
  rimOn: readonly RenderedFrame[],
  rimOff: readonly RenderedFrame[],
  cell: number,
): RimMadeStats {
  if (rimOn.length !== rimOff.length)
    throw new Error(
      `rimMadeStats: ${rimOn.length} rim-on vs ${rimOff.length} rim-off frames`,
    );
  let rimMade = 0;
  let isolatedRimMade = 0;
  rimOn.forEach((f, fi) => {
    const p = f.pixels;
    const q = rimOff[fi]!.pixels;
    const at = (x: number, y: number) => (y * cell + x) * 4;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = at(x, y);
        if (!isLightPixel(p, i)) continue;
        if (srgbLuminance(q, i) >= RIM_MADE_OFF_LUMINANCE) continue;
        rimMade++;
        let neighbour = false;
        for (let dy = -1; dy <= 1 && !neighbour; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) continue;
            if (isLightPixel(p, at(nx, ny))) {
              neighbour = true;
              break;
            }
          }
        }
        if (!neighbour) isolatedRimMade++;
      }
    }
  });
  return {rimMade, isolatedRimMade};
}

/** FX-I light-pixel statistics of a set of frames. */
export interface LightStats {
  /** Light pixels in total. */
  readonly light: number;
  /** Light pixels without a light pixel among their 8 neighbours (speckles). */
  readonly isolated: number;
  /** Light pixels with an uncovered 4-neighbour in `coverage` (silhouette). */
  readonly silhouette: number;
  /** Isolated light pixels that are also silhouette pixels (FX-K split). */
  readonly isolatedSilhouette: number;
  /** Covered pixels. */
  readonly covered: number;
}

/**
 * Counts FX-I light pixels (see {@link isLightPixel}); `isolated` is the
 * speckle metric of FX-I/FX-J.
 *
 * @param frames - Square frames of side `cell`.
 * @param cell - Frame side in px.
 * @param coverage - Optional matching outline-off frames for `silhouette`.
 */
export function lightStats(
  frames: readonly RenderedFrame[],
  cell: number,
  coverage?: readonly RenderedFrame[],
): LightStats {
  let light = 0;
  let isolated = 0;
  let silhouette = 0;
  let isolatedSilhouette = 0;
  let covered = 0;
  frames.forEach((f, fi) => {
    const p = f.pixels;
    const c = (coverage?.[fi] ?? f).pixels;
    const at = (x: number, y: number) => (y * cell + x) * 4;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = at(x, y);
        if (p[i + 3] === 0) continue;
        covered++;
        if (!isLightPixel(p, i)) continue;
        light++;
        let neighbour = false;
        let edge = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cell || ny >= cell) {
              edge = true;
              continue;
            }
            const j = at(nx, ny);
            if (isLightPixel(p, j)) neighbour = true;
            if (Math.abs(dx) + Math.abs(dy) === 1 && c[j + 3] === 0)
              edge = true;
          }
        }
        if (!neighbour) isolated++;
        if (edge) silhouette++;
        if (edge && !neighbour) isolatedSilhouette++;
      }
    }
  });
  return {light, isolated, silhouette, isolatedSilhouette, covered};
}
