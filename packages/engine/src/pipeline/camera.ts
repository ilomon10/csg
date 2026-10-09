/**
 * Export and preview camera of the pixel pipeline (spec 003 REQ-PIX-003,
 * REQ-PIX-004, REQ-PIX-008 A6, REQ-PIX-010; m2-plan 2.1).
 *
 * Convention (shared bit for bit with `sampler/union-bounds.ts`): an
 * orthographic camera looks at the pivot from +Z, raised by the elevation `e`
 * about the X axis. With the pivot at the origin, a world point projects to
 * screen X = `x` and screen Y = `y·cos(e) − z·sin(e)`; screen Y points up. The
 * camera never yaws: directions turn the stage (REQ-PIX-005).
 *
 * The frustum is `Framing.frustum`, whose edges are whole multiples of the
 * world-units-per-pixel size measured from the pivot, so the pivot lies on a
 * pixel corner (A6) and every pixel edge is on the texel grid. The camera
 * position in the camera plane is snapped to that grid as well (REQ-PIX-010).
 *
 * Preset elevations come from `cameraElevationDeg` (framing.ts), which also
 * fills `Framing.elevationDeg`. Pure math plus a three `OrthographicCamera`;
 * no renderer, no DOM.
 */
import {OrthographicCamera, Vector3} from 'three';
import type {Framing} from '../contracts/pipeline';
import {snapToTexel} from './snap';

/** Smallest camera-to-pivot distance in world units. */
export const MIN_CAMERA_DISTANCE = 10;

/**
 * Camera-to-pivot distance as a multiple of the largest frustum extent, so the
 * depth range (`±distance` around the pivot plane) always holds the character.
 */
export const CAMERA_DISTANCE_PER_EXTENT = 4;

const DEG_TO_RAD = Math.PI / 180;

/** A 3D vector as a tuple. */
export type Vec3Tuple = readonly [number, number, number];

/** Orthonormal camera axes in world space for one elevation. */
export interface CameraBasis {
  /** Screen right: `(1, 0, 0)`. */
  readonly right: Vec3Tuple;
  /** Screen up: `(0, cos e, −sin e)`. */
  readonly up: Vec3Tuple;
  /** From the pivot toward the camera: `(0, sin e, cos e)`. */
  readonly back: Vec3Tuple;
}

/**
 * Camera axes for an elevation (REQ-PIX-003). `back` is the opposite of the
 * view direction.
 *
 * @param elevationDeg - Elevation in degrees, 0 (side) to 90 (top-down).
 * @returns The basis.
 */
export function cameraBasis(elevationDeg: number): CameraBasis {
  const e = elevationDeg * DEG_TO_RAD;
  const ce = Math.cos(e);
  const se = Math.sin(e);
  return {right: [1, 0, 0], up: [0, ce, -se], back: [0, se, ce]};
}

/**
 * Projects a world point relative to the pivot into the camera plane, with the
 * exact formula of `projectCorners` (union-bounds) at yaw 0.
 *
 * @param point - World point, pivot at the origin.
 * @param elevationDeg - Camera elevation in degrees.
 * @returns Screen `[x, y]` in world units (y up).
 */
export function projectToCameraPlane(
  point: Vec3Tuple,
  elevationDeg: number,
): [number, number] {
  const e = elevationDeg * DEG_TO_RAD;
  return [point[0], point[1] * Math.cos(e) - point[2] * Math.sin(e)];
}

/**
 * Snaps a world point to the texel grid of the camera plane (REQ-PIX-010): its
 * screen X and Y become whole multiples of `worldPerPx` (ties away from zero,
 * `snapPx`); the coordinate along the view axis is kept.
 *
 * @param point - World point.
 * @param elevationDeg - Camera elevation in degrees.
 * @param worldPerPx - World units per output pixel (> 0).
 * @returns The snapped world point.
 */
export function snapToCameraPlane(
  point: Vec3Tuple,
  elevationDeg: number,
  worldPerPx: number,
): [number, number, number] {
  const {right, up, back} = cameraBasis(elevationDeg);
  const dot = (a: Vec3Tuple) =>
    point[0] * a[0] + point[1] * a[1] + point[2] * a[2];
  const sx = snapToTexel(dot(right), worldPerPx);
  const sy = snapToTexel(dot(up), worldPerPx);
  const sd = dot(back);
  return [
    sx * right[0] + sy * up[0] + sd * back[0],
    sx * right[1] + sy * up[1] + sd * back[1],
    sx * right[2] + sy * up[2] + sd * back[2],
  ];
}

/**
 * Creates the pipeline camera (orthographic; placed by
 * {@link applyCameraFraming}).
 *
 * @returns A new camera named `pixel-camera`.
 */
export function createPixelCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.name = 'pixel-camera';
  return camera;
}

/** Where {@link applyCameraFraming} put the camera. */
export interface CameraPlacement {
  /** Camera-to-pivot-plane distance along the view axis (world units). */
  readonly distance: number;
  /** The snapped pivot the camera looks at (world). */
  readonly pivot: Vec3Tuple;
}

const _axis = new Vector3(1, 0, 0);

/**
 * Places `camera` for a framing (REQ-PIX-003, 007, 008, 010): rotation
 * `−elevation` about X (looks down `−back`, up = `up`), position = snapped
 * pivot + `distance · back`, frustum = `framing.frustum` (pivot-relative,
 * multiples of `worldPerPx`), near 0 and far `2 · distance`. Deterministic:
 * the same framing and pivot give the same 16 matrix floats.
 *
 * @param camera - Camera from {@link createPixelCamera}.
 * @param framing - Framing from `computeFraming`.
 * @param pivot - World position of the ground pivot (default origin); snapped
 *   to the texel grid in the camera plane.
 * @returns The distance (for `setSceneDepth`) and the snapped pivot.
 */
export function applyCameraFraming(
  camera: OrthographicCamera,
  framing: Framing,
  pivot: Vec3Tuple = [0, 0, 0],
): CameraPlacement {
  const {frustum, worldPerPx, elevationDeg} = framing;
  const extent = Math.max(
    Math.abs(frustum.left),
    Math.abs(frustum.right),
    Math.abs(frustum.top),
    Math.abs(frustum.bottom),
  );
  const distance = Math.max(
    MIN_CAMERA_DISTANCE,
    CAMERA_DISTANCE_PER_EXTENT * extent,
  );
  const snapped = snapToCameraPlane(pivot, elevationDeg, worldPerPx);
  const {back} = cameraBasis(elevationDeg);
  camera.quaternion.setFromAxisAngle(_axis, -elevationDeg * DEG_TO_RAD);
  camera.position.set(
    snapped[0] + distance * back[0],
    snapped[1] + distance * back[1],
    snapped[2] + distance * back[2],
  );
  camera.left = frustum.left;
  camera.right = frustum.right;
  camera.top = frustum.top;
  camera.bottom = frustum.bottom;
  camera.near = 0;
  camera.far = 2 * distance;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return {distance, pivot: snapped};
}

const _dir = new Vector3();

/**
 * Elevation of a camera in degrees, measured from its world view direction
 * (AC-PIX-003.1, AC-PIX-003.3): 0 = horizontal, 90 = straight down.
 *
 * @param camera - Any camera (its world matrix must be current).
 * @returns `asin(−dir.y)` in degrees.
 */
export function cameraElevationOf(camera: OrthographicCamera): number {
  camera.getWorldDirection(_dir);
  return Math.asin(Math.max(-1, Math.min(1, -_dir.y))) / DEG_TO_RAD;
}
