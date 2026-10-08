/**
 * Socket resolution and placement of static props (spec 002 REQ-ANA-007,
 * REQ-ANA-019, REQ-ANA-020).
 *
 * A socket ID (`hand_r`, `head`, ...) is never a joint name: the joint is
 * `rig.socketBones[socketId]`, matched case-sensitively (for example
 * `head` resolves to `Head`). A prop's world transform is
 *
 * ```
 * T(jointPos) * R(jointRot) * S(base * (inheritScale ? anatomy(joint) : 1)) * offset
 * ```
 *
 * where `base` is the world scale of the nearest non-bone ancestor of the joint
 * (the character container, outside anatomy), so anatomy scales of the joint
 * and its ancestors never leak into props that do not inherit scale.
 */
import {Euler, MathUtils, Matrix4, Quaternion, Vector3} from 'three';
import type {Bone, Object3D} from 'three';
import type {PartSocket, RigDefinition, SocketId} from '@csg/parts-schema';
import type {AnatomyScales} from '../contracts/anatomy';
import type {BodySkeleton, UpdateSockets} from '../contracts/composition';
import type {EngineError, Result} from '../contracts/errors';

/** Socket whose props follow the joint's anatomy scale by default (REQ-ANA-007). */
export const SCALE_INHERITING_SOCKET: SocketId = 'head';

/**
 * Whether a prop on `socket` follows its joint's anatomy scale: the explicit
 * `socket.inheritScale`, else true only for socket `head` (REQ-ANA-007).
 *
 * @param socket The part's socket.
 * @returns True when the joint's anatomy scale applies to the prop.
 */
export function socketInheritsScale(socket: PartSocket): boolean {
  return socket.inheritScale ?? socket.bone === SCALE_INHERITING_SOCKET;
}

/**
 * Resolves a socket ID to its joint name through `rig.socketBones`
 * (REQ-ANA-019). Never falls back to the socket ID as a joint name.
 *
 * @param rig The rig definition.
 * @param socketId Semantic socket ID.
 * @returns The joint name, or `AST_RIG_MISMATCH` when the rig does not map the
 *   socket to a joint in `rig.bones`.
 */
export function resolveSocketJoint(
  rig: RigDefinition,
  socketId: SocketId,
): Result<string, EngineError> {
  const joint = (rig.socketBones as Partial<Record<SocketId, string>>)[
    socketId
  ];
  if (joint === undefined || !rig.bones.includes(joint)) {
    return {
      ok: false,
      error: {
        code: 'AST_RIG_MISMATCH',
        message:
          joint === undefined
            ? `rig "${rig.id}" maps no joint for socket "${socketId}"`
            : `rig "${rig.id}" maps socket "${socketId}" to unknown joint "${joint}"`,
        details: {
          socket: socketId,
          missing: joint === undefined ? [] : [joint],
        },
      },
    };
  }
  return {ok: true, value: joint};
}

/**
 * Resolves a socket ID to the character skeleton's bone (REQ-ANA-019,
 * case-sensitive per REQ-ANA-020).
 *
 * @param body The character skeleton.
 * @param socketId Semantic socket ID.
 * @returns The bone, or `AST_RIG_MISMATCH` (`details.missing`) when the joint
 *   is not mapped or not present in the skeleton.
 */
export function resolveSocketBone(
  body: BodySkeleton,
  socketId: SocketId,
): Result<Bone, EngineError> {
  const joint = resolveSocketJoint(body.rig, socketId);
  if (!joint.ok) return joint;
  const bone = body.bones.get(joint.value);
  if (bone === undefined) {
    return {
      ok: false,
      error: {
        code: 'AST_RIG_MISMATCH',
        message: `skeleton has no joint "${joint.value}" for socket "${socketId}"`,
        details: {socket: socketId, missing: [joint.value]},
      },
    };
  }
  return {ok: true, value: bone};
}

/** Placement state of one socketed prop (module-private, keyed by its object). */
export interface SocketBinding {
  /** The part's socket (semantic ID, offset, inheritScale). */
  readonly socket: PartSocket;
  /** The resolved joint (`rig.socketBones[socket.bone]`). */
  readonly joint: string;
  /** The bone the prop object is parented to. */
  readonly bone: Bone;
  /** Composed authored offset (position, XYZ Euler degrees, scale). */
  readonly offset: Matrix4;
  /** Resolved {@link socketInheritsScale}. */
  readonly inheritScale: boolean;
}

const BINDINGS = new WeakMap<Object3D, SocketBinding>();

/**
 * Composes a socket offset into a matrix (Euler order XYZ, degrees).
 *
 * @param offset The authored offset.
 * @param target Matrix to write into.
 * @returns `target`.
 */
export function composeSocketOffset(
  offset: PartSocket['offset'],
  target: Matrix4 = new Matrix4(),
): Matrix4 {
  const [rx, ry, rz] = offset.rotationDeg;
  const q = new Quaternion().setFromEuler(
    new Euler(
      rx * MathUtils.DEG2RAD,
      ry * MathUtils.DEG2RAD,
      rz * MathUtils.DEG2RAD,
      'XYZ',
    ),
  );
  return target.compose(
    new Vector3(...offset.position),
    q,
    new Vector3(...offset.scale),
  );
}

/**
 * Registers `object` (a child of `binding.bone`) as a socketed prop so that
 * {@link placeSocketedProp} and {@link updateSockets} can place it. The object
 * gets `matrixAutoUpdate = false`; its local matrix is computed.
 *
 * @param object The prop's wrapper object.
 * @param binding Its socket binding.
 */
export function bindSocketedProp(
  object: Object3D,
  binding: SocketBinding,
): void {
  object.matrixAutoUpdate = false;
  BINDINGS.set(object, binding);
}

/**
 * Forgets a socketed prop (detach).
 *
 * @param object The prop's wrapper object.
 */
export function unbindSocketedProp(object: Object3D): void {
  BINDINGS.delete(object);
}

/**
 * The socket binding of a prop object, if it is one.
 *
 * @param object A prop wrapper object.
 * @returns Its binding or `undefined`.
 */
export function socketBindingOf(object: Object3D): SocketBinding | undefined {
  return BINDINGS.get(object);
}

// Scratch values: placement allocates nothing per call.
const JOINT_POS = new Vector3();
const JOINT_ROT = new Quaternion();
const JOINT_SCALE = new Vector3();
const BASE_POS = new Vector3();
const BASE_ROT = new Quaternion();
const SCALE = new Vector3();
const WORLD = new Matrix4();
const PARENT_INV = new Matrix4();

function nearestNonBoneAncestor(bone: Bone): Object3D | null {
  let node: Object3D | null = bone.parent;
  while (node !== null && (node as Partial<Bone>).isBone === true) {
    node = node.parent;
  }
  return node;
}

/**
 * Places one socketed prop (REQ-ANA-007): the prop takes its joint's world
 * position and orientation; its scale is the character's base scale times the
 * joint's anatomy scale (`scales.get(joint)`) only where the binding inherits
 * scale. Expects the bone's `matrixWorld` to be current. Writes the object's
 * local `matrix` and `matrixWorld`.
 *
 * @param object A prop wrapper registered with {@link bindSocketedProp}.
 * @param scales Anatomy scales by joint name.
 * @returns False when `object` is not a socketed prop.
 */
export function placeSocketedProp(
  object: Object3D,
  scales: AnatomyScales,
): boolean {
  const binding = BINDINGS.get(object);
  if (binding === undefined) return false;
  binding.bone.matrixWorld.decompose(JOINT_POS, JOINT_ROT, JOINT_SCALE);
  const base = nearestNonBoneAncestor(binding.bone);
  if (base === null) {
    SCALE.set(1, 1, 1);
  } else {
    base.matrixWorld.decompose(BASE_POS, BASE_ROT, SCALE);
  }
  if (binding.inheritScale) {
    const anatomy = scales.get(binding.joint);
    if (anatomy !== undefined) SCALE.multiply(anatomy);
  }
  WORLD.compose(JOINT_POS, JOINT_ROT, SCALE).multiply(binding.offset);
  const parent = object.parent;
  if (parent === null) {
    object.matrix.copy(WORLD);
  } else {
    object.matrix.multiplyMatrices(
      PARENT_INV.copy(parent.matrixWorld).invert(),
      WORLD,
    );
  }
  object.matrixWorldNeedsUpdate = true;
  object.updateMatrixWorld(true);
  return true;
}

/**
 * Pipeline step 5 (REQ-ANA-007): refreshes the skeleton's world matrices once,
 * then keeps every socketed prop at its joint's world position and orientation,
 * applying the joint's anatomy scale only where `inheritScale` holds. Parts in
 * `props` that are not socketed props are ignored. Allocates nothing.
 */
export const updateSockets: UpdateSockets = (body, props, scales) => {
  body.root.updateWorldMatrix(true, true);
  for (const prop of props) placeSocketedProp(prop.object, scales);
};
