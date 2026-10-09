/**
 * AC-PIX-028.2: share of differing opaque pixels between the committed WebGPU and WebGL2
 * goldens of the same case. Informational: it never fails on the value, and warns above 2 %.
 * It runs in the plain Node `engine` project (no browser) on the committed PNGs.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {decodePng} from '../gpu/png.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'goldens');
/** Warn threshold of AC-PIX-028.2. */
const WARN_SHARE = 0.02;

/** Per-channel tolerance of the "large difference" metric (texture-filter and raster variance). */
const CHANNEL_TOLERANCE = 1;

/**
 * Differing share over pixels that are opaque (alpha > 0) in either image: `share` counts any
 * difference, `largeShare` only pixels with a channel differing by more than +-1 (the number the
 * 2 % warning uses; the raw share is expected to be higher from filter variance, review L-note).
 */
export function differingOpaqueShare(
  a: Uint8Array,
  b: Uint8Array,
): {
  opaque: number;
  differing: number;
  share: number;
  large: number;
  largeShare: number;
} {
  let opaque = 0;
  let differing = 0;
  let large = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    opaque++;
    for (let c = 0; c < 4; c++) {
      if (Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)) > CHANNEL_TOLERANCE) {
        large++;
        break;
      }
    }
    if (
      a[i] !== b[i] ||
      a[i + 1] !== b[i + 1] ||
      a[i + 2] !== b[i + 2] ||
      a[i + 3] !== b[i + 3]
    )
      differing++;
  }
  return {
    opaque,
    differing,
    share: opaque === 0 ? 0 : differing / opaque,
    large,
    largeShare: opaque === 0 ? 0 : large / opaque,
  };
}

const names = existsSync(join(ROOT, 'webgpu'))
  ? readdirSync(join(ROOT, 'webgpu'))
      .filter(n => n.endsWith('.png'))
      .sort()
  : [];

describe('golden cross-backend share', () => {
  it('AC-PIX-028.2: differing share is computed on synthetic images', () => {
    const a = new Uint8Array([
      255, 0, 0, 255, 0, 0, 0, 0, 1, 2, 3, 255, 9, 9, 9, 255,
    ]);
    const b = new Uint8Array([
      255, 0, 0, 255, 0, 0, 0, 0, 1, 2, 4, 255, 0, 0, 0, 0,
    ]);
    // Pixel 3 differs by 1 (within +-1), pixel 4 is opaque in one image only (large).
    expect(differingOpaqueShare(a, b)).toEqual({
      opaque: 3,
      differing: 2,
      share: 2 / 3,
      large: 1,
      largeShare: 1 / 3,
    });
  });

  it('AC-PIX-028.2: reports the WebGPU vs WebGL2 differing opaque share per case, warns above 2 %', () => {
    expect(names.length).toBeGreaterThan(0);
    const rows: string[] = [];
    const json: Record<string, unknown> = {};
    for (const n of names) {
      const other = join(ROOT, 'webgl2', n);
      expect(existsSync(other), `webgl2 golden for ${n}`).toBe(true);
      const a = decodePng(readFileSync(join(ROOT, 'webgpu', n)));
      const b = decodePng(readFileSync(other));
      expect([b.width, b.height]).toEqual([a.width, a.height]);
      const r = differingOpaqueShare(a.data, b.data);
      const pct = (r.share * 100).toFixed(2);
      const largePct = (r.largeShare * 100).toFixed(2);
      json[n.replace(/\.png$/, '')] = {
        ...r,
        percent: Number(pct),
        largePercent: Number(largePct),
      };
      rows.push(
        `${n.replace(/\.png$/, '')}: raw ${pct} % (${r.differing}/${r.opaque}), >+-1 ${largePct} % (${r.large}/${r.opaque})`,
      );
      if (r.largeShare > WARN_SHARE)
        console.warn(
          `[AC-PIX-028.2] WARNING ${n}: ${largePct} % of opaque pixels differ by more than +-1 per channel between WebGPU and WebGL2 (> 2 %; raw ${pct} %)`,
        );
    }
    console.log(`[AC-PIX-028.2] cross-backend share\n${rows.join('\n')}`);
    const dir = join(ROOT, '..', '..', '..', '..', 'test-results');
    mkdirSync(dir, {recursive: true});
    writeFileSync(
      join(dir, 'golden-cross-backend.json'),
      `${JSON.stringify(json, null, 2)}\n`,
    );
  });
});
