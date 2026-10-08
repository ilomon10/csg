/**
 * Build stage 3b: write the per-vertex `_REGION` attribute on body parts (spec 011 REQ-AST-012,
 * REQ-AST-025). The value is the index into `BODY_REGIONS` of the region owning the vertex's
 * highest-weight joint (via `RigDefinition.regionBones`).
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

/**
 * Writes `_REGION` (SCALAR, UNSIGNED_BYTE, not normalized) on every skinned primitive of a body
 * part. Ties between equal weights go to the lower attribute slot, then the lower joint slot.
 * Non-body items are left untouched. Throws `AST_REGION_UNMAPPED` naming the joint when the
 * dominant joint of a vertex is in no region.
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
      const sets: Array<
        [
          ReturnType<Primitive['getAttribute']>,
          ReturnType<Primitive['getAttribute']>,
        ]
      > = [];
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
      const out = new Uint8Array(count);
      const jv = [0, 0, 0, 0];
      const wv = [0, 0, 0, 0];
      for (let i = 0; i < count; i++) {
        let best = -1;
        let bestW = 0;
        for (const [ja, wa] of sets) {
          ja?.getElement(i, jv);
          wa?.getElement(i, wv);
          for (let c = 0; c < 4; c++) {
            const w = wv[c] ?? 0;
            if (w > bestW) {
              bestW = w;
              best = jv[c] ?? 0;
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
        out[i] = region;
      }
      prim.setAttribute(
        '_REGION',
        doc.createAccessor('_REGION').setType('SCALAR').setArray(out),
      );
      vertices += count;
    }
  }
  return {written: true, vertices};
}
