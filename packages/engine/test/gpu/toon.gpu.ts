/**
 * GPU tests of the toon material, the scene MRT and the tint-material
 * integration (M2-11), on both backends. Pixel asserts only (no committed
 * goldens, PM decision D2). Run with `pnpm test:gpu` / `pnpm test:gpu:docker`.
 *
 * The post chain of the real pipeline (M2-12/13/14) is stood in for by one
 * `RenderPipeline` that applies `sRGBTransferOETF` to the `output` attachment
 * and writes an RGBA8 target, which is the explicit sRGB conversion of
 * REQ-PIX-024. Outlines are not part of these images.
 */
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import {pass, sRGBTransferOETF, vec4} from 'three/tsl';
import {
  BODY_REGIONS,
  TINT_SLOTS,
  defaultRenderSettings,
} from '@csg/parts-schema';
import type {HexColor, RenderSettings, TintSlot} from '@csg/parts-schema';
import {
  createRegionMask,
  setRegionMask,
} from '../../src/composition/region-mask';
import {
  applyTintMaterial,
  createTintUniforms,
  restoreMaterials,
} from '../../src/composition/tint-material';
import type {TintMaterialOptions} from '../../src/composition/tint-material';
import {normalizeReadback} from '../../src/pipeline/readback';
import {
  SettingsBinder,
  lightDirection,
} from '../../src/pipeline/settings-binder';
import {
  toonBandIndex,
  toonBandLight,
  toonColor,
  toonRimValue,
} from '../../src/pipeline/stages/toon';
import {
  PART_ID_USER_DATA,
  createSceneDepthUniforms,
  createSceneMrt,
  setSceneDepth,
} from '../../src/pipeline/toon-material';
import type {SceneDepthUniforms} from '../../src/pipeline/toon-material';
import {
  createGpuHarness,
  currentBackend,
  readbackLayout,
  toBase64,
} from './harness';
import type {GpuHarness} from './harness';

const SIZE = 48;
const RADIUS = 1;
const HALF_EXTENT = 1.2;
const WORLD_PER_PX = (2 * HALF_EXTENT) / SIZE;
const CAMERA_DISTANCE = 10;

const WHITE_TINTS = Object.fromEntries(
  TINT_SLOTS.map(slot => [slot, '#ffffff']),
) as Record<TintSlot, HexColor>;

/** Decodes one IEEE 754 half float. */
function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/** One rendered frame: sRGB8 output plus the three MRT attachments as floats. */
interface Frame {
  readonly srgb: Uint8ClampedArray;
  readonly output: Float32Array;
  readonly normalDepth: Float32Array;
  readonly partId: Float32Array;
}

/** Scene-pass + sRGB stand-in, reusing its targets across renders. */
class MiniPipeline {
  readonly depth: SceneDepthUniforms = createSceneDepthUniforms();
  private readonly passNode: ReturnType<typeof pass>;
  private readonly pipeline: THREE.RenderPipeline;
  private readonly target: THREE.RenderTarget;

  constructor(
    private readonly h: GpuHarness,
    readonly scene: THREE.Scene,
    readonly camera: THREE.OrthographicCamera,
  ) {
    this.passNode = pass(scene, camera, {
      samples: 0,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
    });
    this.passNode.setMRT(createSceneMrt(this.depth));
    const out = this.passNode.getTextureNode('output');
    this.passNode.getTexture('normalDepth');
    this.passNode.getTexture('partId');
    this.pipeline = new THREE.RenderPipeline(
      h.renderer,
      vec4(sRGBTransferOETF(out.rgb) as THREE.Node<'vec3'>, out.a),
    );
    this.pipeline.outputColorTransform = false;
    this.target = new THREE.RenderTarget(SIZE, SIZE, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: false,
      samples: 0,
    });
    setSceneDepth(this.depth, CAMERA_DISTANCE, WORLD_PER_PX);
  }

  private async readHalf(name: string): Promise<Float32Array> {
    const rt = this.passNode.renderTarget;
    const index = rt.textures.findIndex(t => t.name === name);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(rt.textures[index]?.type).toBe(THREE.HalfFloatType);
    const raw = (await this.h.renderer.readRenderTargetPixelsAsync(
      rt,
      0,
      0,
      SIZE,
      SIZE,
      index,
    )) as Uint16Array;
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    // 8 bytes per texel = two "RGBA8" texels for the shared normalizer.
    const layout =
      this.h.backend === 'webgpu'
        ? {rowStrideBytes: Math.ceil((SIZE * 8) / 256) * 256, bottomUp: false}
        : {rowStrideBytes: SIZE * 8, bottomUp: true};
    const tight = normalizeReadback(bytes, SIZE * 2, SIZE, layout);
    const halves = new Uint16Array(
      tight.buffer,
      tight.byteOffset,
      tight.byteLength / 2,
    );
    return Float32Array.from(halves, halfToFloat);
  }

  async render(): Promise<Frame> {
    const r = this.h.renderer;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.target);
    this.pipeline.render();
    r.setRenderTarget(null);
    const raw = (await r.readRenderTargetPixelsAsync(
      this.target,
      0,
      0,
      SIZE,
      SIZE,
    )) as Uint8Array;
    const srgb = normalizeReadback(
      raw,
      SIZE,
      SIZE,
      readbackLayout(this.h.backend, SIZE),
    );
    return {
      srgb,
      output: await this.readHalf('output'),
      normalDepth: await this.readHalf('normalDepth'),
      partId: await this.readHalf('partId'),
    };
  }

  dispose(): void {
    this.pipeline.dispose();
    this.passNode.dispose();
    this.target.dispose();
  }
}

/** Orthographic camera from +Z raised by `elevationDeg` about X (union-bounds convention). */
function makeCamera(elevationDeg: number): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(
    -HALF_EXTENT,
    HALF_EXTENT,
    HALF_EXTENT,
    -HALF_EXTENT,
    0.1,
    100,
  );
  const e = (elevationDeg * Math.PI) / 180;
  cam.position.set(
    0,
    CAMERA_DISTANCE * Math.sin(e),
    CAMERA_DISTANCE * Math.cos(e),
  );
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

function settings(patch: {
  bands?: 2 | 3 | 4;
  ambient?: number;
  rim?: RenderSettings['toon']['rim'];
  alphaCutoff?: number;
}): RenderSettings {
  const s = defaultRenderSettings();
  return {
    ...s,
    resolution: {width: SIZE, height: SIZE},
    lighting: {
      azimuthDeg: 135,
      elevationDeg: 45,
      ambient: patch.ambient ?? 0.15,
    },
    toon: {
      bands: patch.bands ?? 3,
      rim: patch.rim ?? {enabled: false, strength: 0.5, width: 0.2},
    },
    palette: {...s.palette, id: 'none'},
    alphaCutoff: patch.alphaCutoff ?? 0.5,
  };
}

/** A one-mesh "part" with a tint mapping on its only material. */
function tintedMesh(
  geometry: THREE.BufferGeometry,
  source: THREE.Material,
  partId: number,
): {part: {scene: THREE.Group}; mesh: THREE.Mesh} {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, source);
  mesh.userData[PART_ID_USER_DATA] = partId;
  scene.add(mesh);
  return {part: {scene}, mesh};
}

const idx = (x: number, y: number) => y * SIZE + x;

/** Writes the sRGB frame as review evidence to `test-results/m2-11/<backend>/<name>.png` (not a golden). */
async function evidence(h: GpuHarness, name: string, frame: Frame) {
  await commands.csgSeedGolden(
    'test-results/m2-11',
    h.backend,
    name,
    toBase64(
      new Uint8Array(
        frame.srgb.buffer,
        frame.srgb.byteOffset,
        frame.srgb.byteLength,
      ),
    ),
    SIZE,
    SIZE,
  );
}

function opaque(frame: Frame): number[] {
  const out: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (frame.srgb[i * 4 + 3] === 255) out.push(i);
  }
  return out;
}

/** Centroid (top-left pixel coords) of the given pixel indices. */
function centroid(pixels: readonly number[]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const i of pixels) {
    sx += i % SIZE;
    sy += Math.floor(i / SIZE);
  }
  return [sx / pixels.length, sy / pixels.length];
}

describe(`toon material + scene MRT (${currentBackend()})`, () => {
  let h: GpuHarness;
  beforeAll(async () => {
    h = await createGpuHarness(SIZE, SIZE);
  });
  afterAll(() => h.dispose());

  /** Renders a tinted sphere under `s`; returns the frame and a cleanup. */
  async function sphere(
    s: RenderSettings,
    opts: {
      linearBase?: number;
      elevationDeg?: number;
      yawDeg?: number;
      lighting?: TintMaterialOptions['lighting'];
      tint?: HexColor;
    } = {},
  ): Promise<Frame> {
    const binder = new SettingsBinder(s);
    const uniforms = createTintUniforms({
      ...WHITE_TINTS,
      primary: opts.tint ?? '#ffffff',
    });
    if (opts.linearBase !== undefined) {
      const b = opts.linearBase;
      (uniforms.primary.value as THREE.Color).setRGB(b, b, b);
    }
    const geometry = new THREE.SphereGeometry(RADIUS, 96, 48);
    const {part, mesh} = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial(), {name: 'Skin'}),
      1,
    );
    mesh.rotation.y = ((opts.yawDeg ?? 0) * Math.PI) / 180;
    applyTintMaterial(
      part as never,
      [{material: 'Skin', slot: 'primary', mode: 'multiply'}],
      uniforms,
      undefined,
      {binder, backend: h.backend, mode: 'export', lighting: opts.lighting},
    );
    const scene = new THREE.Scene();
    scene.add(part.scene);
    const p = new MiniPipeline(h, scene, makeCamera(opts.elevationDeg ?? 0));
    try {
      return await p.render();
    } finally {
      p.dispose();
      restoreMaterials(part.scene);
      geometry.dispose();
      binder.dispose();
    }
  }

  it('AC-PIX-011.1/011.3: white sphere, 3 default bands, ambient 0.15, rim off → exactly the grays 108, 200, 255; deterministic', async () => {
    const s = settings({});
    const frame = await sphere(s);
    await evidence(h, 'sphere-3-bands', frame);
    const px = opaque(frame);
    expect(px.length).toBeGreaterThan(1000);
    const values = new Set<number>();
    for (const i of px) {
      const [r, g, b] = [
        frame.srgb[i * 4],
        frame.srgb[i * 4 + 1],
        frame.srgb[i * 4 + 2],
      ];
      expect(r).toBe(g);
      expect(g).toBe(b);
      values.add(r as number);
    }
    expect([...values].sort((a, b) => a - b)).toEqual([108, 200, 255]);
    // Linear output attachment holds the band values (fp16).
    for (const i of px) {
      const v = frame.output[i * 4] as number;
      const near = [0.15, 0.575, 1].some(t => Math.abs(v - t) < 1e-3);
      expect(near).toBe(true);
    }
    // Background: all attachments cleared to 0.
    expect(Array.from(frame.srgb.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(frame.partId[0]).toBe(0);
    const again = await sphere(s);
    expect(again.srgb).toEqual(frame.srgb);
  });

  it('AC-PIX-012.2 / REQ-PIX-011: every opaque pixel equals clamp(0.2 · light_k + rim) computed from its read-back normal', async () => {
    const rim = {enabled: true, strength: 0.35, width: 0.25};
    const s = settings({rim});
    const frame = await sphere(s, {linearBase: 0.2});
    const l = lightDirection(s.lighting);
    const thresholds = [1 / 3, 2 / 3];
    let checked = 0;
    let rimPixels = 0;
    for (const i of opaque(frame)) {
      const n: [number, number, number] = [
        frame.normalDepth[i * 4] as number,
        frame.normalDepth[i * 4 + 1] as number,
        frame.normalDepth[i * 4 + 2] as number,
      ];
      const len = Math.hypot(...n);
      const u: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const nl = u[0] * l[0] + u[1] * l[1] + u[2] * l[2];
      const lambda = Math.max(nl, 0);
      const nearBoundary =
        Math.abs(nl) < 0.01 ||
        thresholds.some(t => Math.abs(lambda - t) < 0.01) ||
        Math.abs(u[2] - rim.width) < 0.01;
      if (nearBoundary) continue;
      const k = toonBandIndex(lambda, thresholds, 3);
      const r = toonRimValue(u, l, rim.width, rim.strength);
      if (r > 0) rimPixels++;
      const expected = toonColor(0.2, toonBandLight(k, 3, 0.15), r);
      expect(Math.abs((frame.output[i * 4] as number) - expected)).toBeLessThan(
        2e-3,
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(rimPixels).toBeGreaterThan(10);
  });

  it('AC-PIX-012.1: rim strength 1, width 0.2 brightens a band on the lit edge only; strength 0 adds no rim pixels', async () => {
    const off = await sphere(settings({}), {linearBase: 0.2});
    const on = await sphere(
      settings({rim: {enabled: true, strength: 1, width: 0.2}}),
      {linearBase: 0.2},
    );
    const zero = await sphere(
      settings({rim: {enabled: true, strength: 0, width: 0.2}}),
      {linearBase: 0.2},
    );
    await evidence(h, 'sphere-rim-on', on);
    expect(zero.srgb).toEqual(off.srgb);
    const brighter: number[] = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const a = off.srgb[i * 4] as number;
      const b = on.srgb[i * 4] as number;
      expect(b).toBeGreaterThanOrEqual(a);
      if (b > a) brighter.push(i);
    }
    expect(brighter.length).toBeGreaterThan(10);
    const [cx, cy] = centroid(brighter);
    // Upper-left of the sphere center (light from azimuth 135°).
    expect(cx).toBeLessThan(SIZE / 2 - 3);
    expect(cy).toBeLessThan(SIZE / 2 - 3);
    for (const i of brighter) {
      // Rim pixels are on the silhouette band: N.z <= width (+ fp16 slack).
      expect(on.normalDepth[i * 4 + 2] as number).toBeLessThan(0.2 + 0.02);
    }
  });

  it('AC-PIX-013.1: side (0°) and isometric (30°) cameras light the sphere from the same screen direction (upper-left)', async () => {
    const angles: number[] = [];
    for (const elevationDeg of [0, 30]) {
      const frame = await sphere(settings({}), {elevationDeg});
      await evidence(h, `sphere-elevation-${elevationDeg}`, frame);
      const brightest = opaque(frame).filter(i => frame.srgb[i * 4] === 255);
      expect(brightest.length).toBeGreaterThan(20);
      const [cx, cy] = centroid(brightest);
      const dx = cx - SIZE / 2;
      const dy = SIZE / 2 - cy; // screen-up positive
      expect(dx).toBeLessThan(0);
      expect(dy).toBeGreaterThan(0);
      angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
    }
    for (const a of angles) expect(Math.abs(a - 135)).toBeLessThan(10);
    expect(
      Math.abs((angles[0] as number) - (angles[1] as number)),
    ).toBeLessThan(5);
  });

  it('AC-PIX-013.2: turning the character through 8 directions keeps the light fixed relative to the camera', async () => {
    const reference = centroid(opaque(await sphere(settings({}))));
    for (let d = 0; d < 8; d++) {
      const frame = await sphere(settings({}), {yawDeg: d * 45});
      const brightest = opaque(frame).filter(i => frame.srgb[i * 4] === 255);
      const [cx, cy] = centroid(brightest);
      expect(cx - reference[0]).toBeLessThan(-3);
      expect(cy - reference[1]).toBeLessThan(-3);
    }
  });

  it('REQ-PIX-014: normalDepth holds the view normal and the depth in output px from the pivot plane', async () => {
    const frame = await sphere(settings({}));
    const c = idx(SIZE / 2, SIZE / 2);
    const nz = frame.normalDepth[c * 4 + 2] as number;
    expect(nz).toBeGreaterThan(0.99);
    // Sphere front at +RADIUS toward the camera → RADIUS / worldPerPx px.
    expect(frame.normalDepth[c * 4 + 3] as number).toBeCloseTo(
      RADIUS / WORLD_PER_PX,
      0,
    );
    expect(frame.partId[c * 4]).toBe(1);
  });

  it('AC-PIX-024.1: tint #808080 on an unlit material, palette none → (128, 128, 128) ± 0', async () => {
    const frame = await sphere(settings({}), {
      lighting: 'unlit',
      tint: '#808080',
    });
    const px = opaque(frame);
    expect(px.length).toBeGreaterThan(1000);
    for (const i of px) {
      expect(Array.from(frame.srgb.subarray(i * 4, i * 4 + 4))).toEqual([
        128, 128, 128, 255,
      ]);
    }
  });

  it('AC-PIX-023.2/023.3: a 0.4-alpha card is discarded in the material at cutoff 0.5 (torso and its part ID show through) and drawn at 0.3', async () => {
    const binder = new SettingsBinder(settings({alphaCutoff: 0.5}));
    const uniforms = createTintUniforms({...WHITE_TINTS, hair: '#ff0000'});
    const opts: TintMaterialOptions = {
      binder,
      backend: h.backend,
      mode: 'export',
      lighting: 'unlit',
    };
    // Torso: left half of the frame, part ID 2. Card: centered, in front, part ID 5.
    const torsoGeo = new THREE.PlaneGeometry(1.2, 2);
    const torso = tintedMesh(
      torsoGeo,
      Object.assign(new THREE.MeshStandardMaterial(), {name: 'Body'}),
      2,
    );
    torso.mesh.position.set(-0.6, 0, 0);
    const cardGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const card = tintedMesh(
      cardGeo,
      Object.assign(
        new THREE.MeshStandardMaterial({transparent: true, opacity: 0.4}),
        {name: 'Hair'},
      ),
      5,
    );
    card.mesh.position.set(0, 0, 0.5);
    applyTintMaterial(torso.part as never, [], uniforms, undefined, opts);
    applyTintMaterial(
      card.part as never,
      [{material: 'Hair', slot: 'hair', mode: 'replace'}],
      uniforms,
      undefined,
      opts,
    );
    const withCard = new THREE.Scene();
    withCard.add(torso.part.scene, card.part.scene);
    const p = new MiniPipeline(h, withCard, makeCamera(0));
    const without = new THREE.Scene();
    const pWithout = new MiniPipeline(h, without, makeCamera(0));
    try {
      // Card covers px 12..35; torso covers x < 24.
      const overTorso = idx(18, 24);
      const overBg = idx(30, 24);
      const cut = await p.render();
      await evidence(h, 'card-cutoff-0.5', cut);
      expect(cut.partId[overTorso * 4]).toBe(2);
      expect(cut.partId[overBg * 4]).toBe(0);
      expect(Array.from(cut.srgb.subarray(overBg * 4, overBg * 4 + 4))).toEqual(
        [0, 0, 0, 0],
      );
      without.add(torso.part.scene);
      const ref = await pWithout.render();
      expect(cut.srgb).toEqual(ref.srgb);
      expect(cut.partId).toEqual(ref.partId);
      withCard.add(torso.part.scene);

      binder.apply(settings({alphaCutoff: 0.3}));
      const drawn = await p.render();
      await evidence(h, 'card-cutoff-0.3', drawn);
      expect(drawn.partId[overTorso * 4]).toBe(5);
      expect(drawn.partId[overBg * 4]).toBe(5);
      expect(
        Array.from(drawn.srgb.subarray(overBg * 4, overBg * 4 + 4)),
      ).toEqual([255, 0, 0, 255]);
    } finally {
      p.dispose();
      pWithout.dispose();
      restoreMaterials(torso.part.scene);
      restoreMaterials(card.part.scene);
      torsoGeo.dispose();
      cardGeo.dispose();
      binder.dispose();
    }
  });

  it('AC-CMP-011.1/011.2: hidden body regions are not drawn in color or in the part-ID output, and come back when unhidden', async () => {
    const torsoIndex = BODY_REGIONS.indexOf('torso');
    const legIndex = BODY_REGIONS.indexOf('upper-legs');
    // Two quads, non-indexed: left = torso, right = upper-legs (constant per triangle).
    const left = new THREE.PlaneGeometry(1, 2).toNonIndexed();
    left.translate(-0.5, 0, 0);
    const right = new THREE.PlaneGeometry(1, 2).toNonIndexed();
    right.translate(0.5, 0, 0);
    const positions = new Float32Array([
      ...(left.getAttribute('position').array as Float32Array),
      ...(right.getAttribute('position').array as Float32Array),
    ]);
    const normals = new Float32Array([
      ...(left.getAttribute('normal').array as Float32Array),
      ...(right.getAttribute('normal').array as Float32Array),
    ]);
    const regions = new Float32Array(12);
    regions.fill(torsoIndex, 0, 6);
    regions.fill(legIndex, 6, 12);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('regionId', new THREE.BufferAttribute(regions, 1));
    left.dispose();
    right.dispose();

    const binder = new SettingsBinder(settings({}));
    const uniforms = createTintUniforms(WHITE_TINTS);
    const mask = createRegionMask();
    const body = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial(), {name: 'Body'}),
      1,
    );
    applyTintMaterial(
      body.part as never,
      [{material: 'Body', slot: 'skin'}],
      uniforms,
      mask,
      {binder, backend: h.backend, mode: 'export', lighting: 'unlit'},
    );
    const scene = new THREE.Scene();
    scene.add(body.part.scene);
    const p = new MiniPipeline(h, scene, makeCamera(0));
    try {
      const torsoPx = idx(14, 24);
      const legPx = idx(34, 24);
      setRegionMask(mask, ['torso', 'upper-arms']);
      const hidden = await p.render();
      await evidence(h, 'body-torso-hidden', hidden);
      expect(hidden.partId[torsoPx * 4]).toBe(0);
      expect(hidden.srgb[torsoPx * 4 + 3]).toBe(0);
      expect(hidden.partId[legPx * 4]).toBe(1);
      expect(hidden.srgb[legPx * 4 + 3]).toBe(255);
      setRegionMask(mask, []);
      const shown = await p.render();
      expect(shown.partId[torsoPx * 4]).toBe(1);
      expect(shown.srgb[torsoPx * 4 + 3]).toBe(255);
    } finally {
      p.dispose();
      restoreMaterials(body.part.scene);
      geometry.dispose();
      binder.dispose();
    }
  });
});
