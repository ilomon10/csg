/**
 * Build stage 4: skeleton group classification (spec 011 REQ-AST-026).
 *
 * Pure over a gltf-transform `Document`: compares the file's skeleton (bind
 * from inverse bind matrices plus joint rest TRS, or the joint nodes' rest TRS
 * for skinless clip files) with every `rig.skeletonGroups` entry.
 */
import type {Document, Node as GltfNode} from '@gltf-transform/core';
import {extractSkeleton} from '../gltf-skeleton.js';
import {invert} from '../mat4.js';
import type {Quat, Vec3} from '../mat4.js';
import {
  compareSkeletons,
  DEFAULT_TOLERANCES,
  restWorldMatrices,
  safeName,
  skeletonFromGroup,
} from '../rig-verify.js';
import type {
  JointRest,
  RigGroupsView,
  SkeletonComparison,
  SkeletonData,
  Tolerances,
} from '../rig-verify.js';

/** Options of {@link classifySkeleton}. */
export interface ClassifySkeletonOptions {
  /** Part or clip id used in diagnostics. */
  id?: string;
  /** Comparison tolerances (REQ-AST-004 defaults). */
  tolerances?: Tolerances;
}

/** Result of {@link classifySkeleton}. */
export interface ClassifySkeletonResult {
  /** The single matching group; absent when none (or several) match. */
  skeletonGroup?: string;
  /** `AST_SKELETON_GROUP_UNMATCHED` (AC-AST-026.4). */
  warnings: BuildWarning[];
  /** `AST_RIG_MISMATCH` on a structural difference (AC-AST-026.2). */
  errors: BuildWarning[];
}
import type {BuildWarning} from './types.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Rest-pose-only skeleton from the rig-named nodes of a skinless (clip) file. */
function skeletonFromNodes(
  doc: Document,
  boneNames: readonly string[],
): SkeletonData | null {
  const wanted = new Set(boneNames);
  const nodes = new Map<string, GltfNode>();
  for (const n of doc.getRoot().listNodes()) {
    if (wanted.has(n.getName()) && !nodes.has(n.getName())) {
      nodes.set(n.getName(), n);
    }
  }
  if (nodes.size === 0) return null;
  const jointSet = new Set(nodes.values());
  const joints: JointRest[] = [...nodes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]) => {
      const p = n.getParentNode();
      return {
        name,
        parent: p && jointSet.has(p) ? p.getName() : null,
        translation: [...n.getTranslation()] as unknown as Vec3,
        rotation: [...n.getRotation()] as unknown as Quat,
        scale: [...n.getScale()] as unknown as Vec3,
      };
    });
  const root = [...nodes.values()].find(n => {
    const p = n.getParentNode();
    return !p || !jointSet.has(p);
  });
  let armature = IDENTITY;
  const chain: GltfNode[] = [];
  for (let p = root?.getParentNode() ?? null; p; p = p.getParentNode()) {
    chain.unshift(p);
  }
  if (chain.length > 0) {
    // Armature world = FK of the non-joint ancestors.
    const ancestors: JointRest[] = chain.map((n, i) => ({
      name: `a${i}`,
      parent: i === 0 ? null : `a${i - 1}`,
      translation: [...n.getTranslation()] as unknown as Vec3,
      rotation: [...n.getRotation()] as unknown as Quat,
      scale: [...n.getScale()] as unknown as Vec3,
    }));
    armature =
      restWorldMatrices(ancestors, IDENTITY).get(`a${chain.length - 1}`) ??
      IDENTITY;
  }
  const world = restWorldMatrices(joints, armature);
  return {
    joints,
    inverseBind: joints.map(
      j => invert(world.get(j.name) ?? IDENTITY) ?? IDENTITY,
    ),
    armatureWorld: armature,
  };
}

function isPoseOnly(message: string): boolean {
  return (
    message.startsWith('Bind pose') || message.startsWith('Skeleton height')
  );
}

function isStructural(c: SkeletonComparison): boolean {
  return (
    c.missingBones.length > 0 ||
    c.extraBones.length > 0 ||
    c.parentMismatches.length > 0 ||
    c.issues.some(i => i.severity === 'error' && !isPoseOnly(i.message))
  );
}

function isMatch(c: SkeletonComparison): boolean {
  return (
    !isStructural(c) &&
    c.bindPose.length === 0 &&
    c.issues.every(i => i.severity !== 'error')
  );
}

/** Worst delta of a comparison in units of its tolerance (closeness score). */
function score(c: SkeletonComparison, tol: Tolerances): number {
  const m = c.metrics;
  return Math.max(
    Math.max(m.worstBindPosM ?? 0, m.worstRestPosM ?? 0) / tol.posM,
    Math.max(m.worstBindRotRad ?? 0, m.worstRestRotRad ?? 0) / tol.rotRad,
    Math.max(m.worstBindScale ?? 0, m.worstRestScale ?? 0) / tol.scale,
  );
}

/**
 * Classifies a part or clip document into one of the rig's skeleton groups
 * (REQ-AST-026). Exactly one match returns `skeletonGroup`; a structurally
 * compatible file matching no group (or several) returns warning
 * `AST_SKELETON_GROUP_UNMATCHED` naming the part, the closest group and the
 * worst bone (AC-AST-026.4); a structural difference returns an
 * `AST_RIG_MISMATCH` error (AC-AST-026.2).
 *
 * @param doc source part or clip document.
 * @param rig the rig (`bones`, `parents`, `skeletonGroups`).
 * @param opts part id for diagnostics and tolerances.
 */
export function classifySkeleton(
  doc: Document,
  rig: RigGroupsView,
  opts: ClassifySkeletonOptions = {},
): ClassifySkeletonResult {
  const tol = opts.tolerances ?? DEFAULT_TOLERANCES;
  const id = opts.id ?? 'unknown';
  const result: ClassifySkeletonResult = {warnings: [], errors: []};
  const mismatch = (message: string): ClassifySkeletonResult => {
    result.errors.push({
      code: 'AST_RIG_MISMATCH',
      partId: id,
      message: `${safeName(id)}: ${message}`,
    });
    return result;
  };

  const cand = extractSkeleton(doc) ?? skeletonFromNodes(doc, rig.bones);
  if (!cand) return mismatch('no skin or rig joints found.');

  const comparisons: Array<{id: string; cmp: SkeletonComparison}> = [];
  for (const g of [...rig.skeletonGroups].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const ref = skeletonFromGroup(rig, g.id);
    if (ref)
      comparisons.push({id: g.id, cmp: compareSkeletons(ref, cand, tol)});
  }
  const first = comparisons[0];
  if (!first) return mismatch('rig has no complete skeleton group.');
  if (comparisons.every(c => isStructural(c.cmp))) {
    const issues = first.cmp.issues
      .filter(i => i.severity === 'error' && !isPoseOnly(i.message))
      .map(i => i.message);
    return mismatch(`structural rig mismatch: ${issues.slice(0, 5).join(' ')}`);
  }

  const matches = comparisons.filter(c => isMatch(c.cmp));
  if (matches.length === 1 && matches[0]) {
    result.skeletonGroup = matches[0].id;
    return result;
  }
  const candidates =
    matches.length > 1
      ? matches
      : comparisons.filter(c => !isStructural(c.cmp));
  const closest = candidates
    .map(c => ({c, s: score(c.cmp, tol)}))
    .sort((a, b) => a.s - b.s || a.c.id.localeCompare(b.c.id))[0];
  const worstBone = closest?.c.cmp.metrics.worstBone;
  result.warnings.push({
    code: 'AST_SKELETON_GROUP_UNMATCHED',
    partId: id,
    message:
      matches.length > 1
        ? `${safeName(id)} matches several skeleton groups (${matches.map(m => m.id).join(', ')}); no skeletonGroup assigned.`
        : `${safeName(id)} matches no skeleton group; closest ${closest?.c.id ?? 'none'}, worst bone ${worstBone === undefined ? 'n/a' : safeName(worstBone)}.`,
    details: {
      closestGroup: closest?.c.id,
      worstBone,
      ...(matches.length > 1 ? {ambiguous: matches.map(m => m.id)} : {}),
    },
  });
  return result;
}
