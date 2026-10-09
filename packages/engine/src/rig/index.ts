/**
 * DOM-free rig module (`@csg/engine/rig`). Canonical rig helpers shared by the
 * engine and the Node tools: rest-pose lookup by skeleton group, hierarchy
 * checks, forward kinematics with scales and the quaternion and matrix math
 * under them. The single math source: other modules import it from here. Must
 * not import the DOM, React or `three`.
 */
export {restWorldMatrices, restWorldPositions} from './fk';
export {
  mat4Compose,
  mat4Decompose,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
} from './mat4';
export type {Mat4, Trs} from './mat4';
export {
  QUAT_IDENTITY,
  quatAngle,
  quatDot,
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
} from './quat';
export {checkParentOrder, restPoseForGroup, subtreeJoints} from './rest';
export type {RigRestSource, RigRestTransform} from './rest';
