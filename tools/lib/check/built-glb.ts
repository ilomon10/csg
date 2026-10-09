/**
 * Reader for built (output) GLBs of `assets:check` (spec 011 REQ-AST-016,
 * -020). Built files may use Meshopt and quantization, so the document is
 * read with the full extension set. Input is untrusted: size cap, magic-byte
 * check, no network access (buffers are inside the GLB).
 */
import {NodeIO} from '@gltf-transform/core';
import type {Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {BODY_REGIONS} from '@csg/parts-schema';
import {MeshoptDecoder} from 'meshoptimizer';
import {extractClipTargets, extractSkeleton} from '../gltf-skeleton.js';
import {analyzeVertexWeights, emptyWeightStats} from '../rig-verify.js';
import type {
  ClipTargets,
  InfluenceSet,
  SkeletonData,
  WeightStats,
} from '../rig-verify.js';

/** Largest built GLB accepted by the check. */
export const MAX_BUILT_BYTES = 64 * 1024 * 1024;

/** Error for unreadable built files. */
export class BuiltReadError extends Error {}

/** Everything `assets:check` needs to know about one built GLB. */
export interface BuiltGlbInfo {
  triangles: number;
  textures: number;
  skeleton: SkeletonData | null;
  /** All vertices scanned (no sampling); null without a skin. */
  weights: WeightStats | null;
  clips: ClipTargets | null;
  /** True when a primitive has a `_REGION` attribute. */
  hasRegion: boolean;
  /** Vertices whose `_REGION` is not a valid `BODY_REGIONS` index (AC-AST-025.3). */
  regionInvalidVertices: number;
}

/** Counts triangles of all mesh primitives (TRIANGLES, STRIP, FAN). */
export function countTriangles(doc: Document): number {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const count = prim.getIndices()?.getCount() ?? pos?.getCount() ?? 0;
      const mode = prim.getMode();
      if (mode === 4) total += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) total += Math.max(0, count - 2);
    }
  }
  return total;
}

function scanWeights(doc: Document, jointCount: number): WeightStats {
  const stats = emptyWeightStats();
  const el = [0, 0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const sets: InfluenceSet[] = [];
      for (let s = 0; ; s++) {
        const j = prim.getAttribute(`JOINTS_${s}`);
        const w = prim.getAttribute(`WEIGHTS_${s}`);
        if (!j || !w) break;
        const n = j.getCount();
        const jf = new Float64Array(n * 4);
        const wf = new Float64Array(n * 4);
        for (let v = 0; v < n; v++) {
          j.getElement(v, el);
          for (let k = 0; k < 4; k++) jf[v * 4 + k] = el[k] ?? 0;
          w.getElement(v, el);
          for (let k = 0; k < 4; k++) wf[v * 4 + k] = el[k] ?? 0;
        }
        sets.push({joints: jf, weights: wf});
      }
      const pos = prim.getAttribute('POSITION');
      if (sets.length === 0 || !pos) continue;
      analyzeVertexWeights(stats, sets, pos.getCount(), jointCount, Infinity);
    }
  }
  return stats;
}

function scanRegion(doc: Document): {has: boolean; invalid: number} {
  let has = false;
  let invalid = 0;
  const el = [0];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute('_REGION');
      if (!acc) continue;
      has = true;
      for (let v = 0; v < acc.getCount(); v++) {
        acc.getElement(v, el);
        const value = el[0] ?? 0;
        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value >= BODY_REGIONS.length
        ) {
          invalid++;
        }
      }
    }
  }
  return {has, invalid};
}

/**
 * Parses a built GLB and collects its statistics.
 *
 * @throws BuiltReadError for oversized, non-GLB or unparsable input.
 */
export async function inspectBuiltGlb(
  bytes: Uint8Array,
): Promise<BuiltGlbInfo> {
  if (bytes.byteLength > MAX_BUILT_BYTES) {
    throw new BuiltReadError(`file exceeds ${MAX_BUILT_BYTES} bytes`);
  }
  if (
    bytes.byteLength < 12 ||
    Buffer.from(bytes.subarray(0, 4)).toString('latin1') !== 'glTF'
  ) {
    throw new BuiltReadError('missing glTF magic bytes');
  }
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({'meshopt.decoder': MeshoptDecoder});
  let doc: Document;
  try {
    doc = await io.readBinary(new Uint8Array(bytes));
  } catch (e) {
    throw new BuiltReadError(
      `cannot parse GLB: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'}`,
    );
  }
  const skeleton = extractSkeleton(doc);
  const region = scanRegion(doc);
  return {
    triangles: countTriangles(doc),
    textures: doc.getRoot().listTextures().length,
    skeleton,
    weights: skeleton ? scanWeights(doc, skeleton.joints.length) : null,
    clips: extractClipTargets(doc),
    hasRegion: region.has,
    regionInvalidVertices: region.invalid,
  };
}
