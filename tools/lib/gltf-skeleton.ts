/**
 * glTF reader for verify-rig (spec 011). Treats files as untrusted input:
 * size cap, magic-byte check, no network access, external buffer URIs are
 * confined to the source file's folder, and image payloads are never read.
 * Uses `@gltf-transform/core` only (no three.js).
 */
import {lstat, readFile} from 'node:fs/promises';
import {dirname, resolve, sep} from 'node:path';
import {Logger, NodeIO} from '@gltf-transform/core';
import {parseJson} from '@csg/parts-schema';
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

function safeDecode(text: string, what: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new SourceReadError(
      'AST_SOURCE_FORMAT',
      `${what} URI has invalid percent-encoding.`,
    );
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
    : new Uint8Array(Buffer.from(safeDecode(body, 'Data')));
}

/** Reads a regular file, refusing symbolic links (the link target is never read). */
async function readRegularFile(
  path: string,
  what: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new SourceReadError(
      'AST_SOURCE_FORMAT',
      `${what} is a symbolic link; refused.`,
    );
  }
  if (!info.isFile()) {
    throw new SourceReadError(
      'AST_SOURCE_READ',
      `${what} is not a regular file.`,
    );
  }
  if (info.size > MAX_SOURCE_BYTES) {
    throw new SourceReadError(
      'AST_SOURCE_READ',
      `${what} exceeds ${MAX_SOURCE_BYTES} bytes.`,
    );
  }
  return new Uint8Array(await readFile(path));
}

async function readLocalResource(
  baseDir: string,
  uri: string,
  what: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    throw new SourceReadError(
      'AST_SOURCE_FORMAT',
      `Remote ${what.toLowerCase()} URI refused: ${uri.slice(0, 40)}`,
    );
  }
  const base = resolve(baseDir);
  const target = resolve(base, safeDecode(uri, what));
  if (!target.startsWith(base + sep)) {
    throw new SourceReadError(
      'AST_SOURCE_FORMAT',
      `${what} URI escapes the source folder.`,
    );
  }
  return readRegularFile(target, what);
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

/**
 * Rejects accessors whose declared size cannot fit in the available binary payload, before any
 * array is allocated from a hostile `count`.
 */
function capAccessorCounts(json: unknown, payloadBytes: number): void {
  const accessors = (json as {accessors?: unknown}).accessors;
  if (!Array.isArray(accessors)) return;
  accessors.forEach((raw, index) => {
    const a = (raw ?? {}) as {
      count?: unknown;
      type?: unknown;
      componentType?: unknown;
    };
    const comps = TYPE_COMPONENTS[String(a.type)] ?? 16;
    const bytes = COMPONENT_BYTES[Number(a.componentType)] ?? 4;
    if (
      typeof a.count !== 'number' ||
      !Number.isInteger(a.count) ||
      a.count < 0 ||
      a.count * comps * bytes > payloadBytes
    ) {
      throw new SourceReadError(
        'AST_SOURCE_FORMAT',
        `accessor ${index} declares ${String(a.count)} elements, more than the file's binary data can hold.`,
      );
    }
  });
}

/** Extracts the JSON chunk of a GLB (bounds checked) or null when malformed. */
function glbJson(bytes: Uint8Array): unknown {
  if (bytes.length < 20) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + len > bytes.length) {
    return null;
  }
  const parsed = parseJson(
    Buffer.from(bytes.subarray(20, 20 + len)).toString('utf8'),
  );
  return parsed.ok ? parsed.value : null;
}

/**
 * Loads a `.gltf` or `.glb` file into a gltf-transform document. External
 * images are replaced by empty stubs (never read); external buffers must live
 * inside the file's folder.
 */
export async function loadGltfDocument(
  absPath: string,
  opts: {
    readImages?: boolean;
    /** Called with the URI of each referenced image file that does not exist. */
    onMissingImage?: (uri: string) => void;
  } = {},
): Promise<Document> {
  const bytes = await readRegularFile(absPath, 'Source file');
  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR));
  if (absPath.toLowerCase().endsWith('.glb')) {
    const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
    if (magic !== 'glTF') {
      throw new SourceReadError(
        'AST_SOURCE_FORMAT',
        'Missing glTF magic bytes.',
      );
    }
    const head = glbJson(bytes);
    if (head !== null) capAccessorCounts(head, bytes.length);
    return io.readBinary(bytes);
  }
  const parsedJson = parseJson(Buffer.from(bytes).toString('utf8'));
  if (!parsedJson.ok) {
    throw new SourceReadError(
      'AST_SOURCE_FORMAT',
      `Invalid glTF JSON: ${parsedJson.issues.map(i => i.message).join('; ')}`,
    );
  }
  const json = parsedJson.value as {
    asset?: {version?: string};
    buffers?: Array<{uri?: string}>;
    images?: Array<{uri?: string}>;
  } | null;
  if (
    !json ||
    typeof json !== 'object' ||
    !json.asset?.version?.startsWith('2')
  ) {
    throw new SourceReadError('AST_SOURCE_FORMAT', 'Not a glTF 2.x document.');
  }
  const baseDir = resolve(dirname(absPath));
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
    resources[uri] = await readLocalResource(baseDir, uri, 'Buffer');
  }
  for (const img of json.images ?? []) {
    if (img.uri && !img.uri.startsWith('data:')) {
      try {
        resources[img.uri] = opts.readImages
          ? await readLocalResource(baseDir, img.uri, 'Image')
          : new Uint8Array(0);
      } catch (e) {
        if ((e as {code?: string}).code !== 'ENOENT') throw e;
        opts.onMissingImage?.(img.uri);
        resources[img.uri] = new Uint8Array(0);
      }
    } else if (img.uri) resources[img.uri] = decodeDataUri(img.uri);
  }
  const total = Object.values(resources).reduce((n, r) => n + r.byteLength, 0);
  capAccessorCounts(json, total);
  const doc = await io.readJSON({json: json as never, resources});
  if (opts.readImages) {
    // Drop textures whose image file is absent from the vendor pack (empty stub).
    for (const tex of doc.getRoot().listTextures()) {
      if ((tex.getImage()?.byteLength ?? 0) === 0) tex.dispose();
    }
  }
  return doc;
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
