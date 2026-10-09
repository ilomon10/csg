/**
 * Attaches static props to sockets (spec 002 REQ-ANA-007, REQ-ANA-019; spec 001
 * static part fields `socket.bone`, `socket.offset`, `socket.inheritScale`).
 */
import {Group} from 'three';
import type {Mesh, Object3D, Vector3} from 'three';
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
import {linkMaterial, unlinkMaterial} from './tint-material';

const NO_ANATOMY: AnatomyScales = new Map<string, Vector3>();

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/**
 * Pairs the meshes of `source` with those of its deep clone (`Object3D.clone`
 * keeps the child order, so a parallel traversal matches them).
 */
function meshPairs(
  source: Object3D,
  clone: Object3D,
): Array<{source: Mesh; clone: Mesh}> {
  const sources: Mesh[] = [];
  const clones: Mesh[] = [];
  source.traverse(o => {
    if (isMesh(o)) sources.push(o);
  });
  clone.traverse(o => {
    if (isMesh(o)) clones.push(o);
  });
  if (sources.length !== clones.length) {
    throw new Error('attachStaticPart: clone does not mirror the part scene');
  }
  return sources.map((s, i) => ({source: s, clone: clones[i] as Mesh}));
}

/**
 * Attaches a static part to the joint `body.rig.socketBones[socket.bone]`
 * (REQ-ANA-019) with the socket's offset. The part scene is cloned (geometry
 * and materials stay shared with the registry cache; each cloned mesh is linked
 * to its source mesh with `linkMaterial`, so a later `applyTintMaterial` or
 * `restoreMaterials` on the part scene, such as the pixel-pipeline toon
 * re-tint, reaches the prop too) into a wrapper group named
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
  const clone = part.scene.clone(true);
  const pairs = meshPairs(part.scene, clone);
  for (const pair of pairs) linkMaterial(pair.source, pair.clone);
  wrapper.add(clone);
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
      for (const pair of pairs) unlinkMaterial(pair.source, pair.clone);
      wrapper.removeFromParent();
      wrapper.clear();
    },
  };
  return {ok: true, value: attached};
};
