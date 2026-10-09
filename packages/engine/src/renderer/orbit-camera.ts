/**
 * Orbit camera math of the 3D view mode (spec 009 REQ-UX-003, engine part). Pure and
 * deterministic: the camera is a function of the orbit state only (no time, no randomness), so
 * the same state over the same pose draws the same image.
 */

/** Vertical field of view of the 3D view, in degrees. */
export const ORBIT_FOV_DEG = 30;

/** Pitch limit, in degrees (the camera never flips over the poles). */
export const ORBIT_PITCH_LIMIT_DEG = 85;

/** Extra room around the framed bounding sphere (1 = touching). */
export const ORBIT_FRAME_MARGIN = 1.1;

/** A 3-vector as a tuple. */
export type OrbitVec3 = readonly [number, number, number];

/**
 * Orbit state: the camera looks at `target` from `distance`, at `yawDeg` about +Y (0 = on +Z,
 * where the pixel camera sits) and `pitchDeg` above the horizon.
 */
export interface OrbitState {
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly target: OrbitVec3;
  readonly distance: number;
}

/** The state before any framing: front view, slightly from above, a 1.8 m character at 0.9 m. */
export const DEFAULT_ORBIT_STATE: OrbitState = {
  yawDeg: 0,
  pitchDeg: 10,
  target: [0, 0.9, 0],
  distance: 4,
};

const DEG = Math.PI / 180;

/** `deg` wrapped into `[0, 360)`. */
function wrapDeg(deg: number): number {
  const w = deg % 360;
  return w < 0 ? w + 360 : w === 0 ? 0 : w;
}

/**
 * Turns the orbit: yaw wraps into `[0, 360)`, pitch is clamped to
 * ±{@link ORBIT_PITCH_LIMIT_DEG}. Non-finite deltas are ignored.
 *
 * @param state Current state.
 * @param dYawDeg Yaw change in degrees.
 * @param dPitchDeg Pitch change in degrees.
 * @returns The new state.
 */
export function orbitBy(
  state: OrbitState,
  dYawDeg: number,
  dPitchDeg: number,
): OrbitState {
  const dy = Number.isFinite(dYawDeg) ? dYawDeg : 0;
  const dp = Number.isFinite(dPitchDeg) ? dPitchDeg : 0;
  const pitch = Math.min(
    ORBIT_PITCH_LIMIT_DEG,
    Math.max(-ORBIT_PITCH_LIMIT_DEG, state.pitchDeg + dp),
  );
  return {...state, yawDeg: wrapDeg(state.yawDeg + dy), pitchDeg: pitch};
}

/**
 * Camera position of a state: `target + distance · (sin y cos p, sin p, cos y cos p)`.
 *
 * @param state Orbit state.
 * @returns World position of the camera.
 */
export function orbitEye(state: OrbitState): [number, number, number] {
  return orbitEyeInto(state, [0, 0, 0]);
}

/**
 * {@link orbitEye} into a caller-owned tuple (the per-frame path allocates nothing).
 *
 * @param state Orbit state.
 * @param out Receives the camera position.
 * @returns `out`.
 */
export function orbitEyeInto(
  state: OrbitState,
  out: [number, number, number],
): [number, number, number] {
  const y = state.yawDeg * DEG;
  const p = state.pitchDeg * DEG;
  const d = state.distance;
  out[0] = state.target[0] + d * Math.sin(y) * Math.cos(p);
  out[1] = state.target[1] + d * Math.sin(p);
  out[2] = state.target[2] + d * Math.cos(y) * Math.cos(p);
  return out;
}

/**
 * Frames an axis-aligned box: target = box centre, distance so that the box's bounding sphere
 * fits both the vertical and the horizontal field of view, times {@link ORBIT_FRAME_MARGIN}.
 * An empty or degenerate box keeps the state's target and distance.
 *
 * @param state Current state (yaw and pitch are kept).
 * @param min Box minimum.
 * @param max Box maximum.
 * @param aspect Viewport width / height (> 0).
 * @param fovDeg Vertical field of view (default {@link ORBIT_FOV_DEG}).
 * @returns The framed state.
 */
export function frameBox(
  state: OrbitState,
  min: OrbitVec3,
  max: OrbitVec3,
  aspect: number,
  fovDeg = ORBIT_FOV_DEG,
): OrbitState {
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  if (!(dx >= 0 && dy >= 0 && dz >= 0) || dx + dy + dz === 0) return state;
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
  const halfV = (fovDeg * DEG) / 2;
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const halfH = Math.atan(Math.tan(halfV) * safeAspect);
  const fit = radius / Math.sin(Math.min(halfV, halfH));
  return {
    ...state,
    target: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    distance: fit * ORBIT_FRAME_MARGIN,
  };
}

/**
 * Near clip plane of a state, from its distance (metres).
 *
 * @param state Orbit state.
 * @returns `max(0.01, distance / 100)`.
 */
export function orbitNear(state: OrbitState): number {
  return Math.max(0.01, Math.max(state.distance, 1e-3) / 100);
}

/**
 * Far clip plane of a state, from its distance (metres): wide enough to keep a framed character.
 *
 * @param state Orbit state.
 * @returns `distance · 10 + 10`.
 */
export function orbitFar(state: OrbitState): number {
  return Math.max(state.distance, 1e-3) * 10 + 10;
}

/**
 * Near and far clip planes of a state ({@link orbitNear}, {@link orbitFar}).
 *
 * @param state Orbit state.
 * @returns `[near, far]` in metres.
 */
export function orbitClip(state: OrbitState): [number, number] {
  return [orbitNear(state), orbitFar(state)];
}
