import type {RestPose, Vec3} from '../retarget/types';

/** A column-major 4x4 matrix (the three.js layout), double precision. */
export type Mat4 = Float64Array;

/**
 * Composes `T * R * S` into a column-major matrix (same math as three.js
 * `Matrix4.compose`).
 */
function compose(
  t: Vec3,
  q: readonly [number, number, number, number],
  s: Vec3,
): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0];
  m[1] = (xy + wz) * s[0];
  m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1];
  m[5] = (1 - (xx + zz)) * s[1];
  m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2];
  m[9] = (yz - wx) * s[2];
  m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

/** `a * b` for column-major matrices. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * World matrices of every joint by forward kinematics over the local rest TRS
 * (REQ-ANA-003, REQ-ANA-008). Rotation-aware and non-uniform-scale-aware, unlike
 * `restWorldPositions` of `@csg/engine/retarget`. Joints must be ordered
 * parent-before-child.
 *
 * @param rest - Rest pose of one skeleton group.
 * @param localScales - Optional per-joint factors multiplied into the local
 *   rest scale (anatomy scales, keyed by exact joint name).
 * @returns Joint name to column-major world matrix, in joint order.
 * @throws Error when a joint names a parent that does not precede it.
 */
export function restWorldMatrices(
  rest: RestPose,
  localScales?: ReadonlyMap<string, Vec3>,
): ReadonlyMap<string, Mat4> {
  const world = new Map<string, Mat4>();
  for (const j of rest.joints) {
    const f = localScales?.get(j.name);
    const s: Vec3 = f
      ? [j.scale[0] * f[0], j.scale[1] * f[1], j.scale[2] * f[2]]
      : j.scale;
    const local = compose(j.translation, j.rotation, s);
    if (j.parent === null) {
      world.set(j.name, local);
      continue;
    }
    const p = world.get(j.parent);
    if (!p) {
      throw new Error(
        `restWorldMatrices: joint "${j.name}" of "${rest.id}" has parent "${j.parent}" that does not precede it`,
      );
    }
    world.set(j.name, multiply(p, local));
  }
  return world;
}
