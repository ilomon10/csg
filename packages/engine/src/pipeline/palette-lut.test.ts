import {PALETTE_PRESETS, hexToRgb} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {
  PALETTE_LUT_BYTES,
  PALETTE_LUT_SIZE,
  buildPaletteLut,
  darkestColor,
  lutIndex,
  lutLevel,
  lutTexelOffset,
  nearestPaletteIndex,
  quantizeReference,
} from './palette-lut';
import type {PaletteMetric} from './palette-lut';

// The engine tsconfig has no Node types; load the few builtins structurally.
interface NodeProcess {
  getBuiltinModule(id: string): unknown;
  hrtime: {bigint(): bigint};
  env: Record<string, string | undefined>;
}
const nodeProcess = (globalThis as unknown as {process: NodeProcess}).process;
const {readFileSync} = nodeProcess.getBuiltinModule('node:fs') as {
  readFileSync(file: string, enc: 'utf8'): string;
};
const {createHash} = nodeProcess.getBuiltinModule('node:crypto') as {
  createHash(alg: 'sha256'): {
    update(data: Uint8Array): {digest(enc: 'hex'): string};
  };
};
const {fileURLToPath} = nodeProcess.getBuiltinModule('node:url') as {
  fileURLToPath(url: string): string;
};
const {dirname, join} = nodeProcess.getBuiltinModule('node:path') as {
  dirname(p: string): string;
  join(...parts: string[]): string;
};

const here = dirname(fileURLToPath(import.meta.url));

/** Byte-for-byte equality of two arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const PICO8 = PALETTE_PRESETS['pico-8'].colors;
const ENDESGA32 = PALETTE_PRESETS['endesga-32'].colors;

/**
 * SHA-256 of `buildPaletteLut(pico-8, 'oklab')` built in Node. The M2-08 browser harness must
 * compare the worker-built LUT against this digest (AC-PIX-021.5, cross-engine bytes).
 */
const PICO8_OKLAB_LUT_SHA256 =
  '39abb4c60760d05ad3ce45de9df1eac4bbe3d26576f099a9bb7f042f237b0a5d';

/** Deterministic LCG for fixtures (tests never use Math.random). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function randomPalette(seed: number, n: number): string[] {
  const next = lcg(seed);
  const colors: string[] = [];
  for (let i = 0; i < n; i++) {
    colors.push(`#${(next() >>> 8).toString(16).padStart(6, '0')}`);
  }
  return colors;
}

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

describe('REQ-PIX-021: palette LUT', () => {
  it('AC-PIX-021.1: two Node builds of pico-8 are byte-identical; (255, 0, 77) maps to index 8', () => {
    const a = buildPaletteLut(PICO8, 'oklab');
    const b = buildPaletteLut(PICO8, 'oklab');
    expect(a.length).toBe(PALETTE_LUT_BYTES);
    expect(bytesEqual(a, b)).toBe(true);
    expect(quantizeReference(a, [255, 0, 77])).toBe(8);
    expect(PICO8[8]).toBe('#ff004d');
    expect(sha256(a)).toBe(PICO8_OKLAB_LUT_SHA256);
  });

  it('AC-PIX-021.4: lutIndex / lutLevel integer formulas', () => {
    expect(lutIndex(0)).toBe(0);
    expect(lutIndex(2)).toBe(0);
    expect(lutIndex(3)).toBe(1);
    expect(lutIndex(77)).toBe(19);
    expect(lutIndex(255)).toBe(63);
    for (let i = 0; i < PALETTE_LUT_SIZE; i++) {
      expect(lutIndex(lutLevel(i))).toBe(i);
    }
    expect(lutLevel(0)).toBe(0);
    expect(lutLevel(63)).toBe(255);
    // Monotone and covers 0..63 over all 256 codes.
    let prev = 0;
    for (let c = 0; c < 256; c++) {
      const i = lutIndex(c);
      expect(i === prev || i === prev + 1).toBe(true);
      prev = i;
    }
    expect(() => lutIndex(256)).toThrow(RangeError);
    expect(() => lutIndex(1.5)).toThrow(RangeError);
    expect(() => lutLevel(64)).toThrow(RangeError);
  });

  it('AC-PIX-021.4: builder modules use only basic arithmetic (no pow/cbrt/exp/log/**)', () => {
    const files = [
      'srgb8.ts',
      'oklab.ts',
      'palette-lut.ts',
      'palette-lut.worker.ts',
    ];
    const forbidden = /Math\.(pow|cbrt|exp|expm1|log|log2|log10|log1p)\b|\*\*/;
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(here, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/.*$/gm, '');
      src.split('\n').forEach((line, i) => {
        if (forbidden.test(line))
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('AC-PIX-021.5: texel (63, 0, 19) of pico-8 sits at the spec offset and holds (255, 0, 77, 8)', () => {
    const lut = buildPaletteLut(PICO8, 'oklab');
    const offset = ((2 * 64 + 0) * 512 + (3 * 64 + 63)) * 4;
    expect(lutTexelOffset(63, 0, 19)).toBe(offset);
    expect([...lut.subarray(offset, offset + 4)]).toEqual([255, 0, 77, 8]);
  });

  for (const [name, colors] of [
    ['pico-8', PICO8],
    ['endesga-32', ENDESGA32],
  ] as const) {
    for (const metric of ['oklab', 'srgb'] as const) {
      it(`AC-PIX-021.5: every ${name} color maps to its own index through lutIndex (${metric})`, () => {
        const lut = buildPaletteLut(colors, metric);
        const collisions: string[] = [];
        colors.forEach((hex, i) => {
          const rgb = hexToRgb(hex) as [number, number, number];
          const got = quantizeReference(lut, rgb);
          if (got !== i)
            collisions.push(`${i} ${hex} -> ${got} ${colors[got]}`);
        });
        expect(collisions).toEqual([]);
      });
    }
  }

  it('AC-PIX-021.5: RGB of every texel is the palette color of its index (A channel)', () => {
    const lut = buildPaletteLut(ENDESGA32, 'oklab');
    const rgbs = ENDESGA32.map(h => hexToRgb(h) as [number, number, number]);
    for (let o = 0; o < lut.length; o += 4) {
      const rgb = rgbs[lut[o + 3] as number] as [number, number, number];
      if (lut[o] !== rgb[0] || lut[o + 1] !== rgb[1] || lut[o + 2] !== rgb[2]) {
        throw new Error(`texel at byte ${o} disagrees with its index`);
      }
    }
  });

  it('AC-PIX-021.1: pruned LUT search equals brute-force nearest with lowest-index ties', () => {
    const palettes: string[][] = [
      randomPalette(1, 7),
      randomPalette(2, 64),
      randomPalette(3, 256),
      // Duplicates and exact ties: index 0 must win.
      ['#808080', '#808080', '#000000', '#000000', '#ffffff'],
    ];
    const next = lcg(99);
    for (const colors of palettes) {
      for (const metric of ['oklab', 'srgb'] as PaletteMetric[]) {
        const lut = buildPaletteLut(colors, metric);
        for (let s = 0; s < 1500; s++) {
          const r = next() % 64;
          const g = next() % 64;
          const b = next() % 64;
          const want = nearestPaletteIndex(
            colors,
            [lutLevel(r), lutLevel(g), lutLevel(b)],
            metric,
          );
          const got = lut[lutTexelOffset(r, g, b) + 3];
          if (got !== want) {
            throw new Error(
              `${metric} ${colors.length}: (${r},${g},${b}) ${got} != ${want}`,
            );
          }
        }
      }
    }
  });

  it('AC-PIX-021.1: equal distances resolve to the lowest palette index', () => {
    // Level 1 = sRGB 4; #000000 and #080808 are both 4 away per channel in sRGB.
    for (const metric of ['srgb'] as PaletteMetric[]) {
      const lut = buildPaletteLut(['#080808', '#000000'], metric);
      const o = lutTexelOffset(1, 1, 1);
      expect([...lut.subarray(o, o + 4)]).toEqual([8, 8, 8, 0]);
      const lut2 = buildPaletteLut(['#000000', '#080808'], metric);
      expect(lut2[o + 3]).toBe(0);
    }
    expect(
      nearestPaletteIndex(['#ff0000', '#ff0000'], [255, 0, 0], 'oklab'),
    ).toBe(0);
  });

  it('AC-PIX-021.1: rejects empty, oversized and malformed palettes', () => {
    expect(() => buildPaletteLut([], 'oklab')).toThrow(RangeError);
    expect(() => buildPaletteLut(randomPalette(5, 257), 'oklab')).toThrow(
      RangeError,
    );
    expect(() => buildPaletteLut(['#12345'], 'oklab')).toThrow(RangeError);
    expect(() => quantizeReference(new Uint8Array(4), [0, 0, 0])).toThrow(
      RangeError,
    );
  });

  it('AC-PIX-021.2: Node proxy — a 256-color LUT builds within budget', () => {
    const colors = randomPalette(42, 256);
    buildPaletteLut(colors, 'oklab'); // warm-up (JIT)
    const start = nodeProcess.hrtime.bigint();
    buildPaletteLut(colors, 'oklab');
    const ms = Number(nodeProcess.hrtime.bigint() - start) / 1e6;
    console.info(
      `[perf] AC-PIX-021.2 256-color OKLab LUT build (Node): ${ms.toFixed(1)} ms`,
    );
    // Gate on the reference machine only (plan §3 Perf); CI reports and uses a loose bound.
    // GPU test: M2-08 harness — measure the build inside the browser worker as well.
    expect(ms).toBeLessThanOrEqual(
      nodeProcess.env.CSG_PERF_GATE === '1' ? 250 : 2500,
    );
  });
});

describe('REQ-PIX-017: darkest palette color', () => {
  it('AC-PIX-017.1: black outline color is #000000 for pico-8 and #181425 for endesga-32', () => {
    expect(darkestColor(PICO8)).toBe('#000000');
    expect(darkestColor(ENDESGA32)).toBe('#181425');
  });

  it('AC-PIX-017.4: darkestColor of a custom palette and ties to the lowest index', () => {
    expect(darkestColor(['#ffffff', '#102030'])).toBe('#102030');
    expect(darkestColor(['#222222', '#ffffff', '#222222'])).toBe('#222222');
    expect(darkestColor(['#010101', '#000000', '#000000'])).toBe('#000000');
    expect(() => darkestColor([])).toThrow(RangeError);
  });
});
