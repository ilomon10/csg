/**
 * Build stage 5: cap skin influences at 4 per vertex (spec 011 REQ-AST-027).
 */
import type {Accessor, Document} from '@gltf-transform/core';
import type {BuildWarning} from './types.js';

/** Result of {@link limitInfluences}. */
export interface LimitInfluencesResult {
  /** Vertices that had more than 4 non-zero influences. */
  limitedVertices: number;
  /** Largest non-zero influence count found on any vertex before limiting. */
  maxBefore: number;
  /** `AST_INFLUENCES_LIMITED` when any vertex was limited. */
  warnings: BuildWarning[];
}

/**
 * Keeps the 4 largest weights per vertex (ties: lower joint index), renormalizes
 * them to sum 1, rewrites `JOINTS_0`/`WEIGHTS_0` and drops `JOINTS_1+`/`WEIGHTS_1+`
 * (REQ-AST-027, AC-AST-027.1). Mutates `doc`; deterministic.
 *
 * @param doc part document.
 * @param opts `partId` names the part in the warning.
 */
export function limitInfluences(
  doc: Document,
  opts: {partId?: string} = {},
): LimitInfluencesResult {
  const partId = opts.partId ?? 'unknown';
  let limitedVertices = 0;
  let maxBefore = 0;
  const done = new Set<Accessor>();
  const jv = [0, 0, 0, 0];
  const wv = [0, 0, 0, 0];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const j0 = prim.getAttribute('JOINTS_0');
      const w0 = prim.getAttribute('WEIGHTS_0');
      if (!j0 || !w0) continue;
      const sets: Array<[Accessor, Accessor]> = [];
      for (let s = 1; ; s++) {
        const j = prim.getAttribute(`JOINTS_${s}`);
        const w = prim.getAttribute(`WEIGHTS_${s}`);
        if (!j || !w) break;
        sets.push([j, w]);
      }
      if (done.has(j0)) {
        for (let s = 1; s <= sets.length; s++) {
          prim.setAttribute(`JOINTS_${s}`, null);
          prim.setAttribute(`WEIGHTS_${s}`, null);
        }
        continue;
      }
      done.add(j0);
      const all: Array<[Accessor, Accessor]> = [[j0, w0], ...sets];
      const count = j0.getCount();
      for (let v = 0; v < count; v++) {
        const entries: Array<{j: number; w: number}> = [];
        for (const [ja, wa] of all) {
          ja.getElement(v, jv);
          wa.getElement(v, wv);
          for (let k = 0; k < 4; k++) {
            if ((wv[k] ?? 0) > 0) entries.push({j: jv[k] ?? 0, w: wv[k] ?? 0});
          }
        }
        maxBefore = Math.max(maxBefore, entries.length);
        const extra = entries.length > 4;
        if (extra) limitedVertices++;
        if (!extra && sets.length === 0) continue;
        entries.sort((a, b) => b.w - a.w || a.j - b.j);
        const top = entries.slice(0, 4);
        const sum = top.reduce((acc, e) => acc + e.w, 0);
        for (let k = 0; k < 4; k++) {
          const e = top[k];
          jv[k] = e ? e.j : 0;
          wv[k] = e && sum > 0 ? e.w / sum : 0;
        }
        j0.setElement(v, jv);
        w0.setElement(v, wv);
      }
      for (let s = 1; s <= sets.length; s++) {
        prim.setAttribute(`JOINTS_${s}`, null);
        prim.setAttribute(`WEIGHTS_${s}`, null);
      }
    }
  }

  const warnings: BuildWarning[] =
    limitedVertices > 0
      ? [
          {
            code: 'AST_INFLUENCES_LIMITED',
            partId,
            message: `${partId}: limited ${limitedVertices} vertices to 4 influences (max before: ${maxBefore}).`,
            details: {partId, vertices: limitedVertices, maxBefore},
          },
        ]
      : [];
  return {limitedVertices, maxBefore, warnings};
}
