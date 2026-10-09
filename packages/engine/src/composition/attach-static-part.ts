/**
 * Attaches static props to sockets (spec 002 REQ-ANA-007, REQ-ANA-019; spec 001
 * static part fields `socket.bone`, `socket.offset`, `socket.inheritScale`).
 */
import {Group} from 'three';
import type {Vector3} from 'three';
import type {AnatomyScales} from '../contracts/anatomy';
import type {AttachStaticPart, AttachedPart} from '../contracts/composition';
import {
  bindSocketedProp,
  composeSocketOffset,
  placeSocketedProp,
  resolveSocketBone,
  socketInheritsScale,
  unbindSocketedProp,
} from './sockets';

const NO_ANATOMY: AnatomyScales = new Map<string, Vector3>();

/**
 * Attaches a static part to the joint `body.rig.socketBones[socket.bone]`
 * (REQ-ANA-019) with the socket's offset. The part scene is cloned (geometry
 * and materials stay shared with the registry cache) into a wrapper group named
 * `socket:<socketId>` that is parented to the joint, so the prop follows the
 * pose; the wrapper's matrix is computed (see `placeSocketedProp`) and is
 * refreshed under anatomy by `updateSockets` (REQ-ANA-007). It is placed here
 * without anatomy scale.
 *
 * A socket that does not resolve to a joint of the skeleton yields
 * `AST_RIG_MISMATCH` (`details.missing`). Passing a part whose `kind` is not
 * `static` is a programmer error and throws.
 *
 * `dispose()` detaches the prop and forgets its binding; it is idempotent and
 * never disposes the shared geometry or materials, which the registry owns.
 */
export const attachStaticPart: AttachStaticPart = (part, body, socket) => {
  if (part.entry.kind !== 'static') {
    throw new Error(
      `attachStaticPart: part "${part.ref}" is ${part.entry.kind}, expected static`,
    );
  }
  const bone = resolveSocketBone(body, socket.bone);
  if (!bone.ok) return bone;

  const wrapper = new Group();
  wrapper.name = `socket:${socket.bone}`;
  wrapper.add(part.scene.clone(true));
  bindSocketedProp(wrapper, {
    socket,
    joint: body.rig.socketBones[socket.bone],
    bone: bone.value,
    offset: composeSocketOffset(socket.offset),
    inheritScale: socketInheritsScale(socket),
  });
  bone.value.add(wrapper);
  bone.value.updateWorldMatrix(true, false);
  placeSocketedProp(wrapper, NO_ANATOMY);

  let disposed = false;
  const attached: AttachedPart = {
    ref: part.ref,
    object: wrapper,
    setVisible(visible: boolean): void {
      wrapper.visible = visible;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unbindSocketedProp(wrapper);
      wrapper.removeFromParent();
      wrapper.clear();
    },
  };
  return {ok: true, value: attached};
};
