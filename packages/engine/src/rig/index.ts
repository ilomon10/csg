/**
 * DOM-free rig module (`@csg/engine/rig`). Canonical rig helpers shared by the
 * engine and the Node tools: rest-pose lookup by skeleton group, hierarchy
 * checks and forward kinematics with scales. Must not import the DOM, React or
 * `three`.
 */
export {restWorldMatrices} from './fk';
export type {Mat4} from './fk';
export {checkParentOrder, restPoseForGroup, subtreeJoints} from './rest';
export type {RigRestSource, RigRestTransform} from './rest';
