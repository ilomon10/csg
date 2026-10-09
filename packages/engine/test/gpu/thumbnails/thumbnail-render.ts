/**
 * Browser side of `pnpm assets:thumbnails` (spec 011 REQ-AST-015, REQ-AST-039): renders the jobs
 * planned by `tools/lib/thumbnails/jobs.ts` through the export pixel pipeline (WebGL2), upscales
 * each cell with nearest neighbour and encodes lossless WebP with Chromium's canvas encoder
 * (quality 1 = VP8L). Not a test file itself.
 *
 * The framing rules live in the planner's module comment; this file implements them:
 * `auto` = the export framing (`prepareFrames`), `shared` = one numeric scale per group (the
 * largest auto scale of its members), `region` = a square box around the body vertices of the
 * slot's regions united with the part's own vertices, centred in the cell with a margin.
 */
import {
  SLOT_REGISTRY,
  clipManifestSchema,
  partManifestSchema,
} from '@csg/parts-schema';
import type {
  BodyRegion,
  CharacterSpec,
  RenderSettings,
  SlotId,
} from '@csg/parts-schema';
import {BODY_REGIONS} from '@csg/parts-schema';
import * as THREE from 'three/webgpu';
import {createCharacterAssembly} from '../../../src/composition/character-assembly';
import type {CharacterAssembly} from '../../../src/composition/character-assembly';
import type {Framing, ScreenBox} from '../../../src/contracts/pipeline';
import {stageYawRad} from '../../../src/pipeline/directions';
import {cameraElevationDeg} from '../../../src/pipeline/framing';
import {createPixelPipeline} from '../../../src/pipeline/render-pipeline';
import type {PixelPipeline} from '../../../src/pipeline/render-pipeline';
import {SettingsBinder} from '../../../src/pipeline/settings-binder';
import {PART_ID_USER_DATA} from '../../../src/pipeline/toon-material';
import {createAssetRegistry} from '../../../src/registry/asset-registry';
import {
  createPipelineFrameTarget,
  prepareFrames,
  renderFrames,
} from '../../../src/sampler/frame-sampler';
import type {FrameSamplerTarget} from '../../../src/sampler/frame-sampler';
import {projectCorners} from '../../../src/sampler/union-bounds';
import type {GpuHarness} from '../harness';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: {query: '?url'; import: 'default'; eager: true},
    ): Record<string, string>;
  }
}

/** A planned job as serialised by the planner (structural copy; tools are not imported). */
export interface RenderJob {
  readonly packId: string;
  readonly path: string;
  readonly kind: 'part' | 'character' | 'look' | 'shape';
  readonly id: string;
  readonly style?: string;
  readonly character: CharacterSpec;
  readonly settings: RenderSettings;
  readonly framing:
    | {readonly mode: 'auto'}
    | {readonly mode: 'shared'; readonly group: string}
    | {
        readonly mode: 'region';
        readonly slot: SlotId;
        readonly regions: readonly BodyRegion[];
        readonly marginPx: number;
      };
  readonly cellPx: number;
  readonly scale: number;
  readonly inputs: string;
}

/** Served URLs (`/@fs/…`) of the built packs. */
const PACK_URLS = import.meta.glob('../../../../../assets/packs/*/*.json', {
  query: '?url',
  import: 'default',
  eager: true,
});

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** The live rendering state shared by every job. */
export interface ThumbnailRig {
  readonly assembly: CharacterAssembly;
  readonly stage: THREE.Group;
  readonly pipeline: PixelPipeline;
  readonly target: FrameSamplerTarget;
  dispose(): void;
}

/** Registers every built pack and builds one assembly, stage, pipeline and frame target. */
export async function createThumbnailRig(h: GpuHarness): Promise<ThumbnailRig> {
  const registry = createAssetRegistry();
  const urls = Object.entries(PACK_URLS).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (urls.length === 0) throw new Error('no built packs served');
  for (const [path, url] of urls) {
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    if (path.endsWith('/manifest.json'))
      registry.registerPack(partManifestSchema.parse(await json(url)), base);
    else if (path.endsWith('/clips.json'))
      registry.registerClips(clipManifestSchema.parse(await json(url)), base);
  }
  const binder = new SettingsBinder();
  const assembly = createCharacterAssembly({
    registry,
    slots: SLOT_REGISTRY,
    material: {binder, backend: h.backend, mode: 'export'},
  });
  const scene = new THREE.Scene();
  const stage = new THREE.Group();
  stage.add(assembly.root);
  scene.add(stage);
  const created = createPixelPipeline({renderer: h.renderer, scene, binder});
  if (!created.ok) throw new Error(created.error.message);
  const pipeline = created.value;
  const target = createPipelineFrameTarget({
    pipeline,
    character: assembly,
    stage,
  });
  return {
    assembly,
    stage,
    pipeline,
    target,
    dispose() {
      pipeline.dispose();
      assembly.dispose();
      binder.dispose();
    },
  };
}

/** Renders a job's single frame with the export framing (`auto`, or a numeric scale). */
async function renderExport(
  rig: ThumbnailRig,
  settings: RenderSettings,
): Promise<{pixels: Uint8ClampedArray; worldPerPx: number}> {
  await rig.pipeline.setRenderSettings(settings);
  const prepared = await prepareFrames(rig.target, settings);
  if (!prepared.ok) throw new Error(prepared.error.message);
  let pixels: Uint8ClampedArray | undefined;
  for await (const frame of renderFrames(rig.target, prepared.value)) {
    pixels ??= frame.pixels;
  }
  if (pixels === undefined) throw new Error('no frame rendered');
  return {pixels, worldPerPx: prepared.value.framing.worldPerPx};
}

const _v = new THREE.Vector3();

/** Stage-space vertex positions of the meshes of one part ID (skinned, posed). */
function collectPoints(
  rig: ThumbnailRig,
  partId: number,
  regions: ReadonlySet<number> | null,
  out: number[],
): void {
  rig.stage.updateMatrixWorld(true);
  rig.assembly.root.traverseVisible(o => {
    const mesh = o as THREE.Mesh;
    if (
      !mesh.isMesh ||
      (mesh.userData as Record<string, unknown>)[PART_ID_USER_DATA] !== partId
    )
      return;
    const position = mesh.geometry.getAttribute('position');
    if (position === undefined) return;
    const region =
      regions === null ? undefined : mesh.geometry.getAttribute('regionId');
    if (regions !== null && region === undefined) return;
    for (let i = 0; i < position.count; i++) {
      if (region !== undefined && !regions!.has(Math.round(region.getX(i))))
        continue;
      mesh.getVertexPosition(i, _v);
      _v.applyMatrix4(mesh.matrixWorld);
      rig.stage.worldToLocal(_v);
      out.push(_v.x, _v.y, _v.z);
    }
  });
}

/**
 * Square region framing: the box scaled to fit `cell - 2 * margin` px, centred on a whole pixel,
 * frustum in whole multiples of `worldPerPx` (P-05).
 */
export function regionFraming(
  box: ScreenBox,
  cell: number,
  marginPx: number,
  elevationDeg: number,
): Framing {
  const avail = cell - 2 * marginPx;
  const extent = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const worldPerPx = extent > 0 ? extent / avail : 1;
  const cx = Math.round((box.minX + box.maxX) / 2 / worldPerPx);
  const cy = Math.round((box.minY + box.maxY) / 2 / worldPerPx);
  const half = cell / 2;
  return {
    worldPerPx,
    elevationDeg,
    frustum: {
      left: (cx - half) * worldPerPx,
      right: (cx + half) * worldPerPx,
      top: (cy + half) * worldPerPx,
      bottom: (cy - half) * worldPerPx,
    },
    pivotPx: [half - cx, cell - 1 - (half - cy)],
    clipped: [],
  };
}

/** Renders a region-framed part job (frame 0 of the job's single animation). */
async function renderRegion(
  rig: ThumbnailRig,
  job: RenderJob & {framing: {mode: 'region'}},
): Promise<{pixels: Uint8ClampedArray; worldPerPx: number}> {
  const {settings} = job;
  await rig.pipeline.setRenderSettings(settings);
  // The export plan gives the sample time of frame 0 and leaves the clip set.
  const prepared = await prepareFrames(rig.target, settings);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const first = prepared.value.jobs[0];
  if (first === undefined) throw new Error('empty frame plan');
  const elevation = cameraElevationDeg(settings.camera);
  const yaw = stageYawRad(settings.singleFacing);
  const target = rig.target;
  target.configure(settings);
  try {
    const set = await target.setClip(first.clipId, 'in-place');
    if (!set.ok) throw new Error(set.error.message);
    target.setRootReference(first.timeSec);
    target.pose(first.timeSec, 0);
    const bodyId = rig.assembly.partIds.get('body');
    const partId = rig.assembly.partIds.get(job.framing.slot);
    if (bodyId === undefined || partId === undefined)
      throw new Error(`${job.id}: part not attached`);
    const regions = new Set(
      job.framing.regions.map(r => BODY_REGIONS.indexOf(r)),
    );
    const points: number[] = [];
    collectPoints(rig, bodyId, regions, points);
    collectPoints(rig, partId, null, points);
    const box = projectCorners(points, yaw, elevation);
    const framing = regionFraming(
      box,
      job.cellPx,
      job.framing.marginPx,
      elevation,
    );
    target.setFraming(framing);
    target.pose(first.timeSec, 0);
    target.render();
    return {pixels: await target.read(), worldPerPx: framing.worldPerPx};
  } finally {
    target.restore();
  }
}

/** Numeric scale of each `shared` group: the largest auto scale of its members. */
export async function sharedScales(
  rig: ThumbnailRig,
  jobs: readonly RenderJob[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const job of jobs) {
    if (job.framing.mode !== 'shared') continue;
    const set = await rig.assembly.setCharacter(job.character);
    if (!set.ok) throw new Error(`${job.id}: ${set.error.message}`);
    await rig.pipeline.setRenderSettings(job.settings);
    const prepared = await prepareFrames(rig.target, job.settings);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const g = job.framing.group;
    out.set(g, Math.max(out.get(g) ?? 0, prepared.value.framing.worldPerPx));
  }
  return out;
}

/** Renders one job's cell (RGBA8, top-left origin). */
export async function renderJob(
  rig: ThumbnailRig,
  job: RenderJob,
  shared: ReadonlyMap<string, number>,
): Promise<{pixels: Uint8ClampedArray; worldPerPx: number}> {
  const set = await rig.assembly.setCharacter(job.character);
  if (!set.ok) throw new Error(`${job.id}: ${set.error.message}`);
  const {framing} = job;
  if (framing.mode === 'region')
    return renderRegion(rig, job as RenderJob & {framing: {mode: 'region'}});
  if (framing.mode === 'shared') {
    const scale = shared.get(framing.group);
    if (scale === undefined) throw new Error(`no scale for ${framing.group}`);
    return renderExport(rig, {
      ...job.settings,
      camera: {...job.settings.camera, framing: scale},
    });
  }
  return renderExport(rig, job.settings);
}

/**
 * The exact RGBA a thumbnail encodes: transparent pixels zeroed (a 2D canvas stores
 * premultiplied alpha, so their colour cannot survive anyway) and a nearest upscale by `scale`.
 */
export function thumbnailRgba(
  cell: Uint8ClampedArray,
  side: number,
  scale: number,
): Uint8ClampedArray {
  const outSide = side * scale;
  const out = new Uint8ClampedArray(outSide * outSide * 4);
  for (let y = 0; y < outSide; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < outSide; x++) {
      const s = (sy * side + Math.floor(x / scale)) * 4;
      const d = (y * outSide + x) * 4;
      const a = cell[s + 3]!;
      if (a !== 0 && a !== 255)
        throw new Error(`alpha ${a} is not binary (REQ-PIX-023)`);
      if (a === 0) continue;
      out[d] = cell[s]!;
      out[d + 1] = cell[s + 1]!;
      out[d + 2] = cell[s + 2]!;
      out[d + 3] = 255;
    }
  }
  return out;
}

/**
 * Rewrites Chromium's extended WebP (`VP8X` + an sRGB `ICCP` profile + `VP8L`) as a simple
 * lossless file holding only the `VP8L` chunk. The VP8L bitstream carries the size and the
 * alpha, and an untagged WebP is decoded as sRGB, so the pixels are unchanged and the file is
 * about 470 bytes smaller. Throws when the file has no single `VP8L` chunk or holds animation.
 */
export function simpleLosslessWebp(bytes: Uint8Array): Uint8Array {
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP')
    throw new Error('not a WebP file');
  let vp8l: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size =
      (bytes[at + 4]! |
        (bytes[at + 5]! << 8) |
        (bytes[at + 6]! << 16) |
        (bytes[at + 7]! << 24)) >>>
      0;
    const name = tag(at);
    if (
      name === 'VP8 ' ||
      name === 'ANIM' ||
      name === 'ANMF' ||
      name === 'ALPH'
    )
      throw new Error(`WebP chunk ${name} is not plain lossless`);
    if (name === 'VP8L') {
      if (vp8l !== undefined) throw new Error('two VP8L chunks');
      vp8l = bytes.subarray(at, at + 8 + size + (size & 1));
    }
    at += 8 + size + (size & 1);
  }
  if (vp8l === undefined) throw new Error('no VP8L chunk');
  const out = new Uint8Array(12 + vp8l.length);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  const riff = 4 + vp8l.length;
  out.set([riff & 255, (riff >> 8) & 255, (riff >> 16) & 255, riff >>> 24], 4);
  out.set([0x57, 0x45, 0x42, 0x50], 8);
  out.set(vp8l, 12);
  return out;
}

/**
 * Lossless WebP of an RGBA image with Chromium's encoder (`quality: 1` selects VP8L), reduced to
 * a simple `VP8L` file ({@link simpleLosslessWebp}). Throws on any other output.
 */
export async function encodeWebp(
  rgba: Uint8ClampedArray,
  side: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(side, side);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(rgba), side, side),
    0,
    0,
  );
  const blob = await canvas.convertToBlob({type: 'image/webp', quality: 1});
  if (blob.type !== 'image/webp') throw new Error(`encoder gave ${blob.type}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return simpleLosslessWebp(bytes);
}
