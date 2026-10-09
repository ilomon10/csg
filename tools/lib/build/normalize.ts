/**
 * Build stage 3a: normalize a part or clip document to meters, +Y up and the character facing
 * +Z (spec 011 REQ-AST-011). One identical transform per source group; node and bone names and
 * rest-pose local rotations are never edited, only a single correction `C = rotation * uniform
 * scale` is baked into the armature root, the vertex data and the inverse bind matrices so the
 * skinned result equals `C` applied to the source pose.
 */
import type {Accessor, Document, Node} from '@gltf-transform/core';
import {compose, decompose, identity, invert, multiply} from '../mat4.js';
import type {Mat4, Quat, Vec3} from '../mat4.js';
import type {BuildWarning} from './types.js';

/** Axis the source treats as up. */
export type SourceUp = 'y' | 'z';
/** Direction the source character faces. */
export type SourceFacing = '+z' | '-z' | '+x' | '-x';

/** Parameters of the normalization (taken from the M1-S rig report; identity when it found no issue). */
export interface NormalizeOptions {
  /** Multiplier from source units to meters (0.01 for centimeters). Default 1. */
  unitScale?: number;
  /** Source up axis. Default `y`. */
  up?: SourceUp;
  /** Source facing direction. Default `+z`. */
  facing?: SourceFacing;
}

/** Outcome of {@link normalizeDocument}. */
export interface NormalizeResult {
  /** False when the document was already normalized and left untouched. */
  applied: boolean;
  /** Uniform scale baked in. */
  scale: number;
  /** Rotation quaternion baked in (`xyzw`). */
  rotation: Quat;
  warnings: BuildWarning[];
}

const EPS = 1e-9;

function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function axisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

function transformPoint(m: Mat4, v: Vec3): Vec3 {
  const g = (i: number) => m[i] ?? 0;
  return [
    g(0) * v[0] + g(4) * v[1] + g(8) * v[2] + g(12),
    g(1) * v[0] + g(5) * v[1] + g(9) * v[2] + g(13),
    g(2) * v[0] + g(6) * v[1] + g(10) * v[2] + g(14),
  ];
}

function isIdentity(m: Mat4): boolean {
  const id = identity();
  return id.every((v, i) => Math.abs(v - (m[i] ?? 0)) < 1e-9);
}

function upRotation(up: SourceUp): Quat {
  // Z-up to Y-up: rotate -90 degrees about X (z -> y, y -> -z).
  return up === 'z' ? axisAngle([1, 0, 0], -Math.PI / 2) : [0, 0, 0, 1];
}

function facingRotation(facing: SourceFacing): Quat {
  const yaw = {'+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2}[
    facing
  ];
  return axisAngle([0, 1, 0], yaw);
}

function isQuatIdentity(q: Quat): boolean {
  return Math.abs(q[0]) < EPS && Math.abs(q[1]) < EPS && Math.abs(q[2]) < EPS;
}

function localMatrix(node: Node): number[] {
  return compose(node.getTranslation(), node.getRotation(), node.getScale());
}

function setLocal(node: Node, t: Vec3, r: Quat, s: Vec3): void {
  node.setTranslation([t[0], t[1], t[2]]);
  node.setRotation([r[0], r[1], r[2], r[3]]);
  node.setScale([s[0], s[1], s[2]]);
}

function ancestorsOf(node: Node): Node[] {
  const out: Node[] = [];
  let p = node.getParentNode();
  while (p) {
    out.push(p);
    p = p.getParentNode();
  }
  return out;
}

/**
 * Normalizes `doc` in place to meters, +Y up, facing +Z. Idempotent for already-normalized
 * input (defaults are the identity and then nothing is touched).
 */
export function normalizeDocument(
  doc: Document,
  opts: NormalizeOptions = {},
): NormalizeResult {
  const warnings: BuildWarning[] = [];
  const k = opts.unitScale ?? 1;
  if (!(k > 0) || !Number.isFinite(k)) {
    throw new RangeError(`normalize: unitScale must be > 0, got ${k}.`);
  }
  const q = quatMul(
    facingRotation(opts.facing ?? '+z'),
    upRotation(opts.up ?? 'y'),
  );
  const rotIdentity = isQuatIdentity(q);
  const root = doc.getRoot();

  // Joints and their roots (joints whose parent is not a joint of the same skin).
  const joints = new Set<Node>();
  const skinRoots = new Set<Node>();
  for (const skin of root.listSkins()) {
    const own = new Set(skin.listJoints());
    for (const j of own) {
      joints.add(j);
      const p = j.getParentNode();
      if (!p || !own.has(p)) skinRoots.add(j);
    }
  }
  const armatureAncestors = new Set<Node>();
  for (const r of skinRoots) {
    for (const a of ancestorsOf(r)) {
      if (!joints.has(a)) armatureAncestors.add(a);
    }
  }
  const bakesArmature = [...armatureAncestors].some(
    a => !isIdentity(a.getWorldMatrix()),
  );
  if (k === 1 && rotIdentity && !bakesArmature) {
    return {applied: false, scale: 1, rotation: [0, 0, 0, 1], warnings};
  }

  const C = compose([0, 0, 0], q, [k, k, k]);
  const Cinv = invert(C) ?? identity();

  // Original bind-time world matrices of all joints, before any edit.
  const worldBefore = new Map<Node, number[]>();
  for (const j of joints) worldBefore.set(j, [...j.getWorldMatrix()]);

  // Per-root correction matrix M and its uniform scale / rotation, used for animation too.
  const rootCorrection = new Map<Node, {m: number[]; q: Quat; s: number}>();
  const sortedRoots = [...skinRoots].sort(byName);
  for (const r of sortedRoots) {
    const parent = r.getParentNode();
    const a = parent ? [...parent.getWorldMatrix()] : identity();
    const m = multiply(C, a);
    const dm = decompose(m);
    const s = Math.cbrt(Math.abs(dm.scale[0] * dm.scale[1] * dm.scale[2]));
    if (Math.max(...dm.scale.map(v => Math.abs(v - s))) > 1e-4 * s) {
      const armature = parent && !joints.has(parent) ? parent : r;
      warnings.push({
        code: 'AST_NORMALIZE_NONUNIFORM',
        message: `Armature "${armature.getName()}" (root joint "${r.getName()}") has a non-uniform scale; the mean scale was baked.`,
      });
    }
    rootCorrection.set(r, {m, q: dm.rotation, s});
    const lm = multiply(m, localMatrix(r));
    const dl = decompose(lm);
    setLocal(r, dl.translation, dl.rotation, r.getScale());
  }
  for (const a of armatureAncestors)
    setLocal(a, [0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);

  // Non-root joints: translations scale with the baked scale of their armature.
  for (const j of [...joints].sort(byName)) {
    if (skinRoots.has(j)) continue;
    let s = k;
    for (const r of skinRoots) {
      if (isDescendant(j, r)) s = rootCorrection.get(r)?.s ?? k;
    }
    const t = j.getTranslation();
    j.setTranslation([t[0] * s, t[1] * s, t[2] * s]);
  }

  // Static top-level nodes (no skin, not part of an armature) get C as a node transform.
  const staticRoots = new Set<Node>();
  for (const scene of root.listScenes()) {
    for (const n of scene.listChildren()) {
      if (joints.has(n) || armatureAncestors.has(n) || n.getSkin()) continue;
      staticRoots.add(n);
      const dm = decompose(multiply(C, localMatrix(n)));
      setLocal(n, dm.translation, dm.rotation, dm.scale);
    }
  }

  // Skinned vertex data: v' = C v (rotation for normals/tangents).
  const done = new Set<Accessor>();
  const mapAccessor = (
    acc: Accessor | null,
    fn: (v: Vec3) => Vec3,
    size = 3,
  ): void => {
    if (!acc || done.has(acc)) return;
    done.add(acc);
    const el = new Array<number>(acc.getElementSize()).fill(0);
    for (let i = 0; i < acc.getCount(); i++) {
      acc.getElement(i, el);
      const out = fn([el[0] ?? 0, el[1] ?? 0, el[2] ?? 0]);
      for (let c = 0; c < size; c++) el[c] = out[c] ?? 0;
      acc.setElement(i, el);
    }
  };
  const pos = (v: Vec3): Vec3 => {
    const r = rotateVec(q, v);
    return [r[0] * k, r[1] * k, r[2] * k];
  };
  const dir = (v: Vec3): Vec3 => rotateVec(q, v);
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !node.getSkin()) continue;
    for (const prim of mesh.listPrimitives()) {
      mapAccessor(prim.getAttribute('POSITION'), pos);
      mapAccessor(prim.getAttribute('NORMAL'), dir);
      mapAccessor(prim.getAttribute('TANGENT'), dir);
      for (const target of prim.listTargets()) {
        mapAccessor(target.getAttribute('POSITION'), pos);
        mapAccessor(target.getAttribute('NORMAL'), dir);
        mapAccessor(target.getAttribute('TANGENT'), dir);
      }
    }
  }

  // Inverse bind matrices: IBM' = inv(W') * C * W * IBM * C^-1.
  const ibmDone = new Set<Accessor>();
  for (const skin of root.listSkins()) {
    const js = skin.listJoints();
    let acc = skin.getInverseBindMatrices();
    if (!acc) {
      acc = doc
        .createAccessor()
        .setType('MAT4')
        .setArray(new Float32Array(js.length * 16));
      for (let i = 0; i < js.length; i++) acc.setElement(i, identity());
      skin.setInverseBindMatrices(acc);
    } else if (ibmDone.has(acc)) continue;
    ibmDone.add(acc);
    const m = new Array<number>(16).fill(0);
    js.forEach((j, i) => {
      acc.getElement(i, m);
      const wAfter = [...j.getWorldMatrix()];
      const invAfter = invert(wAfter);
      const wBefore = worldBefore.get(j);
      if (!invAfter || !wBefore) return;
      const x = multiply(invAfter, multiply(C, wBefore));
      acc.setElement(i, multiply(x, multiply(m, Cinv)));
    });
  }

  // Animation targets.
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const out = ch.getSampler()?.getOutput();
      if (!node || !out) continue;
      const rc = rootCorrection.get(node);
      const isStaticRoot = staticRoots.has(node);
      const el = new Array<number>(out.getElementSize()).fill(0);
      for (let i = 0; i < out.getCount(); i++) {
        out.getElement(i, el);
        if (path === 'translation') {
          let r: Vec3;
          if (rc)
            r = transformPoint(rc.m, [el[0] ?? 0, el[1] ?? 0, el[2] ?? 0]);
          else if (isStaticRoot)
            r = transformPoint(C, [el[0] ?? 0, el[1] ?? 0, el[2] ?? 0]);
          else {
            const s = jointScale(node, skinRoots, rootCorrection, k);
            r = [(el[0] ?? 0) * s, (el[1] ?? 0) * s, (el[2] ?? 0) * s];
          }
          el[0] = r[0];
          el[1] = r[1];
          el[2] = r[2];
        } else if (path === 'rotation' && (rc || isStaticRoot)) {
          const r = quatMul(rc?.q ?? q, [
            el[0] ?? 0,
            el[1] ?? 0,
            el[2] ?? 0,
            el[3] ?? 1,
          ]);
          el[0] = r[0];
          el[1] = r[1];
          el[2] = r[2];
          el[3] = r[3];
        } else if (path === 'scale' && isStaticRoot) {
          el[0] = (el[0] ?? 1) * k;
          el[1] = (el[1] ?? 1) * k;
          el[2] = (el[2] ?? 1) * k;
        } else continue;
        out.setElement(i, el);
      }
    }
  }
  return {applied: true, scale: k, rotation: q, warnings};
}

function byName(a: Node, b: Node): number {
  return a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0;
}

function isDescendant(node: Node, ancestor: Node): boolean {
  for (let p: Node | null = node; p; p = p.getParentNode()) {
    if (p === ancestor) return true;
  }
  return false;
}

function jointScale(
  node: Node,
  roots: Set<Node>,
  corr: Map<Node, {s: number}>,
  fallback: number,
): number {
  for (const r of roots)
    if (isDescendant(node, r)) return corr.get(r)?.s ?? fallback;
  return fallback;
}
