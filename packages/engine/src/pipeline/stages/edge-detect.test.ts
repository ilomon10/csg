import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {DataTexture} from 'three';
import {texture} from 'three/tsl';
import {defaultRenderSettings} from '@csg/parts-schema';
import {SettingsBinder} from '../settings-binder';
import {createStageContext} from '../stage-context';
import {
  alphaCutoff,
  ALPHA_CUTOFF_OUTPUTS,
  defaultAlphaCutoffInputs,
} from './coverage';
import {
  EDGE_DETECT_CATALOG_INPUTS,
  EDGE_DETECT_EXTRA_INPUTS,
  EDGE_DETECT_OUTPUTS,
  darkenNeighbourOffsets,
  defaultEdgeDetectInputs,
  edgeDetect,
  edgeSourcesFromSettings,
  referenceEdgeDetect,
} from './edge-detect';
import type {EdgeDetectParams} from './edge-detect';
import {CellBuilder, disc} from './outline-test-cells';
import {
  OUTLINE_INPUTS,
  OUTLINE_OUTPUTS,
  defaultOutlineInputs,
  outline,
} from './outline';

const RED = [0.75, 0.25, 0.25, 1] as const;
const BLUE = [0.25, 0.25, 0.75, 1] as const;

const BASE: EdgeDetectParams = {
  cutoff: 0.5,
  widthPx: 1,
  outerEnabled: true,
  innerEnabled: true,
  depthThresholdPx: 4,
  normalThresholdDeg: 60,
  sources: ['id'],
};

function coverage(cell: ReturnType<CellBuilder['build']>, cutoff = 0.5) {
  const out = new Uint8Array(cell.width * cell.height);
  for (let i = 0; i < out.length; i++) {
    out[i] = (cell.color[i * 4 + 3] ?? 0) >= cutoff ? 1 : 0;
  }
  return out;
}

/** Pixels of `mask` as "x,y" strings. */
function pixels(mask: Uint8Array, w: number): string[] {
  const out: string[] = [];
  mask.forEach((v, i) => {
    if (v === 1) out.push(`${i % w},${Math.floor(i / w)}`);
  });
  return out;
}

describe('darken neighbour order (REQ-PIX-017 note A2)', () => {
  it('AC-PIX-017.2: width 1 neighbours are up, left, right, down', () => {
    const w1 = darkenNeighbourOffsets().filter(o => o.minWidth <= 1);
    expect(w1.map(o => [o.dx, o.dy])).toEqual([
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ]);
  });

  it('AC-PIX-017.3: rings ascend, row-major within a ring, ring 1 includes diagonals from width 2', () => {
    const all = darkenNeighbourOffsets();
    expect(all).toHaveLength(48);
    expect(all.slice(0, 8).map(o => [o.dx, o.dy])).toEqual([
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ]);
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]!;
      const b = all[i]!;
      const key = (o: typeof a) => o.distance * 1000 + (o.dy + 3) * 10 + o.dx;
      expect(key(b)).toBeGreaterThan(key(a));
    }
    expect(all.find(o => o.dx === -1 && o.dy === -1)?.minWidth).toBe(2);
  });
});

describe('edge-detect reference (REQ-PIX-015, REQ-PIX-016)', () => {
  it('AC-PIX-015.1: width 1 outline = transparent pixels 4-adjacent to coverage, nothing else', () => {
    const cell = disc(new CellBuilder(64, 64), 32, 30, 14, {
      color: RED,
    }).build();
    const cov = coverage(cell);
    const {outer} = referenceEdgeDetect(cell, BASE);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = y * 64 + x;
        const adj = [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ].some(([dx, dy]) => {
          const xx = x + dx!;
          const yy = y + dy!;
          return (
            xx >= 0 && yy >= 0 && xx < 64 && yy < 64 && cov[yy * 64 + xx] === 1
          );
        });
        expect(outer[i]).toBe(cov[i] === 0 && adj ? 1 : 0);
      }
    }
  });

  it('AC-PIX-015.2: width 1 outline is exactly 1 px wide at 32 px and 128 px', () => {
    for (const size of [32, 128]) {
      const cell = disc(
        new CellBuilder(size, size),
        size / 2,
        size / 2,
        size / 4,
        {
          color: RED,
        },
      ).build();
      const cov = coverage(cell);
      const {outer} = referenceEdgeDetect(cell, BASE);
      expect(pixels(outer, size).length).toBeGreaterThan(0);
      // Every outline pixel touches coverage; no outline pixel is 4-adjacent
      // only to other outline pixels (i.e. the band has no second ring).
      outer.forEach((v, i) => {
        if (v !== 1) return;
        const x = i % size;
        const y = Math.floor(i / size);
        const touches = [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1],
        ].some(([dx, dy]) => cov[(y + dy!) * size + x + dx!] === 1);
        expect(touches).toBe(true);
      });
    }
  });

  it('AC-PIX-015.2/AC-PIX-017.3: widths 2 and 3 use the Chebyshev square; outer gate off draws nothing', () => {
    const cell = new CellBuilder(11, 11).pixel(5, 5, {color: RED}).build();
    for (const widthPx of [1, 2, 3]) {
      const {outer} = referenceEdgeDetect(cell, {...BASE, widthPx});
      const expected = widthPx === 1 ? 4 : (2 * widthPx + 1) ** 2 - 1;
      expect(pixels(outer, 11)).toHaveLength(expected);
    }
    const off = referenceEdgeDetect(cell, {...BASE, outerEnabled: false});
    expect(pixels(off.outer, 11)).toEqual([]);
  });

  it('AC-PIX-016.1: part-ID only, sword in front of torso → 1 px line on torso pixels', () => {
    // Torso id 2 at depth 0; a vertical sword (id 5) 2 px wide, 3 px nearer.
    const cell = new CellBuilder(16, 16)
      .rect(2, 2, 13, 13, {color: RED, id: 2, depth: 0})
      .rect(7, 0, 8, 15, {color: BLUE, id: 5, depth: 3})
      .build();
    const {inner} = referenceEdgeDetect(cell, {...BASE, sources: ['id']});
    const line = pixels(inner, 16);
    const expected: string[] = [];
    for (let y = 2; y <= 13; y++) expected.push(`6,${y}`, `9,${y}`);
    expect(line.sort()).toEqual(expected.sort());
    for (const p of line) {
      const [x, y] = p.split(',').map(Number);
      expect(cell.partId[y! * 16 + x!]).toBe(2);
    }
  });

  it('AC-PIX-016.2: all sources off (or inner disabled) → no inner pixels', () => {
    const cell = new CellBuilder(16, 16)
      .rect(2, 2, 13, 13, {color: RED, id: 2, depth: 0})
      .rect(7, 0, 8, 15, {color: BLUE, id: 5, depth: 3, normal: [1, 0, 0]})
      .build();
    expect(
      pixels(referenceEdgeDetect(cell, {...BASE, sources: []}).inner, 16),
    ).toEqual([]);
    expect(
      pixels(
        referenceEdgeDetect(cell, {
          ...BASE,
          sources: ['id', 'depth', 'normal'],
          innerEnabled: false,
        }).inner,
        16,
      ),
    ).toEqual([]);
  });

  it('AC-PIX-016.3: depth only, threshold 4: B/C (5 px) draws on the farther quad, A/B (3 px) does not', () => {
    // Columns: A x 0..3 depth 8, B x 4..7 depth 5, C x 8..11 depth 0 (farthest).
    const cell = new CellBuilder(12, 4)
      .rect(0, 0, 3, 3, {color: RED, id: 1, depth: 8})
      .rect(4, 0, 7, 3, {color: RED, id: 1, depth: 5})
      .rect(8, 0, 11, 3, {color: RED, id: 1, depth: 0})
      .build();
    const {inner} = referenceEdgeDetect(cell, {
      ...BASE,
      sources: ['depth'],
      depthThresholdPx: 4,
    });
    expect(pixels(inner, 12).sort()).toEqual(['8,0', '8,1', '8,2', '8,3']);
    // Exactly at the threshold is not an edge (strictly greater).
    const eq = referenceEdgeDetect(cell, {
      ...BASE,
      sources: ['depth'],
      depthThresholdPx: 5,
    });
    expect(pixels(eq.inner, 12)).toEqual([]);
  });

  it('AC-PIX-016.4: equal depth tie-breaks by part ID (higher ID draws) and by row-major order for normals', () => {
    const ids = (left: number, right: number) => {
      const cell = new CellBuilder(2, 1)
        .rect(0, 0, 0, 0, {color: RED, id: left, depth: 1})
        .rect(1, 0, 1, 0, {color: RED, id: right, depth: 1})
        .build();
      return pixels(
        referenceEdgeDetect(cell, {...BASE, sources: ['id']}).inner,
        2,
      );
    };
    expect(ids(3, 5)).toEqual(['1,0']);
    expect(ids(5, 3)).toEqual(['0,0']);
    // Normal source: equal depth and ID, normals 90 degrees apart > 60.
    const cell = new CellBuilder(1, 2)
      .rect(0, 0, 0, 0, {color: RED, normal: [0, 0, 1], depth: 1})
      .rect(0, 1, 0, 1, {color: RED, normal: [1, 0, 0], depth: 1})
      .build();
    const n = referenceEdgeDetect(cell, {
      ...BASE,
      sources: ['normal'],
      normalThresholdDeg: 60,
    });
    expect(pixels(n.inner, 1)).toEqual(['0,1']);
  });

  it('AC-PIX-016.2: normal source marks creases above the threshold only', () => {
    const cell = new CellBuilder(8, 2)
      .rect(0, 0, 3, 1, {color: RED, normal: [0, 0, 1], depth: 1})
      .rect(4, 0, 7, 1, {color: RED, normal: [1, 0, 0], depth: 0})
      .build();
    const on = referenceEdgeDetect(cell, {
      ...BASE,
      sources: ['normal'],
      normalThresholdDeg: 60,
    });
    expect(pixels(on.inner, 8).sort()).toEqual(['4,0', '4,1']);
    const off = referenceEdgeDetect(cell, {
      ...BASE,
      sources: ['normal'],
      normalThresholdDeg: 95,
    });
    expect(pixels(off.inner, 8)).toEqual([]);
  });

  it('AC-PIX-017.2/.3: source = darken neighbour (outer) or own colour (inner)', () => {
    const a = [0.75, 0.25, 0.25, 1] as const;
    const b = [0.25, 0.75, 0.25, 1] as const;
    const c = [0.25, 0.25, 0.75, 1] as const;
    // P at (5, 5): A at (-1, -1), B at (1, -1), C at (0, -2).
    const cell = new CellBuilder(11, 11)
      .pixel(4, 4, {color: a})
      .pixel(6, 4, {color: b})
      .pixel(5, 3, {color: c})
      .build();
    const p = 5 * 11 + 5;
    const w2 = referenceEdgeDetect(cell, {...BASE, widthPx: 2});
    expect(w2.outer[p]).toBe(1);
    expect(Array.from(w2.source.subarray(p * 4, p * 4 + 4))).toEqual(
      Array.from(cell.color.subarray((4 * 11 + 4) * 4, (4 * 11 + 4) * 4 + 4)),
    );
    // Width 1: ring-1 diagonals excluded, (5,4) is empty → not an outline pixel.
    const w1 = referenceEdgeDetect(cell, BASE);
    expect(w1.outer[p]).toBe(0);
  });
});

describe('edge sources from settings (spec 007 outline.inner.sources)', () => {
  it('maps partId/depth/normal to id/depth/normal in canonical order', () => {
    const inner = defaultRenderSettings().outline.inner;
    expect(edgeSourcesFromSettings(inner)).toEqual(['id']);
    expect(
      edgeSourcesFromSettings({
        ...inner,
        partId: true,
        depth: true,
        normal: true,
      }),
    ).toEqual(['id', 'depth', 'normal']);
    expect(edgeSourcesFromSettings({...inner, partId: false})).toEqual([]);
  });
});

describe('stage shape (REQ-PIX-035)', () => {
  function ctx() {
    const binder = new SettingsBinder(defaultRenderSettings());
    const tex = (): DataTexture => new DataTexture(new Uint8Array(4), 1, 1);
    const color = texture(tex());
    const nd = texture(tex());
    return createStageContext({
      binder,
      target: 'post',
      mode: 'export',
      backend: 'webgl2',
      sources: {
        'scene.color': color,
        'scene.normal': nd,
        'scene.depth': nd,
        'scene.partId': texture(tex()),
      },
    });
  }

  it('AC-PIX-035.2/.3: emitters take (ctx, inputs, fields) and return the catalog outputs', () => {
    const c = ctx();
    const cov = alphaCutoff(c, defaultAlphaCutoffInputs(c), {});
    expect(Object.keys(cov)).toEqual([...ALPHA_CUTOFF_OUTPUTS]);
    expect(Object.keys(defaultAlphaCutoffInputs(c)).sort()).toEqual([
      'color',
      'cutoff',
    ]);

    const inputs = defaultEdgeDetectInputs(c);
    expect(Object.keys(inputs).sort()).toEqual(
      [...EDGE_DETECT_CATALOG_INPUTS, ...EDGE_DETECT_EXTRA_INPUTS].sort(),
    );
    const e = edgeDetect(c, inputs, {sources: ['id', 'depth', 'normal']});
    expect(Object.keys(e).sort()).toEqual([...EDGE_DETECT_OUTPUTS].sort());

    const o = outline(
      c,
      {
        color: cov.color,
        outer: e.outer,
        inner: e.inner,
        source: e.source,
        ...defaultOutlineInputs(c),
      },
      {mode: 'darken'},
    );
    expect(Object.keys(o)).toEqual([...OUTLINE_OUTPUTS]);
    for (const node of [cov.color, e.outer, e.inner, e.source, o.color]) {
      expect((node as {isNode?: boolean}).isNode).toBe(true);
    }
    expect([...OUTLINE_INPUTS].sort()).toEqual([
      'black',
      'color',
      'customColor',
      'darkenAmount',
      'inner',
      'outer',
      'source',
    ]);
    expect(alphaCutoff.length).toBe(3);
    expect(edgeDetect.length).toBe(3);
    expect(outline.length).toBe(3);
  });

  it('AC-PIX-035.2: stage modules create no material, render target or mesh', () => {
    for (const f of ['coverage.ts', 'edge-detect.ts', 'outline.ts']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(
        /Material|RenderTarget|QuadMesh|RenderPipeline|new\s+[A-Z]\w*Texture/,
      );
    }
  });

  it('AC-PIX-034.1 (unit): outline uniforms are the reserved-ID uniforms shared with the binder', () => {
    const c = ctx();
    const inputs = defaultEdgeDetectInputs(c);
    expect(inputs.width).toBe(c.uniform('outline.outer.widthPx', 'int', 1));
    expect(inputs.cutoff).toBe(c.builtin('render.alphaCutoff'));
    expect(defaultOutlineInputs(c).darkenAmount).toBe(
      c.uniform('outline.darkenAmount', 'float', 0),
    );
  });

  it('throws when a scene builtin is not a texture node', () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const c = createStageContext({
      binder,
      target: 'post',
      mode: 'export',
      backend: 'webgpu',
      sources: {'scene.color': binder.time},
    });
    expect(() => defaultAlphaCutoffInputs(c)).toThrow(/TextureNode/);
  });
});
