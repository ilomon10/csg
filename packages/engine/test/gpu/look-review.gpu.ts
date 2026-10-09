/**
 * Look review (PM decision D2, task FX-G): the real default Quaternius
 * character (`data/default-character.json`: superhero-m + male ranger outfit,
 * packs from `assets/packs`) exported at 64 px through `prepareFrames` →
 * `renderFrames` on both backends, for side / three-quarter / isometric in
 * the default look and in pico-8 + bayer4.
 *
 * Every export has two clips: `idle` (frame 0, 8 directions) and `walk`
 * (4 frames; directions `s` and `e` go into the strip). Strip layout, 64 px
 * cells: row 0 = idle frame 0 in direction order e, ne, n, nw, w, sw, s, se;
 * row 1 = walk frames 0–3 of `s`, then walk frames 0–3 of `e`.
 *
 * Since FX-J every preset uses the shipped defaults (resolution-relative
 * `pivotRowPx` of AC-PIX-008.5, screen-space rim, black outline, user D2
 * "brighter + punchier"). Since FX-K the default tints are all `#ffffff` and
 * `multiply` is `texel.rgb × tint`, so the strips show the authored Quaternius
 * colours (the FX-J untinted evidence strip is gone). Output PNGs (not goldens):
 * `test-results/look-review/<backend>/<preset>-<look>.png`; the FX-I light
 * speckle counts (rim on / rim off) and the AC-PIX-012.8 rim-made counts go to
 * `test-results/look-review-<backend>.json`.
 */
import {DEFAULT_CHARACTER_DATA, defaultRenderSettings} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {commands} from 'vitest/browser';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
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
import type {RealStage, RimMadeStats} from './real-character';

const CELL = 64;
const PRESETS = ['side', 'three-quarter', 'isometric'] as const;
const LOOKS = ['default', 'pico8-bayer4'] as const;
/** Directions of the walk row (labels of the 8-direction set). */
const WALK_DIRECTIONS = ['s', 'e'] as const;
const WALK_FRAMES = 4;

/** Default `pivotRowPx` at 64 px with the default outline (AC-PIX-008.5). */
const DEFAULT_PIVOT_ROW_PX: Record<(typeof PRESETS)[number], number> = {
  side: 3,
  'three-quarter': 12,
  isometric: 10,
};

function reviewSettings(
  preset: (typeof PRESETS)[number],
  look: (typeof LOOKS)[number],
): RenderSettings {
  const s = defaultRenderSettings(preset);
  const [idle, walk] = DEFAULT_CHARACTER_DATA.clips as [string, string];
  return {
    ...s,
    resolution: {width: CELL, height: CELL},
    directions: 8,
    palette:
      look === 'default'
        ? s.palette
        : {...s.palette, id: 'pico-8', dither: {mode: 'bayer4', strength: 0.5}},
    animations: [
      {clipId: idle, label: 'idle', frameCount: 1, fps: 8, loop: true},
      {
        clipId: walk,
        label: 'walk',
        frameCount: WALK_FRAMES,
        fps: 8,
        loop: true,
      },
    ],
  } as RenderSettings;
}

/** Opaque bounding rows/columns of a frame, or `null` when empty. */
function opaqueBox(frame: RenderedFrame) {
  const {width: w, height: hh, pixels} = frame;
  let top = hh;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return bottom < 0 ? null : {top, bottom, left, right};
}

/** HSV hue in degrees of the sRGB pixel at byte offset `i`. */
function hue(p: Uint8ClampedArray | Uint8Array, i: number): number {
  const r = p[i]!;
  const g = p[i + 1]!;
  const b = p[i + 2]!;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Lays the review frames out as 8 × 2 cells. */
function strip(frames: readonly RenderedFrame[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CELL * 8 * CELL * 2 * 4);
  const put = (f: RenderedFrame, col: number, row: number) => {
    for (let y = 0; y < CELL; y++) {
      out.set(
        f.pixels.subarray(y * CELL * 4, (y + 1) * CELL * 4),
        ((row * CELL + y) * CELL * 8 + col * CELL) * 4,
      );
    }
  };
  // Direction indices of the 8-direction set: e=0 … s=6 (DIRECTION_ORDER).
  const walkDirs: Record<(typeof WALK_DIRECTIONS)[number], number> = {
    s: 6,
    e: 0,
  };
  for (const f of frames) {
    if (f.clipId === 'idle' && f.frame === 0) put(f, f.direction, 0);
    if (f.clipId === 'walk') {
      WALK_DIRECTIONS.forEach((label, i) => {
        if (f.direction === walkDirs[label])
          put(f, i * WALK_FRAMES + f.frame, 1);
      });
    }
  }
  return out;
}

describe(`look review: default Quaternius character (${currentBackend()})`, () => {
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

  const report: Record<string, unknown> = {};
  afterAll(async () => {
    await commands.csgWriteReport(`look-review-${h.backend}.json`, report);
  });

  for (const preset of PRESETS) {
    it(
      `AC-PIX-012.8: ${preset} defaults — one camera, no clipping, review strips, 0 isolated rim-made light pixels`,
      {timeout: 240_000},
      async () => {
        let gate: RimMadeStats | null = null;
        for (const look of LOOKS) {
          const settings = reviewSettings(preset, look);
          expect(settings.camera.pivotRowPx).toBe(DEFAULT_PIVOT_ROW_PX[preset]);
          const {prepared, frames} = await runExport(
            h,
            character,
            binder,
            settings,
          );
          expect(frames).toHaveLength(8 * (1 + WALK_FRAMES));
          const warnings = prepared.warnings.map(w => w.code);
          expect(warnings).not.toContain('PIX_FRAMING_CLIPPED');
          let minHeight = CELL;
          let edgeFrames = 0;
          for (const f of frames) {
            const box = opaqueBox(f);
            expect(box).not.toBeNull();
            if (box === null) continue;
            if (
              box.top === 0 ||
              box.left === 0 ||
              box.right === CELL - 1 ||
              box.bottom === CELL - 1
            )
              edgeFrames++;
            minHeight = Math.min(minHeight, box.bottom - box.top + 1);
          }
          const stats = lightStats(frames, CELL);
          report[`${preset}-${look}`] = {
            ...stats,
            minHeight,
            edgeFrames,
            worldPerPx: prepared.framing.worldPerPx,
          };
          console.log(
            `[fx-j] ${h.backend} ${preset} ${look}: pivotRowPx ${settings.camera.pivotRowPx} ` +
              `minFrameHeight ${minHeight}px edgeFrames ${edgeFrames} light ${JSON.stringify(stats)}`,
          );
          await commands.csgSeedGolden(
            'test-results/look-review',
            h.backend,
            `${preset}-${look}`,
            toBase64(new Uint8Array(strip(frames).buffer)),
            CELL * 8,
            CELL * 2,
          );
          // FX-G framing targets.
          expect(minHeight).toBeGreaterThanOrEqual(Math.ceil(0.7 * CELL));
          expect(edgeFrames).toBe(0);
          // AC-PIX-012.8 (FX-M): no isolated rim-made light pixel, palette
          // none — light with the rim on, dark (sRGB luminance < 0.4) at the
          // same pixel with the rim off. Authored light texels stay allowed.
          if (look === 'default') {
            const rimOff = {
              ...settings,
              toon: {
                ...settings.toon,
                rim: {...settings.toon.rim, enabled: false},
              },
            } as RenderSettings;
            const offFrames = (await runExport(h, character, binder, rimOff))
              .frames;
            const offStats = lightStats(offFrames, CELL);
            report[`${preset}-${look}-rim-off`] = offStats;
            gate = rimMadeStats(frames, offFrames, CELL);
            report[`${preset}-${look}-rim-made`] = gate;
            console.log(
              `[fx-m] ${h.backend} ${preset} rim-off light ${JSON.stringify(offStats)} ` +
                `rim-made ${JSON.stringify(gate)}`,
            );
          }
        }
        // Asserted after both looks so every strip is still written.
        expect(gate).not.toBeNull();
        if (gate === null) return;
        expect(gate.isolatedRimMade).toBe(0);
      },
    );
  }
  it(
    'AC-PIX-012.7: three-quarter default rim pixels keep their HSV hue within 10° of the rim-off colour',
    {timeout: 240_000},
    async () => {
      const on = reviewSettings('three-quarter', 'default');
      const off = {
        ...on,
        toon: {...on.toon, rim: {...on.toon.rim, enabled: false}},
      } as RenderSettings;
      const a = (await runExport(h, character, binder, on)).frames;
      const b = (await runExport(h, character, binder, off)).frames;
      let rimPixels = 0;
      let checked = 0;
      let worst = 0;
      a.forEach((f, fi) => {
        const g = b[fi]!.pixels;
        for (let i = 0; i < f.pixels.length; i += 4) {
          const p = f.pixels;
          if (p[i] === g[i] && p[i + 1] === g[i + 1] && p[i + 2] === g[i + 2])
            continue;
          rimPixels++;
          const chroma =
            (Math.max(g[i]!, g[i + 1]!, g[i + 2]!) -
              Math.min(g[i]!, g[i + 1]!, g[i + 2]!)) /
            255;
          if (chroma < 0.1) continue;
          const d = Math.abs(hue(p, i) - hue(g, i));
          const diff = Math.min(d, 360 - d);
          worst = Math.max(worst, diff);
          checked++;
        }
      });
      report['three-quarter-default-rim-hue'] = {rimPixels, checked, worst};
      expect(rimPixels).toBeGreaterThan(100);
      expect(worst).toBeLessThanOrEqual(10);
    },
  );
});
