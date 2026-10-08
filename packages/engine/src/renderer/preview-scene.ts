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
  /** Turns the stage to direction `index` (yaw `index × 45°`). */
  setDirection(index: number): void;
}

/**
 * Yaw in radians of a direction index (`index × 45°`, REQ-PIX-005).
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
 * Creates the preview scene: an orthographic camera on +Z looking at the
 * stage, framing {@link PREVIEW_FRAME_HEIGHT_M} meters around
 * {@link PREVIEW_FRAME_CENTER_Y_M}. Unlit M1 materials need no lights.
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
      stage.rotation.y = directionYaw(index);
    },
  };
}
