/**
 * DOM-free and three-free retarget module (`@csg/engine/retarget`,
 * REQ-ANM-023). Rest-pose-corrected clip retargeting shared by the engine and
 * the Node tools. Must not import the DOM, React, `three` or `@csg/*`.
 */
export type {
  JointRestTRS,
  Quat,
  RestPose,
  RetargetBone,
  RetargetDrop,
  RetargetError,
  RetargetErrorCode,
  RetargetOptions,
  RetargetPlan,
  RetargetResult,
  TrackData,
  TrackPath,
  Vec3,
} from './types';
export {legLength, restWorldPositions} from './fk';
export {createRetargetPlan} from './plan';
export {retargetTracks} from './tracks';
