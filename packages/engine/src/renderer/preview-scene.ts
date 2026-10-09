/**
 * The M1 preview scene: one orthographic camera and a stage that turns the
 * character by direction (spec 003 REQ-PIX-005: the model rotates, the camera
 * never moves). No pixel pipeline yet (M2).
 */
import {Group, OrthographicCamera, Scene} from 'three';

/** Direction labels in index order (spec 003 Data & contracts). */
export const DIRECTION_ORDER = [
  'e',
  'ne',
  'n',
  'nw',
  'w',
  'sw',
  's',
  'se',
] as const;

/** A label of {@link DIRECTION_ORDER}. */
export type DirectionLabel = (typeof DIRECTION_ORDER)[number];

/** Yaw step between neighbouring directions, in degrees. */
export const DIRECTION_STEP_DEG = 45;

/**
 * Stage yaw, in radians, that turns a model from its native facing to
 * screen-right (`e`). Built models face +Z (spec 011 REQ-AST-011), which is
 * toward the preview camera (`s`, spec yaw 270°); `Object3D.rotation.y = θ`
 * maps +Z to `(sin θ, 0, cos θ)`, so facing +X (screen-right) needs θ = 90°.
 */
export const MODEL_FORWARD_YAW_OFFSET_RAD = Math.PI / 2;

/** World-space height framed by the preview camera, in meters. */
export const PREVIEW_FRAME_HEIGHT_M = 2.2;

/** Height of the frame center above the ground, in meters. */
export const PREVIEW_FRAME_CENTER_Y_M = 0.95;

/** Distance of the camera from the stage origin, in meters. */
const CAMERA_DISTANCE_M = 10;

/** The preview scene graph. */
export interface PreviewScene {
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  /** Parent of the character; its yaw is the direction. */
  readonly stage: Group;
  /** Frames the camera for a drawing-buffer aspect ratio. */
  setAspect(width: number, height: number): void;
  /**
   * Turns the stage to direction `index`: the model faces `index × 45°`
   * counter-clockwise from screen-right (AC-PIX-005.1); see {@link stageYaw}.
   */
  setDirection(index: number): void;
}

/**
 * Spec yaw in radians of a direction index: `index × 45°` measured
 * counter-clockwise (seen from above) from facing screen-right (`e`),
 * AC-PIX-005.1. This is the facing angle, not the stage rotation; use
 * {@link stageYaw} to turn a +Z-facing model.
 *
 * @param index Integer 0..7 into {@link DIRECTION_ORDER}.
 * @returns The yaw.
 * @throws Error when the index is not an integer in 0..7 (programmer error).
 */
export function directionYaw(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= DIRECTION_ORDER.length)
    throw new Error(`setDirection: index ${index} is not in 0..7`);
  return (index * DIRECTION_STEP_DEG * Math.PI) / 180;
}

/**
 * Stage rotation about +Y, in radians within `[0, 2π)`, that makes a model
 * built facing +Z (REQ-AST-011) face {@link directionYaw}`(index)` with the
 * camera on +Z looking down −Z (screen-right = +X, away from camera = −Z).
 * Index 0 (`e`) faces screen-right, 2 (`n`) faces away, 6 (`s`) faces the
 * camera (AC-PIX-005.1, AC-PIX-005.3).
 *
 * @param index Integer 0..7 into {@link DIRECTION_ORDER}.
 * @returns The stage `rotation.y`.
 * @throws Error when the index is not an integer in 0..7 (programmer error).
 */
export function stageYaw(index: number): number {
  const turn = 2 * Math.PI;
  const yaw = (directionYaw(index) + MODEL_FORWARD_YAW_OFFSET_RAD) % turn;
  return yaw < 0 ? yaw + turn : yaw;
}

/**
 * Creates the preview scene: an orthographic camera on +Z looking at the
 * stage, framing {@link PREVIEW_FRAME_HEIGHT_M} meters around
 * {@link PREVIEW_FRAME_CENTER_Y_M}. The stage starts at direction 0 (`e`).
 * Unlit M1 materials need no lights.
 *
 * @param width Drawing-buffer width in pixels.
 * @param height Drawing-buffer height in pixels.
 * @returns The scene, camera and stage.
 */
export function createPreviewScene(
  width: number,
  height: number,
): PreviewScene {
  const scene = new Scene();
  scene.name = 'preview';
  const stage = new Group();
  stage.name = 'stage';
  // Start at direction 0 (`e`), so a fresh preview matches DIRECTION_ORDER[0].
  stage.rotation.y = stageYaw(0);
  scene.add(stage);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, PREVIEW_FRAME_CENTER_Y_M, CAMERA_DISTANCE_M);
  camera.lookAt(0, PREVIEW_FRAME_CENTER_Y_M, 0);

  const setAspect = (w: number, h: number): void => {
    const half = PREVIEW_FRAME_HEIGHT_M / 2;
    const aspect = h > 0 ? w / h : 1;
    camera.top = half;
    camera.bottom = -half;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.updateProjectionMatrix();
  };
  setAspect(width, height);

  return {
    scene,
    camera,
    stage,
    setAspect,
    setDirection(index: number): void {
      stage.rotation.y = stageYaw(index);
    },
  };
}
