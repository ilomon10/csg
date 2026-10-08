/**
 * Minimal quaternion and vector helpers (glTF `[x, y, z, w]` order). Pure,
 * allocation per call only; hot loops in `tracks.ts` inline the math instead.
 */
import type {Quat, Vec3} from './types';

/** The identity quaternion. */
export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

/**
 * Hamilton product `a · b` (apply `b` first, then `a`).
 *
 * @param a - Left quaternion.
 * @param b - Right quaternion.
 * @returns The product.
 */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Inverse of a quaternion (conjugate divided by the squared norm).
 *
 * @param q - Quaternion; a zero quaternion yields the identity.
 * @returns `q⁻¹`.
 */
export function quatInvert(q: Quat): Quat {
  const [x, y, z, w] = q;
  const n2 = x * x + y * y + z * z + w * w;
  if (n2 === 0) return QUAT_IDENTITY;
  return [-x / n2, -y / n2, -z / n2, w / n2];
}

/**
 * Normalizes a quaternion with `Math.sqrt` (bit-exact across engines).
 *
 * @param q - Quaternion; a zero quaternion yields the identity.
 * @returns The unit quaternion.
 */
export function quatNormalize(q: Quat): Quat {
  const [x, y, z, w] = q;
  const n = Math.sqrt(x * x + y * y + z * z + w * w);
  if (n === 0) return QUAT_IDENTITY;
  return [x / n, y / n, z / n, w / n];
}

/**
 * Four-component dot product.
 *
 * @param a - First quaternion.
 * @param b - Second quaternion.
 * @returns `a · b`.
 */
export function quatDot(a: Quat, b: Quat): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/**
 * Rotation angle in radians between two orientations, sign-agnostic
 * (`q` and `-q` are equal). Uses `atan2` so tiny angles stay accurate.
 *
 * @param a - First quaternion.
 * @param b - Second quaternion.
 * @returns Angle in `[0, π]`.
 */
export function quatAngle(a: Quat, b: Quat): number {
  const [x, y, z, w] = quatMultiply(
    quatInvert(quatNormalize(a)),
    quatNormalize(b),
  );
  return 2 * Math.atan2(Math.sqrt(x * x + y * y + z * z), Math.abs(w));
}

/**
 * Rotates a vector by a unit quaternion.
 *
 * @param q - Unit quaternion.
 * @param v - Vector.
 * @returns `q · v · q⁻¹`.
 */
export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 · (u × v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
