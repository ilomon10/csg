/**
 * Build stage 3b: write the per-vertex `_REGION` attribute on body parts (spec 011 REQ-AST-012,
 * REQ-AST-025). The value is the index into `BODY_REGIONS` of the region owning the vertex's
 * highest-weight joint (via `RigDefinition.regionBones`). The value is constant per TRIANGLE
 * (H1): the region with the largest summed vertex weight over the triangle's three vertices (ties
 * to the lower region index). Vertices shared by triangles of different regions are duplicated so
 * the GPU never interpolates between region indices.
 */
import type {Document, Primitive} from '@gltf-transform/core';
import {BODY_REGIONS} from '@csg/parts-schema';
import type {RigDefinition} from '@csg/parts-schema';
import {BuildError} from './types.js';

/** The part of a split item `writeRegions` needs. */
export interface RegionItem {
  kind: 'part' | 'clip';
  id: string;
  config?: {slot?: string};
}

/** Outcome of {@link writeRegions}. */
export interface RegionResult {
  /** True when `_REGION` was written (body parts only). */
  written: boolean;
  /** Number of vertices assigned. */
  vertices: number;
}

/** Error code for a dominant joint that no `regionBones` entry lists (AC-AST-012.2). */
export const AST_REGION_UNMAPPED = 'AST_REGION_UNMAPPED';

function jointToRegionIndex(rig: RigDefinition): Map<string, number> {
  const map = new Map<string, number>();
  BODY_REGIONS.forEach((region, index) => {
    for (const bone of rig.regionBones[region]) map.set(bone, index);
  });
  return map;
}

type Acc = NonNullable<ReturnType<Primitive['getAttribute']>>;

/** Copies `acc` into a new accessor whose rows are `acc` rows selected by `source` (in order). */
function remapAccessor(doc: Document, acc: Acc, source: number[]): Acc {
  const size = acc.getElementSize();
  const old = acc.getArray();
  if (!old) return acc;
  const Ctor = old.constructor as new (n: number) => Float32Array<ArrayBuffer>;
  const arr = new Ctor(source.length * size) as Float32Array<ArrayBuffer>;
  source.forEach((from, to) => {
    for (let k = 0; k < size; k++)
      arr[to * size + k] = old[from * size + k] ?? 0;
  });
  const out = doc
    .createAccessor(acc.getName())
    .setType(acc.getType())
    .setArray(arr)
    .setNormalized(acc.getNormalized());
  const buf = acc.getBuffer();
  if (buf) out.setBuffer(buf);
  return out;
}

function disposeIfOrphan(acc: Acc | null): void {
  if (!acc) return;
  if (acc.listParents().every(p => p.propertyType === 'Root')) acc.dispose();
}

/**
 * Writes `_REGION` (SCALAR, UNSIGNED_BYTE, not normalized) on every skinned primitive of a body
 * part, constant per triangle (H1). A triangle's region is the one with the largest summed vertex
 * weight over its three vertices (a vertex weight is split across regions by joint); ties go to
 * the lower region index. Vertices shared by triangles of different regions are duplicated
 * (appended in first-use order) with all other attributes, morph targets and skinning copied; the
 * index buffer is kept and rewritten. Throws `AST_REGION_UNMAPPED` naming the joint when the
 * dominant joint of a vertex is in no region. Non-body items are left untouched.
 */
export function writeRegions(
  doc: Document,
  item: RegionItem,
  rig: RigDefinition,
): RegionResult {
  if (item.kind !== 'part' || item.config?.slot !== 'body') {
    return {written: false, vertices: 0};
  }
  const regionOf = jointToRegionIndex(rig);
  const nRegions = BODY_REGIONS.length;
  let vertices = 0;
  const nodes = doc
    .getRoot()
    .listNodes()
    .filter(n => n.getMesh() && n.getSkin());
  const seen = new Set<Primitive>();
  for (const node of nodes) {
    const joints = node.getSkin()?.listJoints() ?? [];
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      if (seen.has(prim)) continue;
      seen.add(prim);
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const count = position.getCount();
      const sets: Array<[Acc, Acc]> = [];
      for (let n = 0; ; n++) {
        const j = prim.getAttribute(`JOINTS_${n}`);
        const w = prim.getAttribute(`WEIGHTS_${n}`);
        if (!j || !w) break;
        sets.push([j, w]);
      }
      if (sets.length === 0) {
        throw new BuildError(
          'AST_REGION_UNWEIGHTED',
          `Body "${item.id}" has a primitive without JOINTS_0/WEIGHTS_0.`,
        );
      }
      // Per-vertex region weights plus the dominant-joint region.
      const regionWeights = new Float64Array(count * nRegions);
      const own = new Array<number>(count).fill(0);
      const jv = [0, 0, 0, 0];
      const wv = [0, 0, 0, 0];
      for (let i = 0; i < count; i++) {
        let best = -1;
        let bestW = 0;
        for (const [ja, wa] of sets) {
          ja.getElement(i, jv);
          wa.getElement(i, wv);
          for (let c = 0; c < 4; c++) {
            const w = wv[c] ?? 0;
            if (w > bestW) {
              bestW = w;
              best = jv[c] ?? 0;
            }
            if (w > 0) {
              const r = regionOf.get(joints[jv[c] ?? 0]?.getName() ?? '');
              if (r !== undefined) {
                regionWeights[i * nRegions + r] =
                  (regionWeights[i * nRegions + r] ?? 0) + w;
              }
            }
          }
        }
        if (best < 0) {
          throw new BuildError(
            'AST_REGION_UNWEIGHTED',
            `Body "${item.id}" vertex ${i} has no joint weight.`,
          );
        }
        const name = joints[best]?.getName() ?? `#${best}`;
        const region = regionOf.get(name);
        if (region === undefined) {
          throw new BuildError(
            AST_REGION_UNMAPPED,
            `Joint "${name}" of body "${item.id}" is not listed in any regionBones entry.`,
          );
        }
        own[i] = region;
      }
      const indices = prim.getIndices();
      const idx = indices?.getArray();
      const triCount = Math.floor((idx ? idx.length : count) / 3);
      // Per triangle: dominant region; per corner: (vertex, region) -> output vertex.
      const source: number[] = [];
      for (let i = 0; i < count; i++) source.push(i);
      const region: number[] = [...own];
      const assigned = new Array<boolean>(count).fill(false);
      const extra = new Map<number, number>();
      const newIdx = new Array<number>(triCount * 3);
      for (let t = 0; t < triCount; t++) {
        const corner = [0, 1, 2].map(
          k => (idx ? idx[t * 3 + k] : t * 3 + k) ?? 0,
        );
        let bestR = 0;
        let bestSum = -1;
        for (let r = 0; r < nRegions; r++) {
          let sum = 0;
          for (const v of corner) sum += regionWeights[v * nRegions + r] ?? 0;
          if (sum > bestSum) {
            bestSum = sum;
            bestR = r;
          }
        }
        corner.forEach((v, k) => {
          let out = v;
          if (!assigned[v]) {
            assigned[v] = true;
            region[v] = bestR;
          } else if (region[v] !== bestR) {
            const key = v * nRegions + bestR;
            let dup = extra.get(key);
            if (dup === undefined) {
              dup = source.length;
              extra.set(key, dup);
              source.push(v);
              region.push(bestR);
            }
            out = dup;
          }
          newIdx[t * 3 + k] = out;
        });
      }
      if (source.length > count) {
        for (const sem of prim.listSemantics()) {
          const acc = prim.getAttribute(sem);
          if (!acc) continue;
          prim.setAttribute(sem, remapAccessor(doc, acc, source));
          disposeIfOrphan(acc);
        }
        for (const target of prim.listTargets()) {
          for (const sem of target.listSemantics()) {
            const acc = target.getAttribute(sem);
            if (!acc) continue;
            target.setAttribute(sem, remapAccessor(doc, acc, source));
            disposeIfOrphan(acc);
          }
        }
        if (indices && idx) {
          const arr =
            source.length > 65535 || idx instanceof Uint32Array
              ? new Uint32Array(newIdx)
              : new Uint16Array(newIdx);
          const next = doc
            .createAccessor(indices.getName())
            .setType('SCALAR')
            .setArray(arr);
          const buf = indices.getBuffer();
          if (buf) next.setBuffer(buf);
          prim.setIndices(next);
          disposeIfOrphan(indices);
        }
      }
      const out = Uint8Array.from(region);
      prim.setAttribute(
        '_REGION',
        doc.createAccessor('_REGION').setType('SCALAR').setArray(out),
      );
      vertices += source.length;
    }
  }
  return {written: true, vertices};
}
