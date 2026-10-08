/**
 * Minimal column-major 4x4 matrix and quaternion helpers (glTF layout).
 * Pure functions, no dependencies, so tools stay free of three.js.
 */

/** A 16-element column-major matrix. */
export type Mat4 = readonly number[];
/** Quaternion as [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];
/** 3-component vector. */
export type Vec3 = readonly [number, number, number];

/** Decomposed transform. */
export interface Trs {
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
}

/** Returns the identity matrix. */
export function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Multiplies two column-major matrices (a * b). */
export function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** Inverts a general 4x4 matrix; returns null when singular. */
export function invert(m: Mat4): number[] | null {
  const a = (i: number) => m[i] ?? 0;
  const a00 = a(0),
    a01 = a(1),
    a02 = a(2),
    a03 = a(3);
  const a10 = a(4),
    a11 = a(5),
    a12 = a(6),
    a13 = a(7);
  const a20 = a(8),
    a21 = a(9),
    a22 = a(10),
    a23 = a(11);
  const a30 = a(12),
    a31 = a(13),
    a32 = a(14),
    a33 = a(15);
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  det = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}

/** Composes a matrix from translation, rotation (xyzw) and scale. */
export function compose(t: Vec3, q: Quat, s: Vec3): number[] {
  const [x, y, z, w] = q;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0],
    (xy + wz) * s[0],
    (xz - wy) * s[0],
    0,
    (xy - wz) * s[1],
    (1 - (xx + zz)) * s[1],
    (yz + wx) * s[1],
    0,
    (xz + wy) * s[2],
    (yz - wx) * s[2],
    (1 - (xx + yy)) * s[2],
    0,
    t[0],
    t[1],
    t[2],
    1,
  ];
}

/** Decomposes an affine matrix into translation, rotation and scale. */
export function decompose(m: Mat4): Trs {
  const g = (i: number) => m[i] ?? 0;
  const sx = Math.hypot(g(0), g(1), g(2));
  const sy = Math.hypot(g(4), g(5), g(6));
  let sz = Math.hypot(g(8), g(9), g(10));
  const det =
    g(0) * (g(5) * g(10) - g(6) * g(9)) -
    g(4) * (g(1) * g(10) - g(2) * g(9)) +
    g(8) * (g(1) * g(6) - g(2) * g(5));
  const signedSx = det < 0 ? -sx : sx;
  if (sz === 0) sz = 1e-30;
  const isx = signedSx === 0 ? 1 : 1 / signedSx;
  const isy = sy === 0 ? 1 : 1 / sy;
  const isz = 1 / sz;
  const m00 = g(0) * isx,
    m01 = g(1) * isx,
    m02 = g(2) * isx;
  const m10 = g(4) * isy,
    m11 = g(5) * isy,
    m12 = g(6) * isy;
  const m20 = g(8) * isz,
    m21 = g(9) * isz,
    m22 = g(10) * isz;
  // Rotation matrix (column-major columns m0*, m1*, m2*) to quaternion.
  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m12 - m21) / s;
    qy = (m20 - m02) / s;
    qz = (m01 - m10) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m12 - m21) / s;
    qx = 0.25 * s;
    qy = (m10 + m01) / s;
    qz = (m20 + m02) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m20 - m02) / s;
    qx = (m10 + m01) / s;
    qy = 0.25 * s;
    qz = (m21 + m12) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m01 - m10) / s;
    qx = (m20 + m02) / s;
    qy = (m21 + m12) / s;
    qz = 0.25 * s;
  }
  return {
    translation: [g(12), g(13), g(14)],
    rotation: [qx, qy, qz, qw],
    scale: [signedSx, sy, sz],
  };
}

/** Smallest rotation angle in radians between two unit quaternions. */
export function quatAngle(a: Quat, b: Quat): number {
  // relative = conj(a) * b ; angle = 2 * atan2(|xyz|, |w|), stable for tiny angles.
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const w = aw * bw + ax * bx + ay * by + az * bz;
  const x = aw * bx - ax * bw - ay * bz + az * by;
  const y = aw * by + ax * bz - ay * bw - az * bx;
  const z = aw * bz - ax * by + ay * bx - az * bw;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
}

/** Euclidean distance between two vectors. */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Largest absolute component difference between two vectors. */
export function maxAbsDiff(a: Vec3, b: Vec3): number {
  return Math.max(
    Math.abs(a[0] - b[0]),
    Math.abs(a[1] - b[1]),
    Math.abs(a[2] - b[2]),
  );
}
