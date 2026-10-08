/**
 * glTF reader for verify-rig (spec 011). Treats files as untrusted input:
 * size cap, magic-byte check, no network access, external buffer URIs are
 * confined to the source file's folder, and image payloads are never read.
 * Uses `@gltf-transform/core` only (no three.js).
 */
import {readFile, stat} from 'node:fs/promises';
import {dirname, resolve, sep} from 'node:path';
import {NodeIO} from '@gltf-transform/core';
import type {Document} from '@gltf-transform/core';
import type {Node as GltfNode} from '@gltf-transform/core';
import {compose} from './mat4.js';
import type {Quat, Vec3} from './mat4.js';
import {analyzeVertexWeights, emptyWeightStats} from './rig-verify.js';
import type {
  ClipTargets,
  InfluenceSet,
  JointRest,
  RigFileData,
  SkeletonData,
  WeightStats,
} from './rig-verify.js';

/** Maximum source file size accepted by the reader (bytes). */
export const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

/** Error raised for unreadable or malformed source files. */
export class SourceReadError extends Error {
  constructor(
    readonly code: 'AST_SOURCE_FORMAT' | 'AST_SOURCE_READ',
    message: string,
  ) {
    super(message);
    this.name = 'SourceReadError';
  }
}

function decodeDataUri(uri: string): Uint8Array<ArrayBuffer> {
  const comma = uri.indexOf(',');
  if (comma < 0)
    throw new SourceReadError('AST_SOURCE_FORMAT', 'Bad data URI.');
  const meta = uri.slice(0, comma);
  const body = uri.slice(comma + 1);
  return meta.endsWith(';base64')
    ? new Uint8Array(Buffer.from(body, 'base64'))
    : new Uint8Array(Buffer.from(decodeURIComponent(body)));
}

/**
 * Loads a `.gltf` or `.glb` file into a gltf-transform document. External
 * images are replaced by empty stubs (never read); external buffers must live
 * inside the file's folder.
 */
export async function loadGltfDocument(absPath: string): Promise<Document> {
  const info = await stat(absPath);
  if (info.size > MAX_SOURCE_BYTES) {
    throw new SourceReadError(
      'AST_SOURCE_READ',
      `File exceeds ${MAX_SOURCE_BYTES} bytes.`,
    );
  }
  const bytes = new Uint8Array(await readFile(absPath));
  const io = new NodeIO();
  if (absPath.toLowerCase().endsWith('.glb')) {
    const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
    if (magic !== 'glTF') {
      throw new SourceReadError(
        'AST_SOURCE_FORMAT',
        'Missing glTF magic bytes.',
      );
    }
    return io.readBinary(bytes);
  }
  let json: {
    asset?: {version?: string};
    buffers?: Array<{uri?: string}>;
    images?: Array<{uri?: string}>;
  };
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new SourceReadError('AST_SOURCE_FORMAT', 'Invalid glTF JSON.');
  }
  if (
    !json ||
    typeof json !== 'object' ||
    !json.asset?.version?.startsWith('2')
  ) {
    throw new SourceReadError('AST_SOURCE_FORMAT', 'Not a glTF 2.x document.');
  }
  const baseDir = dirname(absPath);
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const buf of json.buffers ?? []) {
    const uri = buf.uri;
    if (!uri) continue;
    if (uri.startsWith('data:')) {
      resources[uri] = decodeDataUri(uri);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
      throw new SourceReadError(
        'AST_SOURCE_FORMAT',
        `Remote buffer URI refused: ${uri.slice(0, 40)}`,
      );
    }
    const target = resolve(baseDir, decodeURIComponent(uri));
    if (!target.startsWith(baseDir + sep)) {
      throw new SourceReadError(
        'AST_SOURCE_FORMAT',
        'Buffer URI escapes the source folder.',
      );
    }
    resources[uri] = new Uint8Array(await readFile(target));
  }
  for (const img of json.images ?? []) {
    if (img.uri && !img.uri.startsWith('data:'))
      resources[img.uri] = new Uint8Array(0);
    else if (img.uri) resources[img.uri] = decodeDataUri(img.uri);
  }
  return io.readJSON({json: json as never, resources});
}

function nodeMatrix(n: GltfNode): number[] {
  return compose(
    n.getTranslation() as Vec3,
    n.getRotation() as Quat,
    n.getScale() as Vec3,
  );
}

/** Extracts the first skin of a document as plain skeleton data. */
export function extractSkeleton(doc: Document): SkeletonData | null {
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) return null;
  const joints = skin.listJoints();
  const jointSet = new Set(joints);
  const rest: JointRest[] = joints.map(n => {
    const p = n.getParentNode();
    return {
      name: n.getName(),
      parent: p && jointSet.has(p) ? p.getName() : null,
      translation: [...n.getTranslation()] as unknown as Vec3,
      rotation: [...n.getRotation()] as unknown as Quat,
      scale: [...n.getScale()] as unknown as Vec3,
    };
  });
  const ibmAcc = skin.getInverseBindMatrices();
  const inverseBind = joints.map((_, i) => {
    if (!ibmAcc) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    return Array.from(ibmAcc.getElement(i, new Array<number>(16).fill(0)));
  });
  // World matrix of the non-joint ancestors of the first root joint.
  let armature = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const rootJoint = joints.find(n => {
    const p = n.getParentNode();
    return !p || !jointSet.has(p);
  });
  const chain: GltfNode[] = [];
  for (let p = rootJoint?.getParentNode() ?? null; p; p = p.getParentNode()) {
    chain.unshift(p);
  }
  for (const n of chain) {
    armature = multiplyMats(armature, nodeMatrix(n));
  }
  return {joints: rest, inverseBind, armatureWorld: armature};
}

function multiplyMats(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++)
        s += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Collects influence and weight statistics from all skinned primitives. */
export function extractWeights(doc: Document, jointCount: number): WeightStats {
  const stats = emptyWeightStats();
  const el = new Array<number>(4).fill(0);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const sets: InfluenceSet[] = [];
      for (let s = 0; ; s++) {
        const j = prim.getAttribute(`JOINTS_${s}`);
        const w = prim.getAttribute(`WEIGHTS_${s}`);
        if (!j || !w) break;
        const count = j.getCount();
        const jf = new Float64Array(count * 4);
        const wf = new Float64Array(count * 4);
        for (let v = 0; v < count; v++) {
          j.getElement(v, el);
          for (let k = 0; k < 4; k++) jf[v * 4 + k] = el[k] ?? 0;
          w.getElement(v, el);
          for (let k = 0; k < 4; k++) wf[v * 4 + k] = el[k] ?? 0;
        }
        sets.push({joints: jf, weights: wf});
      }
      const pos = prim.getAttribute('POSITION');
      if (sets.length === 0 || !pos) continue;
      analyzeVertexWeights(stats, sets, pos.getCount(), jointCount);
      const idx = prim.getIndices();
      stats.triangles += Math.floor(
        (idx ? idx.getCount() : pos.getCount()) / 3,
      );
    }
  }
  return stats;
}

/** Collects the node names targeted by animation channels. */
export function extractClipTargets(doc: Document): ClipTargets | null {
  const anims = doc.getRoot().listAnimations();
  if (anims.length === 0) return null;
  const names = new Set<string>();
  let channels = 0;
  for (const a of anims) {
    for (const ch of a.listChannels()) {
      channels++;
      const t = ch.getTargetNode();
      if (t) names.add(t.getName());
    }
  }
  return {
    clipCount: anims.length,
    channelCount: channels,
    targetNames: [...names].sort(),
  };
}

/** Reads one source file into {@link RigFileData}. */
export async function readRigFile(
  absPath: string,
  file: string,
  packId: string,
): Promise<RigFileData> {
  const doc = await loadGltfDocument(absPath);
  const skeleton = extractSkeleton(doc);
  return {
    file,
    packId,
    skeleton,
    weights: skeleton ? extractWeights(doc, skeleton.joints.length) : null,
    clips: extractClipTargets(doc),
  };
}
