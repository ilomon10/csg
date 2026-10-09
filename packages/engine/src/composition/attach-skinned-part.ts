/**
 * Rebinding of skinned parts to the character skeleton (spec 001 REQ-CMP-006,
 * REQ-CMP-037; spec 011 REQ-AST-022/026). Bones are matched by exact joint
 * name; each mesh keeps its own inverse bind matrices, so parts authored on a
 * different skeleton group of the same rig deform correctly.
 */
import {Group, Matrix4, Skeleton, SkinnedMesh} from 'three';
import type {Bone, Object3D} from 'three';
import type {
  AttachSkinnedPart,
  AttachedPart,
  MaterialLinker,
} from '../contracts/composition';
import type {EngineError, Result} from '../contracts/errors';
import {linkMaterial, unlinkMaterial} from './tint-material';

/** M1 behaviour: clones mirror the material of their registry source mesh. */
const DEFAULT_LINKER: MaterialLinker = {
  link: linkMaterial,
  unlink: unlinkMaterial,
};

/** A part joint whose parent differs from the rig's parent of its target bone. */
export interface ParentMismatch {
  /** Part joint name. */
  readonly bone: string;
  /** Rig parent of the target bone (as a part joint name), or `null`. */
  readonly expected: string | null;
  /** Parent joint in the part file, or `null` for a skeleton root. */
  readonly actual: string | null;
}

function isSkinnedMesh(object: Object3D): object is SkinnedMesh {
  return (object as Partial<SkinnedMesh>).isSkinnedMesh === true;
}

function isBone(object: Object3D | null): object is Bone {
  return (object as Partial<Bone> | null)?.isBone === true;
}

function rigMismatch(
  message: string,
  missing: readonly string[],
  parents: readonly ParentMismatch[] = [],
): Result<never, EngineError> {
  const details: Record<string, unknown> = {
    missing: [...new Set(missing)].sort(),
  };
  if (parents.length > 0) details['parents'] = parents;
  return {ok: false, error: {code: 'AST_RIG_MISMATCH', message, details}};
}

/**
 * Rebinds every skinned mesh of a loaded part to the character skeleton
 * (REQ-CMP-037). For each source mesh the function creates a `SkinnedMesh`
 * that shares the source geometry and gets its material from
 * `options.materials` (default: the source material, kept in sync with
 * `linkMaterial`) and binds it to a new `Skeleton` whose bones are the body's
 * bones, in the part's joint order, with the part's own `boneInverses` (the
 * same `Matrix4` objects) and its own bind matrix. The part object is added to
 * `body.root`. The registry-owned part scene is not modified.
 *
 * Structural check (REQ-AST-026): every joint of the part must exist in the
 * body (after `options.boneMap`) and have the rig's parent. Otherwise the
 * result is `AST_RIG_MISMATCH` with `details.missing` (part joint names the
 * body lacks, sorted) and, for hierarchy differences, `details.parents`.
 *
 * @param part - Loaded skinned part.
 * @param body - Character skeleton from `createBodySkeleton`.
 * @param options - Optional bone map (target bone name to part bone name).
 * @returns The attached part, or `AST_RIG_MISMATCH`.
 */
export const attachSkinnedPart: AttachSkinnedPart = (part, body, options) => {
  const partToTarget = new Map<string, string>();
  for (const [target, source] of options?.boneMap ?? [])
    partToTarget.set(source, target);
  const targetOf = (name: string) => partToTarget.get(name) ?? name;
  const partNameOf = (target: string) =>
    options?.boneMap?.get(target) ?? target;

  const sources: SkinnedMesh[] = [];
  part.scene.traverse(object => {
    if (isSkinnedMesh(object)) sources.push(object);
  });
  if (sources.length === 0) {
    return rigMismatch(`part "${part.ref}" has no skinned mesh`, []);
  }

  const missing: string[] = [];
  const parents: ParentMismatch[] = [];
  const checked = new Set<Bone>();
  for (const mesh of sources) {
    for (const bone of mesh.skeleton.bones) {
      if (checked.has(bone)) continue;
      checked.add(bone);
      const target = targetOf(bone.name);
      if (!body.bones.has(target)) {
        missing.push(bone.name);
        continue;
      }
      const rigParent = body.rig.parents[target] ?? null;
      const expected = rigParent === null ? null : partNameOf(rigParent);
      const actual = isBone(bone.parent) ? bone.parent.name : null;
      // A part skeleton may omit ancestors (actual null); a present parent must match.
      if (actual !== null && actual !== expected) {
        parents.push({bone: bone.name, expected, actual});
      }
    }
  }
  if (missing.length > 0 || parents.length > 0) {
    return rigMismatch(
      `part "${part.ref}" does not match the skeleton of rig "${body.rig.id}"`,
      missing,
      parents,
    );
  }

  const linker = options?.materials ?? DEFAULT_LINKER;
  const object = new Group();
  object.name = part.ref;
  part.scene.updateMatrixWorld(true);
  const sceneInverse = new Matrix4().copy(part.scene.matrixWorld).invert();
  const relative = new Matrix4();
  const skeletons = new Map<Skeleton, Skeleton>();
  const clones: Array<{source: SkinnedMesh; clone: SkinnedMesh}> = [];

  for (const source of sources) {
    let skeleton = skeletons.get(source.skeleton);
    if (skeleton === undefined) {
      const bones = source.skeleton.bones.map(bone => {
        const target = body.bones.get(targetOf(bone.name));
        if (target === undefined) throw new Error('unreachable: checked above');
        return target;
      });
      // Own inverse bind matrices: same Matrix4 objects, same order.
      skeleton = new Skeleton(bones, [...source.skeleton.boneInverses]);
      skeletons.set(source.skeleton, skeleton);
    }
    const clone = new SkinnedMesh(source.geometry, source.material);
    clone.name = source.name;
    clone.bindMode = source.bindMode;
    clone.frustumCulled = false;
    clone.renderOrder = source.renderOrder;
    relative.multiplyMatrices(sceneInverse, source.matrixWorld);
    relative.decompose(clone.position, clone.quaternion, clone.scale);
    linker.link(source, clone);
    object.add(clone);
    clone.bind(skeleton, source.bindMatrix);
    clones.push({source, clone});
  }
  body.root.add(object);

  let disposed = false;
  const attached: AttachedPart = {
    ref: part.ref,
    object,
    setVisible(visible: boolean) {
      object.visible = visible;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      for (const {source, clone} of clones) {
        linker.unlink(source, clone);
        object.remove(clone);
      }
      // Geometry, materials and bones are shared; only the skeletons are ours.
      for (const skeleton of skeletons.values()) skeleton.dispose();
    },
  };
  return {ok: true, value: attached};
};
