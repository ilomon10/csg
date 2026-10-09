import {Document} from '@gltf-transform/core';
import type {Accessor} from '@gltf-transform/core';
import {describe, expect, it} from 'vitest';
import {limitInfluences} from './influences.js';

function makeDoc(
  vertices: Array<{joints: number[]; weights: number[]}>,
  twoSets: boolean,
): {doc: Document; prim: ReturnType<Document['createPrimitive']>} {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const acc = (
    type: 'VEC4',
    arr: ArrayLike<number> & {length: number},
    ctor: 'u' | 'f',
  ) =>
    doc
      .createAccessor()
      .setType(type)
      .setBuffer(buffer)
      .setArray(
        ctor === 'u'
          ? new Uint16Array(arr as ArrayLike<number>)
          : new Float32Array(arr as ArrayLike<number>),
      );
  const n = vertices.length;
  const pos = doc
    .createAccessor()
    .setType('VEC3')
    .setBuffer(buffer)
    .setArray(new Float32Array(n * 3));
  const prim = doc.createPrimitive().setAttribute('POSITION', pos);
  const sets = twoSets ? 2 : 1;
  for (let s = 0; s < sets; s++) {
    const j = new Array<number>(n * 4).fill(0);
    const w = new Array<number>(n * 4).fill(0);
    vertices.forEach((v, i) => {
      for (let k = 0; k < 4; k++) {
        j[i * 4 + k] = v.joints[s * 4 + k] ?? 0;
        w[i * 4 + k] = v.weights[s * 4 + k] ?? 0;
      }
    });
    prim.setAttribute(`JOINTS_${s}`, acc('VEC4', j, 'u'));
    prim.setAttribute(`WEIGHTS_${s}`, acc('VEC4', w, 'f'));
  }
  doc.createMesh().addPrimitive(prim);
  return {doc, prim};
}

const read = (a: Accessor | null, v: number) =>
  Array.from(a!.getElement(v, [0, 0, 0, 0]));

describe('limitInfluences', () => {
  it('AC-AST-027.1: [0.4,0.3,0.15,0.1,0.05] becomes the top 4 / 0.95 with count 1', () => {
    const {doc, prim} = makeDoc(
      [{joints: [3, 1, 4, 2, 7], weights: [0.4, 0.3, 0.15, 0.1, 0.05]}],
      true,
    );
    const r = limitInfluences(doc, {partId: 'ranger'});
    expect(r.limitedVertices).toBe(1);
    expect(r.maxBefore).toBe(5);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({
      code: 'AST_INFLUENCES_LIMITED',
      partId: 'ranger',
      details: {partId: 'ranger', vertices: 1, maxBefore: 5},
    });
    const w = read(prim.getAttribute('WEIGHTS_0'), 0);
    [0.4, 0.3, 0.15, 0.1].forEach((x, i) =>
      expect(Math.abs(w[i]! - x / 0.95)).toBeLessThan(1e-6),
    );
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(read(prim.getAttribute('JOINTS_0'), 0)).toEqual([3, 1, 4, 2]);
    expect(prim.getAttribute('JOINTS_1')).toBeNull();
    expect(prim.getAttribute('WEIGHTS_1')).toBeNull();
  });

  it('AC-AST-027.1: ties are broken by the lower joint index', () => {
    const {doc, prim} = makeDoc(
      [{joints: [9, 5, 8, 6, 2], weights: [0.2, 0.2, 0.2, 0.2, 0.2]}],
      true,
    );
    limitInfluences(doc);
    expect(read(prim.getAttribute('JOINTS_0'), 0)).toEqual([2, 5, 6, 8]);
    const w = read(prim.getAttribute('WEIGHTS_0'), 0);
    w.forEach(x => expect(x).toBeCloseTo(0.25, 6));
  });

  it('AC-AST-027.1: is deterministic and unaffected vertices stay unchanged', () => {
    const verts = [
      {joints: [1, 2, 0, 0], weights: [0.6, 0.4, 0, 0]},
      {joints: [3, 1, 4, 2, 7], weights: [0.4, 0.3, 0.15, 0.1, 0.05]},
    ];
    const a = makeDoc(verts, true);
    const b = makeDoc(verts, true);
    const ra = limitInfluences(a.doc);
    const rb = limitInfluences(b.doc);
    expect(ra).toEqual(rb);
    expect(ra.limitedVertices).toBe(1);
    expect(read(a.prim.getAttribute('WEIGHTS_0'), 1)).toEqual(
      read(b.prim.getAttribute('WEIGHTS_0'), 1),
    );
    expect(read(a.prim.getAttribute('WEIGHTS_0'), 0)[0]).toBeCloseTo(0.6, 6);
  });

  it('AC-AST-027.2: a mesh within 4 influences yields no warning', () => {
    const {doc, prim} = makeDoc(
      [{joints: [1, 2, 3, 4], weights: [0.25, 0.25, 0.25, 0.25]}],
      false,
    );
    const r = limitInfluences(doc);
    expect(r).toEqual({limitedVertices: 0, maxBefore: 4, warnings: []});
    expect(prim.getAttribute('JOINTS_0')).not.toBeNull();
  });
});
