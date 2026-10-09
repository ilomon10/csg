/**
 * The M1 fixture character (body, shirt, sword; `fixture-clip` at t = 0.25 s)
 * through the whole pixel pipeline on both backends (M2-14): union-bounds
 * framing → toon materials → scene MRT → default post chain → readback.
 *
 * - Byte determinism over 3 fresh pipelines in one session (REQ-PIX-027;
 *   M2-02 recommendation; goldens from another process come with M2-18).
 * - AC-PIX-002.2: palette `none` ⇒ every alpha is 0 or 255.
 * - Review PNGs (not goldens, PM decision D2) of the 64 px direction strips in
 *   the three presets: `test-results/m2-14/<backend>/fixture-<preset>-64[-pico8].png`.
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
import type {CharacterAssembly} from '../../src/composition/character-assembly';
import {applyTintMaterial} from '../../src/composition/tint-material';
import {createAssetRegistry} from '../../src/registry/asset-registry';
import {directionLabels, stageYawRad} from '../../src/pipeline/directions';
import {computeFraming} from '../../src/pipeline/framing';
import {partIdFor} from '../../src/pipeline/part-ids';
import {createPixelPipeline} from '../../src/pipeline/render-pipeline';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {
  PART_ID_USER_DATA,
  TOON_MATERIAL_USER_DATA,
} from '../../src/pipeline/toon-material';
import {
  collectStageCorners,
  createUnionBounds,
} from '../../src/sampler/union-bounds';
import {createGpuHarness, currentBackend, toBase64} from './harness';
import type {GpuHarness} from './harness';

// The GPU projects serve `packages/engine` at the dev-server root.
const FIXTURES = `${location.origin}/test/fixtures/`;
const PACK = `${FIXTURES}pack/`;
const SPEC_URL = `${FIXTURES}character.valid.json`;
const CLIP = 'builtin:fixture-pack/fixture-clip';
const POSE_TIME_SEC = 0.25;
const SLOT_REGISTRY = {
  slots: V1_SLOT_IDS.map((id, order) => ({id, order})),
};

async function json(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** The fixture character on a stage, with toon materials on `binder`. */
interface FixtureStage {
  readonly scene: THREE.Scene;
  readonly stage: THREE.Group;
  readonly assembly: CharacterAssembly;
  dispose(): void;
}

async function loadFixture(
  binder: SettingsBinder,
  backend: 'webgpu' | 'webgl2',
): Promise<FixtureStage> {
  const registry = createAssetRegistry();
  registry.registerPack(
    partManifestSchema.parse(await json(`${PACK}manifest.json`)),
    PACK,
  );
  registry.registerClips(
    clipManifestSchema.parse(await json(`${PACK}clips.json`)),
    PACK,
  );
  const assembly = createCharacterAssembly({registry});
  const set = await assembly.setCharacter(
    characterSpecSchema.parse(await json(SPEC_URL)),
  );
  if (!set.ok) throw new Error(set.error.message);
  const clip = await assembly.setClip(CLIP);
  if (!clip.ok) throw new Error(clip.error.message);

  // Pixel-pipeline materials and part IDs (what M2-16's assembly will do).
  // Skinned clones follow their source via linkMaterial; static props are
  // plain scene clones (attach-static-part), so they are re-tinted in place.
  const options = {binder, backend, mode: 'export'} as const;
  for (const [slot, part] of assembly.parts) {
    const {entry} = part.part;
    applyTintMaterial(
      part.part,
      entry.tintSlots,
      assembly.tints,
      assembly.regionMask,
      options,
    );
    let unlinked = false;
    part.attached.object.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Mesh).isMesh === true && m !== undefined) {
        if (m.userData?.[TOON_MATERIAL_USER_DATA] === undefined)
          unlinked = true;
      }
    });
    if (unlinked) {
      applyTintMaterial(
        {...part.part, scene: part.attached.object as THREE.Group},
        entry.tintSlots,
        assembly.tints,
        assembly.regionMask,
        options,
      );
    }
    const id = partIdFor(slot, SLOT_REGISTRY);
    part.attached.object.traverse(o => {
      o.userData[PART_ID_USER_DATA] = id;
    });
  }
  const scene = new THREE.Scene();
  const stage = new THREE.Group();
  stage.add(assembly.root);
  scene.add(stage);
  assembly.evaluate(POSE_TIME_SEC);
  return {scene, stage, assembly, dispose: () => assembly.dispose()};
}

function settingsFor(
  preset: RenderSettings['camera']['preset'],
  palette: 'none' | 'pico-8',
): RenderSettings {
  const s = defaultRenderSettings(preset);
  return palette === 'none'
    ? s
    : {
        ...s,
        palette: {
          ...s.palette,
          id: 'pico-8',
          dither: {mode: 'bayer4', strength: 0.5},
        },
      };
}

/** Renders every direction of the preset into one horizontal strip. */
async function renderStrip(
  h: GpuHarness,
  f: FixtureStage,
  binder: SettingsBinder,
  settings: RenderSettings,
): Promise<{rgba: Uint8ClampedArray; width: number; height: number}> {
  const labels = directionLabels(settings.directions, settings.singleFacing);
  const union = createUnionBounds(computeFraming([], settings).elevationDeg);
  f.stage.rotation.y = 0;
  const corners = collectStageCorners(f.assembly.root, f.stage);
  labels.forEach((label, i) =>
    union.add('fixture', i, corners, stageYawRad(label)),
  );
  const framing = computeFraming(union.boxes(), settings);
  // Auto framing fits the extent below the pivot too (REQ-PIX-007 note,
  // FX-F); it clips only when pivotRowPx leaves no room past the outline
  // margin: reported, still rendered (REQ-PIX-009).
  if (framing.clipped.length > 0) {
    console.log(
      `[m2-14] ${settings.camera.preset}: PIX_FRAMING_CLIPPED ${framing.clipped.length} direction(s)`,
    );
  }

  const created = createPixelPipeline({
    renderer: h.renderer,
    scene: f.scene,
    binder,
  });
  if (!created.ok) throw new Error(created.error.message);
  const p = created.value;
  const {width: w, height: hh} = settings.resolution;
  const strip = new Uint8ClampedArray(w * labels.length * hh * 4);
  try {
    await p.setRenderSettings(settings);
    p.setFraming(framing);
    for (const [i, label] of labels.entries()) {
      f.stage.rotation.y = stageYawRad(label);
      p.render();
      const cell = await p.read();
      for (let y = 0; y < hh; y++) {
        strip.set(
          cell.subarray(y * w * 4, (y + 1) * w * 4),
          (y * w * labels.length + i * w) * 4,
        );
      }
    }
  } finally {
    p.dispose();
  }
  return {rgba: strip, width: w * labels.length, height: hh};
}

/** FNV-1a 32-bit over the bytes (log only). */
function fnv1a(bytes: Uint8ClampedArray): string {
  let hash = 0x811c9dc5;
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

describe(`fixture character through the pipeline (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let fixture: FixtureStage;
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

  it('uses toon materials and part IDs on every fixture mesh', () => {
    let meshes = 0;
    fixture.assembly.root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      meshes++;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of materials) {
        expect(m.userData[TOON_MATERIAL_USER_DATA]).toBe('toon');
      }
      expect(mesh.userData[PART_ID_USER_DATA]).toBeGreaterThanOrEqual(1);
    });
    expect(meshes).toBeGreaterThanOrEqual(3);
  });

  it('REQ-PIX-027, AC-PIX-010.1: 3 fresh pipelines render byte-identical frames (three-quarter, pico-8 + bayer4, 8 directions)', async () => {
    const settings = settingsFor('three-quarter', 'pico-8');
    const runs: Uint8ClampedArray[] = [];
    for (let run = 0; run < 3; run++) {
      runs.push((await renderStrip(h, fixture, binder, settings)).rgba);
    }
    const [a, b, c] = runs as [
      Uint8ClampedArray,
      Uint8ClampedArray,
      Uint8ClampedArray,
    ];
    let opaque = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i] === 255) opaque++;
    expect(opaque).toBeGreaterThan(200);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).toEqual(Array.from(a));
    console.log(`[m2-14] ${h.backend} determinism digest ${fnv1a(a)}`);
  });

  it('AC-PIX-002.2: default fixture with palette none has only alpha 0 or 255; review PNGs of the 3 presets at 64 px', async () => {
    for (const preset of ['side', 'three-quarter', 'isometric'] as const) {
      for (const palette of ['none', 'pico-8'] as const) {
        const strip = await renderStrip(
          h,
          fixture,
          binder,
          settingsFor(preset, palette),
        );
        if (palette === 'none') {
          for (let i = 3; i < strip.rgba.length; i += 4) {
            expect([0, 255]).toContain(strip.rgba[i]);
          }
        }
        const name = `fixture-${preset}-64${palette === 'none' ? '' : '-pico8'}`;
        await commands.csgSeedGolden(
          'test-results/m2-14',
          h.backend,
          name,
          toBase64(
            new Uint8Array(
              strip.rgba.buffer,
              strip.rgba.byteOffset,
              strip.rgba.byteLength,
            ),
          ),
          strip.width,
          strip.height,
        );
      }
    }
  });
});
