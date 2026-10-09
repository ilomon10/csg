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

/** Differing share over pixels that are opaque (alpha > 0) in either image. */
export function differingOpaqueShare(
  a: Uint8Array,
  b: Uint8Array,
): {opaque: number; differing: number; share: number} {
  let opaque = 0;
  let differing = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    opaque++;
    if (
      a[i] !== b[i] ||
      a[i + 1] !== b[i + 1] ||
      a[i + 2] !== b[i + 2] ||
      a[i + 3] !== b[i + 3]
    )
      differing++;
  }
  return {opaque, differing, share: opaque === 0 ? 0 : differing / opaque};
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
    expect(differingOpaqueShare(a, b)).toEqual({
      opaque: 3,
      differing: 2,
      share: 2 / 3,
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
      json[n.replace(/\.png$/, '')] = {...r, percent: Number(pct)};
      rows.push(
        `${n.replace(/\.png$/, '')}: ${pct} % (${r.differing}/${r.opaque})`,
      );
      if (r.share > WARN_SHARE)
        console.warn(
          `[AC-PIX-028.2] WARNING ${n}: ${pct} % of opaque pixels differ between WebGPU and WebGL2 (> 2 %)`,
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
