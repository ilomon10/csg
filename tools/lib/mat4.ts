/**
 * Plain-array adapters over the engine rig math (`@csg/engine/rig`, the single
 * FK/matrix source). Tools keep glTF-shaped `number[]` matrices; the math
 * itself is not duplicated here.
 */
import {
  mat4Compose,
  mat4Decompose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
} from '@csg/engine/rig';

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
  return Array.from(mat4Identity());
}

/** Multiplies two column-major matrices (a * b). */
export function multiply(a: Mat4, b: Mat4): number[] {
  return Array.from(mat4Multiply(a, b));
}

/** Inverts a general 4x4 matrix; returns null when singular. */
export function invert(m: Mat4): number[] | null {
  const r = mat4Invert(m);
  return r ? Array.from(r) : null;
}

/** Composes a matrix from translation, rotation (xyzw) and scale. */
export function compose(t: Vec3, q: Quat, s: Vec3): number[] {
  return Array.from(mat4Compose(t, q, s));
}

/** Decomposes an affine matrix into translation, rotation and scale. */
export function decompose(m: Mat4): Trs {
  return mat4Decompose(m);
}
