/**
 * M3-05 on the real renderer, both backends (WebGPU and `forceWebGL`), with the fixture pack:
 *
 * - two renderers on one registry keep their own tints, and the registry scenes keep their
 *   original materials (per-renderer materials);
 * - AC-CMP-043.1 (pixels): a stickman spec draws exactly the realistic cell;
 * - AC-CMP-015.1 (pixels): a per-part `primary` override colours only that part;
 * - REQ-UX-003 (engine part): the 3D view draws at viewport resolution, deterministically, and
 *   the pixel cell is byte-identical before and after a 3D detour.
 *
 * No golden files are written or read here: every comparison is between two renders of the
 * same run.
 */
import {
  V1_SLOT_IDS,
  characterSpecSchema,
  clipManifestSchema,
  defaultRenderSettings,
  partManifestSchema,
} from '@csg/parts-schema';
import type {
  CharacterSpec,
  PartEntry,
  PartManifest,
  RenderSettings,
} from '@csg/parts-schema';
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import type {AssemblyRegistry} from '../../src/composition/character-assembly';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import type {EngineAssetRegistry} from '../../src/registry/asset-registry';
import {cellReadbackLayout} from '../../src/pipeline/render-pipeline';
import {normalizeReadback} from '../../src/pipeline/readback';
import {createCanvasPresenter} from '../../src/renderer/canvas-presenter';
import {createCharacterRenderer} from '../../src/renderer/character-renderer';
import type {EngineCharacterRenderer} from '../../src/renderer/character-renderer';
import {createOrbitView} from '../../src/renderer/orbit-view';
import {currentBackend} from './harness';

const FIXTURES = `${location.origin}/test/fixtures/`;
const PACK = `${FIXTURES}pack/`;
const SPEC_URL = `${FIXTURES}character.valid.json`;
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
/** 3D viewport in device pixels (CSS 160 x 120 at dpr 1). */
const VIEW_W = 160;
const VIEW_H = 120;

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** The fixture manifest plus `fixture-body-primary` (its `Body` material mapped to `primary`). */
async function manifest(): Promise<PartManifest> {
  const m = partManifestSchema.parse(await json(`${PACK}manifest.json`));
  const body = m.parts.find(p => p.id === 'fixture-body') as PartEntry;
  return {
    ...m,
    parts: [
      ...m.parts,
      {
        ...body,
        id: 'fixture-body-primary',
        tintSlots: [{material: 'Body', slot: 'primary', mode: 'multiply'}],
      },
    ],
  };
}

async function fixtureRegistry(): Promise<EngineAssetRegistry> {
  const inner = createAssetRegistry();
  inner.registerPack(await manifest(), PACK);
  inner.registerClips(
    clipManifestSchema.parse(await json(`${PACK}clips.json`)),
    PACK,
  );
  return inner;
}

async function fixtureSpec(): Promise<CharacterSpec> {
  return characterSpecSchema.parse(await json(SPEC_URL));
}

function settings(): RenderSettings {
  return {
    ...defaultRenderSettings('three-quarter'),
    resolution: {width: 64, height: 64},
  };
}

function rgbaTarget(w: number, h: number): THREE.RenderTarget {
  return new THREE.RenderTarget(w, h, {
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

interface Live {
  readonly renderer: EngineCharacterRenderer;
  readonly view: THREE.RenderTarget;
  readonly targets: THREE.RenderTarget[];
}

const live: Live[] = [];

/**
 * A renderer whose presenter and 3D view draw into targets: vitest browser mode loses the
 * WebGPU instance when anything is presented to a WebGPU canvas (see character-renderer.gpu.ts).
 */
async function createRenderer(
  registry: AssemblyRegistry,
  spec: CharacterSpec,
): Promise<Live> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const view = rgbaTarget(VIEW_W, VIEW_H);
  const targets: THREE.RenderTarget[] = [view];
  const created = await createCharacterRenderer(canvas, {
    registry,
    slots: SLOT_REGISTRY,
    forceWebGL: currentBackend() === 'webgl2',
    settings: settings(),
    presenterFactory: (r, p) => {
      const presented = rgbaTarget(64, 64);
      targets.push(presented);
      return createCanvasPresenter(r, p.cellTarget, {output: presented});
    },
    orbitViewFactory: (r, scene) => createOrbitView(r, scene, {output: view}),
  });
  if (!created.ok) throw new Error(created.error.message);
  const renderer = created.value;
  expect(renderer.backend).toBe(currentBackend());
  const set = await renderer.setCharacter(spec);
  if (!set.ok) throw new Error(set.error.message);
  const entry = {renderer, view, targets};
  live.push(entry);
  return entry;
}

afterEach(() => {
  for (const {renderer, targets} of live.splice(0)) {
    renderer.dispose();
    for (const t of targets) t.dispose();
  }
});

async function readTarget(
  r: EngineCharacterRenderer,
  target: THREE.RenderTarget,
): Promise<Uint8ClampedArray> {
  const {width, height} = target;
  const raw = (await r.renderer.readRenderTargetPixelsAsync(
    target,
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

async function cellOf(r: EngineCharacterRenderer): Promise<number[]> {
  r.draw();
  return Array.from(await r.readCell());
}

/** Opaque pixels whose red channel exceeds blue by `margin`, and the reverse. */
function hues(pixels: ArrayLike<number>, margin = 24) {
  let red = 0;
  let blue = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if ((pixels[i + 3] as number) === 0) continue;
    const r = pixels[i] as number;
    const b = pixels[i + 2] as number;
    if (r > b + margin) red++;
    else if (b > r + margin) blue++;
  }
  return {red, blue};
}

function opaque(pixels: ArrayLike<number>): number {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if ((pixels[i] as number) > 0) n++;
  }
  return n;
}

function meshMaterials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    out.push(
      ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]),
    );
  });
  return out;
}

describe(`M3-05 renderer (${currentBackend()})`, () => {
  it('REQ-CMP-013 (M3-05): two renderers on one registry keep their own tints; the registry scenes keep their materials', async () => {
    const registry = await fixtureRegistry();
    const base = await fixtureSpec();
    const red: CharacterSpec = {
      ...base,
      tints: {...base.tints, primary: '#ff0000'},
    };
    const blue: CharacterSpec = {
      ...base,
      tints: {...base.tints, primary: '#0000ff'},
    };
    const shirt = await registry.resolve('builtin:fixture-pack/fixture-shirt');
    if (!shirt.ok) throw new Error(shirt.error.message);
    const original = meshMaterials(shirt.value.scene);

    const a = await createRenderer(registry, red);
    const before = await cellOf(a.renderer);
    const b = await createRenderer(registry, blue);
    const cellB = await cellOf(b.renderer);
    const after = await cellOf(a.renderer);

    // A is unchanged by B's tints; B shows its own (the fixture body is bluish in both, so
    // the shirt is measured as the difference between the two cells).
    expect(after).toEqual(before);
    const ha = hues(before);
    const hb = hues(cellB);
    expect(ha.red - hb.red).toBeGreaterThan(20);
    expect(hb.blue - ha.blue).toBeGreaterThan(20);
    expect(hb.red).toBe(0);
    expect(meshMaterials(shirt.value.scene)).toEqual(original);

    // Disposing B leaves A drawing the same bytes.
    b.renderer.dispose();
    expect(await cellOf(a.renderer)).toEqual(before);
  });

  it('AC-CMP-043.1 (pixels): a stickman spec draws exactly the realistic cell and keeps its stored style', async () => {
    const registry = await fixtureRegistry();
    const base = await fixtureSpec();
    const {renderer} = await createRenderer(registry, base);
    const realistic = await cellOf(renderer);
    expect(opaque(realistic)).toBeGreaterThan(50);
    const result = await renderer.setCharacter({...base, style: 'stickman'});
    expect(result.ok).toBe(true);
    expect(await cellOf(renderer)).toEqual(realistic);
    expect(renderer.assembly.spec?.style).toBe('stickman');
    expect(renderer.notices.map(n => n.message)).toEqual([
      'Stickman is coming soon. Showing Realistic for now.',
    ]);
  });

  it('AC-CMP-015.1 (pixels): character primary red and a body override primary blue: the body is blue, the shirt red', async () => {
    const registry = await fixtureRegistry();
    const base = await fixtureSpec();
    const plain: CharacterSpec = {
      ...base,
      body: {ref: 'builtin:fixture-pack/fixture-body-primary'},
      tints: {...base.tints, primary: '#ff0000'},
    };
    const {renderer} = await createRenderer(registry, plain);
    const allRed = hues(await cellOf(renderer));
    expect(allRed.red).toBeGreaterThan(50);
    expect(
      (
        await renderer.setCharacter({
          ...plain,
          body: {
            ref: 'builtin:fixture-pack/fixture-body-primary',
            tints: {primary: '#0000ff'},
          },
        })
      ).ok,
    ).toBe(true);
    // The body turns blue; the shirt (character primary) stays red.
    const split = hues(await cellOf(renderer));
    expect(split.blue - allRed.blue).toBeGreaterThan(20);
    expect(allRed.red - split.red).toBeGreaterThan(20);
    expect(split.red).toBeGreaterThan(20);
  });

  it('REQ-UX-003 (engine part): the 3D view draws at viewport resolution, deterministically; orbiting changes it; the pixel cell is identical before and after', async () => {
    const registry = await fixtureRegistry();
    const {renderer, view} = await createRenderer(
      registry,
      await fixtureSpec(),
    );
    const size = new THREE.Vector2();
    const cell = await cellOf(renderer);
    renderer.renderer.getDrawingBufferSize(size);
    expect([size.x, size.y]).toEqual([64, 64]);

    renderer.resize(VIEW_W, VIEW_H, 1);
    renderer.setViewMode('3d');
    renderer.renderer.getDrawingBufferSize(size);
    expect([size.x, size.y]).toEqual([VIEW_W, VIEW_H]);
    const first = Array.from(await readTarget(renderer, view));
    // The framed character (in profile: direction e) is drawn; the background stays transparent.
    const covered = opaque(first);
    expect(covered).toBeGreaterThan(VIEW_W * VIEW_H * 0.01);
    expect(covered).toBeLessThan(VIEW_W * VIEW_H * 0.9);
    renderer.draw();
    expect(Array.from(await readTarget(renderer, view))).toEqual(first);

    renderer.orbit(90, 0);
    const turned = Array.from(await readTarget(renderer, view));
    expect(turned).not.toEqual(first);
    renderer.orbit(-90, 0);
    expect(Array.from(await readTarget(renderer, view))).toEqual(first);

    renderer.setViewMode('pixel');
    expect(Array.from(await renderer.readCell())).toEqual(cell);
    renderer.renderer.getDrawingBufferSize(size);
    expect([size.x, size.y]).toEqual([64, 64]);
  });
});
