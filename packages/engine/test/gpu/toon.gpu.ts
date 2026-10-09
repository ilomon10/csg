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
import {toonBandIndex, toonBandLight} from '../../src/pipeline/stages/toon';
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
      rim: patch.rim ?? {enabled: false, strength: 0.5},
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

/** Authored sRGB texel used by the multiply tests (not gray, so luminance would differ). */
const TEXEL: readonly [number, number, number] = [255, 128, 64];

/** A 4×4 sRGB texture of one colour (mipmaps added by ensureMipmapped). */
function solidTexture(
  rgb: readonly [number, number, number],
  alpha = 255,
): THREE.DataTexture {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([rgb[0], rgb[1], rgb[2], alpha], i * 4);
  const t = new THREE.DataTexture(data, 4, 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const srgbToLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb8 = (l: number) =>
  Math.round(
    255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055),
  );

/** sRGB8 of `texel.rgb × tint` computed in linear (REQ-CMP-014 multiply). */
function multiplyExpected(
  texel: readonly number[],
  tintGray: number,
): [number, number, number] {
  const t = srgbToLinear(tintGray);
  return [0, 1, 2].map(k =>
    linearToSrgb8(srgbToLinear(texel[k] as number) * t),
  ) as [number, number, number];
}

/** Each channel within ±1 of the expectation (8-bit texture filtering/rounding). */
function expectNear(actual: readonly number[], expected: readonly number[]) {
  for (let k = 0; k < expected.length; k++)
    expect(
      Math.abs((actual[k] as number) - (expected[k] as number)),
    ).toBeLessThanOrEqual(1);
}

/** Every covered pixel is `rgb` (±1) and opaque; asserts enough coverage. */
function expectAllOpaque(srgb: Uint8ClampedArray, rgb: readonly number[]) {
  let covered = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (srgb[i * 4 + 3] !== 255) continue;
    covered++;
    expectNear(Array.from(srgb.subarray(i * 4, i * 4 + 3)), rgb);
  }
  expect(covered).toBeGreaterThan(1000);
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
      map?: THREE.Texture;
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
      Object.assign(new THREE.MeshStandardMaterial({map: opts.map ?? null}), {
        name: 'Skin',
      }),
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

  it('REQ-PIX-011 (FX-J): the material outputs base · light_k with no rim term even with rim on; partId.g holds light_k (scene.light), 1 for unlit', async () => {
    const s = settings({rim: {enabled: true, strength: 1}});
    const frame = await sphere(s, {linearBase: 0.2});
    const l = lightDirection(s.lighting);
    const thresholds = [1 / 3, 2 / 3];
    let checked = 0;
    for (const i of opaque(frame)) {
      const n: [number, number, number] = [
        frame.normalDepth[i * 4] as number,
        frame.normalDepth[i * 4 + 1] as number,
        frame.normalDepth[i * 4 + 2] as number,
      ];
      const len = Math.hypot(...n);
      const u: [number, number, number] = [n[0] / len, n[1] / len, n[2] / len];
      const lambda = Math.max(u[0] * l[0] + u[1] * l[1] + u[2] * l[2], 0);
      if (thresholds.some(t => Math.abs(lambda - t) < 0.01)) continue;
      const light = toonBandLight(
        toonBandIndex(lambda, thresholds, 3),
        3,
        0.15,
      );
      expect(
        Math.abs((frame.output[i * 4] as number) - 0.2 * light),
      ).toBeLessThan(2e-3);
      expect(
        Math.abs((frame.partId[i * 4 + 1] as number) - light),
      ).toBeLessThan(2e-3);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
    // Background: partId (and so scene.light) is 0.
    expect(frame.partId[1]).toBe(0);
    const unlit = await sphere(s, {linearBase: 0.2, lighting: 'unlit'});
    for (const i of opaque(unlit)) expect(unlit.partId[i * 4 + 1]).toBe(1);
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

  it(
    'AC-PIX-013.2: turning the character through 8 directions keeps the light fixed relative to the camera',
    {timeout: 180_000},
    async () => {
      const reference = centroid(opaque(await sphere(settings({}))));
      for (let d = 0; d < 8; d++) {
        const frame = await sphere(settings({}), {yawDeg: d * 45});
        const brightest = opaque(frame).filter(i => frame.srgb[i * 4] === 255);
        const [cx, cy] = centroid(brightest);
        expect(cx - reference[0]).toBeLessThan(-3);
        expect(cy - reference[1]).toBeLessThan(-3);
      }
    },
  );

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

  it('AC-CMP-014.1: multiply is texel.rgb × tint on the toon path (unlit, palette none): white texel × #808080 = #808080, (255,128,64) × #808080 = per-channel product', async () => {
    const white = solidTexture([255, 255, 255]);
    const colored = solidTexture(TEXEL);
    try {
      const w = await sphere(settings({}), {
        lighting: 'unlit',
        tint: '#808080',
        map: white,
      });
      expectAllOpaque(w.srgb, [128, 128, 128]);
      const c = await sphere(settings({}), {
        lighting: 'unlit',
        tint: '#808080',
        map: colored,
      });
      expectAllOpaque(c.srgb, multiplyExpected(TEXEL, 128));
      // White tint = the authored texel colours (default tints, PM 2026-10-09).
      const authored = await sphere(settings({}), {
        lighting: 'unlit',
        tint: '#ffffff',
        map: colored,
      });
      expectAllOpaque(authored.srgb, TEXEL);
    } finally {
      white.dispose();
      colored.dispose();
    }
  });

  it('AC-CMP-014.1: multiply is texel.rgb × tint on the unlit M1 material (no pipeline options)', async () => {
    const colored = solidTexture(TEXEL);
    const uniforms = createTintUniforms({...WHITE_TINTS, primary: '#808080'});
    const geometry = new THREE.PlaneGeometry(2, 2);
    const {part} = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial({map: colored}), {
        name: 'Cloth',
      }),
      1,
    );
    applyTintMaterial(
      part as never,
      [{material: 'Cloth', slot: 'primary'}],
      uniforms,
    );
    const scene = new THREE.Scene();
    scene.add(part.scene);
    try {
      const target = new THREE.RenderTarget(SIZE, SIZE, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
        samples: 0,
      });
      const r = h.renderer;
      try {
        r.setClearColor(0x000000, 0);
        r.setRenderTarget(target);
        r.render(scene, makeCamera(0));
        r.setRenderTarget(null);
        const raw = (await r.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          SIZE,
          SIZE,
        )) as Uint8Array;
        const rgba = normalizeReadback(
          raw,
          SIZE,
          SIZE,
          readbackLayout(h.backend, SIZE),
        );
        const c = idx(SIZE / 2, SIZE / 2) * 4;
        expect(rgba[c + 3]).toBe(255);
        expectNear(
          Array.from(rgba.subarray(c, c + 3)),
          multiplyExpected(TEXEL, 128),
        );
      } finally {
        target.dispose();
      }
    } finally {
      restoreMaterials(part.scene);
      geometry.dispose();
      colored.dispose();
    }
  });

  it('AC-PIX-023.2, AC-PIX-023.3: a 0.4-alpha card is discarded in the material at cutoff 0.5 (torso and its part ID show through) and drawn at 0.3', async () => {
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

  it('AC-CMP-014.3: multiply is linear per channel and keeps the texel alpha 0.4 (#ff8000 × #ffffff, #00ff00, #808080)', async () => {
    const tex = solidTexture([255, 128, 0], 102);
    try {
      const cases: Array<[HexColor, number[]]> = [
        ['#ffffff', [255, 128, 0]],
        ['#00ff00', [0, 128, 0]],
        // Linear product (0.216, 0.0466, 0): #803d00, not the sRGB-space #804000.
        ['#808080', [128, 61, 0]],
      ];
      for (const [tint, rgb] of cases) {
        const frame = await sphere(settings({alphaCutoff: 0.3}), {
          lighting: 'unlit',
          tint,
          map: tex,
        });
        let covered = 0;
        for (let i = 0; i < SIZE * SIZE; i++) {
          if (frame.partId[i * 4] !== 1) continue;
          covered++;
          expectNear(Array.from(frame.srgb.subarray(i * 4, i * 4 + 3)), rgb);
          // Covered pixels are opaque: the alpha 0.4 only feeds the cutoff.
          expect(frame.srgb[i * 4 + 3]).toBe(255);
        }
        expect(covered).toBeGreaterThan(1000);
      }
      // The texel alpha 0.4 survives the tint: a cutoff of 0.5 discards it.
      const cut = await sphere(settings({alphaCutoff: 0.5}), {
        lighting: 'unlit',
        tint: '#00ff00',
        map: tex,
      });
      expect(opaque(cut)).toEqual([]);
    } finally {
      tex.dispose();
    }
  });

  it('AC-PIX-023.4: a replace-tint card keeps the texel alpha: only the opaque half is covered and shows #ff0000', async () => {
    // 4 × 4 texture: the left two columns alpha 0, the right two alpha 255.
    const data = new Uint8Array(4 * 4 * 4);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        data.set([40, 200, 40, x < 2 ? 0 : 255], (y * 4 + x) * 4);
    const tex = new THREE.DataTexture(data, 4, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const binder = new SettingsBinder(settings({alphaCutoff: 0.5}));
    const uniforms = createTintUniforms({...WHITE_TINTS, hair: '#ff0000'});
    const geometry = new THREE.PlaneGeometry(2, 2);
    const {part} = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial({map: tex}), {name: 'Hair'}),
      1,
    );
    applyTintMaterial(
      part as never,
      [{material: 'Hair', slot: 'hair', mode: 'replace'}],
      uniforms,
      undefined,
      {binder, backend: h.backend, mode: 'export', lighting: 'unlit'},
    );
    const scene = new THREE.Scene();
    scene.add(part.scene);
    const p = new MiniPipeline(h, scene, makeCamera(0));
    try {
      const f = await p.render();
      // The card spans px 4..43; the texel boundary is at x = 24. Stay off the
      // filtered seam (mipmapped sampler) by 4 px.
      for (let y = 10; y < 38; y++) {
        for (const x of [6, 12, 18, 20]) {
          expect(
            Array.from(f.srgb.subarray(idx(x, y) * 4, idx(x, y) * 4 + 4)),
          ).toEqual([0, 0, 0, 0]);
        }
        for (const x of [28, 32, 38, 42]) {
          expect(
            Array.from(f.srgb.subarray(idx(x, y) * 4, idx(x, y) * 4 + 4)),
          ).toEqual([255, 0, 0, 255]);
        }
      }
    } finally {
      p.dispose();
      restoreMaterials(part.scene);
      geometry.dispose();
      tex.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-023.5: an opaque material with alphaCutoff 1 keeps alpha exactly 1 on every covered pixel, and every one is covered in the output', async () => {
    const frame = await sphere(settings({alphaCutoff: 1}));
    let covered = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (frame.partId[i * 4] !== 1) continue;
      covered++;
      expect(frame.output[i * 4 + 3]).toBe(1);
      expect(frame.srgb[i * 4 + 3]).toBe(255);
    }
    expect(covered).toBeGreaterThan(1000);
  });

  it('AC-PIX-023.6: texel alpha only drives the cutoff: multiply #00ff00 over #ff8000 at alpha 0.4 is opaque (scene alpha 1) with cutoff 0.3 and fully transparent with cutoff 0.5', async () => {
    const tex = solidTexture([255, 128, 0], 102);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const card = async (alphaCutoff: number): Promise<Frame> => {
      const s = settings({alphaCutoff});
      const binder = new SettingsBinder(s);
      const uniforms = createTintUniforms({...WHITE_TINTS, primary: '#00ff00'});
      const {part} = tintedMesh(
        geometry,
        Object.assign(new THREE.MeshStandardMaterial({map: tex}), {
          name: 'Skin',
        }),
        1,
      );
      applyTintMaterial(
        part as never,
        [{material: 'Skin', slot: 'primary', mode: 'multiply'}],
        uniforms,
        undefined,
        {binder, backend: h.backend, mode: 'export'},
      );
      const scene = new THREE.Scene();
      scene.add(part.scene);
      const p = new MiniPipeline(h, scene, makeCamera(0));
      try {
        return await p.render();
      } finally {
        p.dispose();
        restoreMaterials(part.scene);
        binder.dispose();
      }
    };
    try {
      const s = settings({alphaCutoff: 0.3});
      const l = lightDirection(s.lighting);
      const frame = await card(0.3);
      await evidence(h, 'card-multiply-alpha-0.4-cutoff-0.3', frame);
      // AC-CMP-014.3 product in linear: (0, srgbToLinear(128), 0) = (0, 0.216, 0).
      const g = srgbToLinear(128);
      let covered = 0;
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (frame.partId[i * 4] !== 1) continue;
        covered++;
        const n = [0, 1, 2].map(k => frame.normalDepth[i * 4 + k] as number);
        const len = Math.hypot(n[0]!, n[1]!, n[2]!);
        const lambda = Math.max(
          (n[0]! * l[0] + n[1]! * l[1] + n[2]! * l[2]) / len,
          0,
        );
        const lightK = toonBandLight(
          toonBandIndex(lambda, [1 / 3, 2 / 3], 3),
          3,
          0.15,
        );
        // Scene alpha exactly 1.0 and output alpha 255: the 0.4 never leaks.
        expect(frame.output[i * 4 + 3]).toBe(1);
        expect(frame.srgb[i * 4 + 3]).toBe(255);
        const rgb = [0, 1, 2].map(k => srgbToLinear(frame.srgb[i * 4 + k]!));
        const expected = [0, g * lightK, 0];
        for (let k = 0; k < 3; k++)
          expect(Math.abs(rgb[k]! - expected[k]!)).toBeLessThanOrEqual(1 / 255);
      }
      // The card spans 40 x 40 px of the 48 px cell.
      expect(covered).toBeGreaterThan(1000);

      const cut = await card(0.5);
      await evidence(h, 'card-multiply-alpha-0.4-cutoff-0.5', cut);
      // Every pixel, the card's included, is RGBA (0, 0, 0, 0) and no part ID.
      for (let i = 0; i < SIZE * SIZE; i++) {
        expect(Array.from(cut.srgb.subarray(i * 4, i * 4 + 4))).toEqual([
          0, 0, 0, 0,
        ]);
        expect(cut.partId[i * 4]).toBe(0);
      }
    } finally {
      geometry.dispose();
      tex.dispose();
    }
  });

  it('AC-PIX-014.3: with s = 0.03125 quads 0.25 and -0.125 world units from the pivot plane read depth 8.0 and -4.0 px', async () => {
    const binder = new SettingsBinder(settings({}));
    const uniforms = createTintUniforms(WHITE_TINTS);
    const opts: TintMaterialOptions = {
      binder,
      backend: h.backend,
      mode: 'export',
      lighting: 'unlit',
    };
    const geometry = new THREE.PlaneGeometry(1, 1);
    const near = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial(), {name: 'Skin'}),
      1,
    );
    near.mesh.position.set(-0.6, 0, 0.25);
    const far = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial(), {name: 'Skin'}),
      2,
    );
    far.mesh.position.set(0.6, 0, -0.125);
    for (const q of [near, far])
      applyTintMaterial(
        q.part as never,
        [{material: 'Skin', slot: 'primary', mode: 'multiply'}],
        uniforms,
        undefined,
        opts,
      );
    const scene = new THREE.Scene();
    scene.add(near.part.scene, far.part.scene);
    const p = new MiniPipeline(h, scene, makeCamera(0));
    setSceneDepth(p.depth, CAMERA_DISTANCE, 0.03125);
    try {
      const f = await p.render();
      // Quads cover x 12..35 around the centre column pair at 0.05 world/px.
      const a = f.normalDepth[idx(14, 24) * 4 + 3] as number;
      const b = f.normalDepth[idx(34, 24) * 4 + 3] as number;
      expect(f.partId[idx(14, 24) * 4]).toBe(1);
      expect(f.partId[idx(34, 24) * 4]).toBe(2);
      expect(Math.abs(a - 8)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(b + 4)).toBeLessThanOrEqual(0.05);
    } finally {
      p.dispose();
      restoreMaterials(near.part.scene);
      restoreMaterials(far.part.scene);
      geometry.dispose();
      binder.dispose();
    }
  });

  it('AC-PIX-038.2: a 512 x 512 one-texel checkerboard on a quad covering 16 x 16 px shows interior grays within 8 of each other', async () => {
    const n = 512;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        data.set(
          (x + y) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255],
          (y * n + x) * 4,
        );
    const tex = new THREE.DataTexture(data, n, n);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const binder = new SettingsBinder(settings({}));
    const uniforms = createTintUniforms(WHITE_TINTS);
    const geometry = new THREE.PlaneGeometry(
      16 * WORLD_PER_PX,
      16 * WORLD_PER_PX,
    );
    const {part} = tintedMesh(
      geometry,
      Object.assign(new THREE.MeshStandardMaterial({map: tex}), {name: 'Skin'}),
      1,
    );
    applyTintMaterial(
      part as never,
      [{material: 'Skin', slot: 'primary', mode: 'multiply'}],
      uniforms,
      undefined,
      {binder, backend: h.backend, mode: 'export', lighting: 'unlit'},
    );
    const scene = new THREE.Scene();
    scene.add(part.scene);
    const p = new MiniPipeline(h, scene, makeCamera(0));
    try {
      const f = await p.render();
      // The quad covers px 16..31 (centred); skip the outermost ring.
      const grays: number[] = [];
      for (let y = 17; y <= 30; y++)
        for (let x = 17; x <= 30; x++) {
          expect(f.srgb[idx(x, y) * 4 + 3]).toBe(255);
          grays.push(f.srgb[idx(x, y) * 4] as number);
        }
      expect(Math.max(...grays) - Math.min(...grays)).toBeLessThanOrEqual(8);
    } finally {
      p.dispose();
      restoreMaterials(part.scene);
      geometry.dispose();
      tex.dispose();
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
