/**
 * FX-I diagnosis (kept as the FX-J regression report): stray light pixels on the silhouette and inner seams of the
 * real default Quaternius character. Renders the look-review export
 * (three-quarter, 64 px, 8 directions idle + 4 walk frames) under toggles of
 * every candidate cause and counts light pixels on the character.
 *
 * Light pixel: covered (alpha > 0), sRGB luminance > 0.6, and not skin-like
 * (chroma `max − min` < 0.25), so lit faces and hands do not count
 * (`isLightPixel`, AC-PIX-012.8). Since FX-J the rim is the screen-space
 * edge stage, so `rimWidth` variants and the FX-I CPU mock-ups are gone.
 * Since FX-K (white default tints, `multiply` = texel × tint) the report also
 * splits out `isolatedSilhouette`; since FX-M the gate is AC-PIX-012.8's
 * 0 isolated rim-made light pixels (`rimMadeStats`, baseline vs rim-off).
 */
import {DEFAULT_CHARACTER_DATA, defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three/webgpu';
import type {RenderedFrame} from '../../src/contracts/pipeline';
import {SettingsBinder} from '../../src/pipeline/settings-binder';
import {createGpuHarness, currentBackend, toBase64} from './harness';
import type {GpuHarness} from './harness';
import {
  lightStats,
  loadDefaultCharacter,
  rimMadeStats,
  runExport,
} from './real-character';
import type {RealStage} from './real-character';

const CELL = 64;

type Sampling = 'mipmap' | 'linear' | 'nearest';

interface Variant {
  readonly name: string;
  readonly rim?: boolean;
  readonly outline?: boolean;
  readonly pico8?: boolean;
  readonly sampling?: Sampling;
  readonly alphaCutoff?: number;
  readonly rimStrength?: number;
}

const VARIANTS: readonly Variant[] = [
  {name: 'baseline'},
  {name: 'rim-off', rim: false},
  {name: 'outline-off', outline: false},
  {name: 'sampling-linear-no-mip', sampling: 'linear'},
  {name: 'sampling-nearest', sampling: 'nearest'},
  {name: 'alpha-cutoff-0.99', alphaCutoff: 0.99},
  {name: 'rim-off+outline-off', rim: false, outline: false},
  {name: 'rim-off+nearest', rim: false, sampling: 'nearest'},
  {name: 'rim-strength-0.15', rimStrength: 0.15},
  {name: 'rim-strength-1', rimStrength: 1},
  {name: 'pico8-baseline', pico8: true},
  {name: 'pico8-rim-off', pico8: true, rim: false},
];

/** Variants whose strips are written to `test-results/fx-i/<backend>/`. */
const STRIP_VARIANTS = new Set([
  'baseline',
  'rim-off',
  'rim-strength-1',
  'pico8-baseline',
  'pico8-rim-off',
]);

function settingsOf(v: Variant): RenderSettings {
  const s = defaultRenderSettings('three-quarter');
  const [idle, walk] = DEFAULT_CHARACTER_DATA.clips as [string, string];
  return {
    ...s,
    resolution: {width: CELL, height: CELL},
    directions: 8,
    toon: {
      ...s.toon,
      rim: {
        enabled: v.rim ?? s.toon.rim.enabled,
        strength: v.rimStrength ?? s.toon.rim.strength,
      },
    },
    outline: {
      ...s.outline,
      outer: {...s.outline.outer, enabled: v.outline ?? true},
      inner: {...s.outline.inner, enabled: v.outline ?? true},
    },
    palette:
      v.pico8 === true
        ? {...s.palette, id: 'pico-8', dither: {mode: 'bayer4', strength: 0.5}}
        : s.palette,
    alphaCutoff: v.alphaCutoff ?? s.alphaCutoff,
    animations: [
      {clipId: idle, label: 'idle', frameCount: 1, fps: 8, loop: true},
      {clipId: walk, label: 'walk', frameCount: 4, fps: 8, loop: true},
    ],
  } as RenderSettings;
}

/** Every texture referenced by the node materials of the character. */
function characterTextures(root: THREE.Object3D): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const m of materials) {
      const node = (m as THREE.MeshBasicNodeMaterial).colorNode;
      node?.traverse((n: THREE.Node) => {
        const value = (n as unknown as {value?: THREE.Texture}).value;
        if (value?.isTexture === true) out.add(value);
      });
    }
  });
  return [...out];
}

function setSampling(textures: readonly THREE.Texture[], s: Sampling): void {
  for (const t of textures) {
    t.minFilter =
      s === 'mipmap'
        ? THREE.LinearMipmapLinearFilter
        : s === 'linear'
          ? THREE.LinearFilter
          : THREE.NearestFilter;
    t.magFilter = s === 'nearest' ? THREE.NearestFilter : THREE.LinearFilter;
    t.generateMipmaps = s === 'mipmap';
    t.needsUpdate = true;
  }
}

/** 8 x 5 strip: idle row (8 directions), then walk frames 0-3 per direction pair. */
function strip(frames: readonly RenderedFrame[]): Uint8Array {
  const cols = 8;
  const rows = Math.ceil(frames.length / cols);
  const out = new Uint8Array(CELL * cols * CELL * rows * 4);
  frames.forEach((f, n) => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    for (let y = 0; y < CELL; y++)
      out.set(
        f.pixels.subarray(y * CELL * 4, (y + 1) * CELL * 4),
        ((row * CELL + y) * CELL * cols + col * CELL) * 4,
      );
  });
  return out;
}

describe(`FX-I light edge pixels (${currentBackend()})`, () => {
  let h: GpuHarness;
  let binder: SettingsBinder;
  let character: RealStage;
  beforeAll(async () => {
    h = await createGpuHarness(CELL, CELL);
    binder = new SettingsBinder();
    character = await loadDefaultCharacter(binder, h.backend);
  });
  afterAll(() => {
    character?.dispose();
    binder?.dispose();
    h?.dispose();
  });

  it(
    'AC-PIX-012.8 / FX-I (REQ-PIX-012, REQ-PIX-038): light-pixel count per candidate cause, 0 isolated rim-made light pixels',
    {timeout: 600_000},
    async () => {
      const textures = characterTextures(character.assembly.root);
      const coverage = (
        await runExport(
          h,
          character,
          binder,
          settingsOf({name: 'coverage', outline: false, rim: false}),
        )
      ).frames;
      const report: Record<string, unknown> = {
        textures: textures.map(t => t.name),
      };
      let baseline: RenderedFrame[] | undefined;
      let rimOffFrames: RenderedFrame[] | undefined;
      for (const v of VARIANTS) {
        setSampling(textures, v.sampling ?? 'mipmap');
        const {frames} = await runExport(h, character, binder, settingsOf(v));
        baseline ??= frames;
        if (v.name === 'rim-off') rimOffFrames = frames;
        let changed = 0;
        frames.forEach((f, fi) => {
          const b = baseline![fi]!.pixels;
          for (let i = 0; i < f.pixels.length; i += 4)
            if (
              f.pixels[i] !== b[i] ||
              f.pixels[i + 1] !== b[i + 1] ||
              f.pixels[i + 2] !== b[i + 2] ||
              f.pixels[i + 3] !== b[i + 3]
            )
              changed++;
        });
        const stats = {
          ...lightStats(frames, CELL, coverage),
          changedVsBaseline: changed,
        };
        report[v.name] = stats;
        console.log(`[fx-i] ${h.backend} ${v.name}: ${JSON.stringify(stats)}`);
        expect(stats.covered).toBeGreaterThan(0);
        if (STRIP_VARIANTS.has(v.name))
          await commands.csgSeedGolden(
            'test-results/fx-i',
            h.backend,
            v.name,
            toBase64(strip(frames)),
            CELL * 8,
            CELL * Math.ceil(frames.length / 8),
          );
      }
      setSampling(textures, 'mipmap');
      // AC-PIX-012.8 (FX-M): the literal light counts above stay in the report
      // (authored grey hair and pale ranger trim are light with the rim off
      // too); the gate is 0 isolated rim-made light pixels — light with the
      // rim on, sRGB luminance < 0.4 at the same pixel with the rim off.
      expect(baseline).toBeDefined();
      expect(rimOffFrames).toBeDefined();
      const rimMade = rimMadeStats(baseline!, rimOffFrames!, CELL);
      report['rim-made'] = rimMade;
      console.log(`[fx-m] ${h.backend} rim-made: ${JSON.stringify(rimMade)}`);
      await commands.csgWriteReport(`fx-i-light-${h.backend}.json`, report);
      expect(rimMade.isolatedRimMade).toBe(0);
    },
  );
});
