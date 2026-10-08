/** Retarget plan construction (REQ-ANM-023, m1-plan section 2.6). */
import {legLength} from './fk';
import {quatInvert, quatMultiply, quatNormalize} from '../rig';
import type {
  JointRestTRS,
  RestPose,
  RetargetBone,
  RetargetOptions,
  RetargetPlan,
  RetargetResult,
  Vec3,
} from './types';

/** Tolerance below which a leg length counts as degenerate. */
const MIN_LEG_LENGTH = 1e-6;

/** Tolerance of the {@link RetargetPlan.identity} test. */
const IDENTITY_EPS = 1e-7;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mismatch(
  message: string,
  missing: Iterable<string>,
): RetargetResult<RetargetPlan> {
  const list = [...new Set(missing)].sort(compareCodeUnits);
  return {ok: false, error: {code: 'AST_RIG_MISMATCH', message, missing: list}};
}

/**
 * Builds the retarget plan from a source (clip) rest pose to a target
 * (character) rest pose: per mapped bone `pre = q_tRest · q_sRest⁻¹`, and
 * `k = L_t / L_s` where L is the rest pelvis height above the lowest foot.
 *
 * @param source - Rest pose of the clip's skeleton group.
 * @param target - Rest pose of the character's skeleton group.
 * @param opts - Hip, root and foot bones and an optional bone map.
 * @returns The plan, or `AST_RIG_MISMATCH` with `missing` when a hip, root or
 *   foot bone is absent on either side, or a leg length is at most 1e-6.
 */
export function createRetargetPlan(
  source: RestPose,
  target: RestPose,
  opts: RetargetOptions,
): RetargetResult<RetargetPlan> {
  const srcJoints = new Map<string, JointRestTRS>();
  for (const j of source.joints) srcJoints.set(j.name, j);
  const tgtJoints = new Map<string, JointRestTRS>();
  for (const j of target.joints) tgtJoints.set(j.name, j);
  const mapBone = (t: string): string | undefined =>
    opts.boneMap ? opts.boneMap.get(t) : t;

  const missing: string[] = [];
  const required = [opts.hipBone, opts.rootBone, ...opts.footBones];
  const sourceFeet: string[] = [];
  for (const t of required) {
    if (!tgtJoints.has(t)) missing.push(t);
    const s = mapBone(t);
    if (s === undefined) missing.push(t);
    else if (!srcJoints.has(s)) missing.push(s);
  }
  if (missing.length > 0) {
    return mismatch(
      `retarget "${source.id}" -> "${target.id}": required bones missing`,
      missing,
    );
  }
  if (opts.footBones.length === 0) {
    return mismatch('retarget: no foot bones given', []);
  }
  for (const f of opts.footBones) sourceFeet.push(mapBone(f) as string);
  const hipSource = mapBone(opts.hipBone) as string;
  const rootSource = mapBone(opts.rootBone) as string;

  const legT = legLength(target, opts.hipBone, opts.footBones);
  const legS = legLength(source, hipSource, sourceFeet);
  if (!(legT > MIN_LEG_LENGTH) || !(legS > MIN_LEG_LENGTH)) {
    return mismatch(
      `retarget "${source.id}" -> "${target.id}": leg length at most ${MIN_LEG_LENGTH} (source ${legS}, target ${legT})`,
      [],
    );
  }
  const k = legT / legS;

  const bones: RetargetBone[] = [];
  let allIdentity = true;
  for (const tj of target.joints) {
    const s = mapBone(tj.name);
    const sj = s === undefined ? undefined : srcJoints.get(s);
    if (!sj) continue;
    const pre = quatNormalize(
      quatMultiply(
        quatNormalize(tj.rotation),
        quatInvert(quatNormalize(sj.rotation)),
      ),
    );
    // Canonical sign (w >= 0) so the identity test and output are stable.
    const preRotation =
      pre[3] < 0 ? ([-pre[0], -pre[1], -pre[2], -pre[3]] as const) : pre;
    if (
      Math.abs(preRotation[0]) > IDENTITY_EPS ||
      Math.abs(preRotation[1]) > IDENTITY_EPS ||
      Math.abs(preRotation[2]) > IDENTITY_EPS
    ) {
      allIdentity = false;
    }
    bones.push({target: tj.name, source: sj.name, preRotation});
  }
  bones.sort((a, b) => compareCodeUnits(a.target, b.target));

  const copy = (v: Vec3): Vec3 => [v[0], v[1], v[2]];
  const hipS = srcJoints.get(hipSource) as JointRestTRS;
  const hipT = tgtJoints.get(opts.hipBone) as JointRestTRS;
  const rootS = srcJoints.get(rootSource) as JointRestTRS;
  const rootT = tgtJoints.get(opts.rootBone) as JointRestTRS;
  return {
    ok: true,
    value: {
      sourceId: source.id,
      targetId: target.id,
      legLengthRatio: k,
      bones,
      hip: {
        target: opts.hipBone,
        source: hipSource,
        sourceRest: copy(hipS.translation),
        targetRest: copy(hipT.translation),
      },
      root: {
        target: opts.rootBone,
        source: rootSource,
        sourceRest: copy(rootS.translation),
        targetRest: copy(rootT.translation),
      },
      identity:
        source.id === target.id ||
        (allIdentity && Math.abs(k - 1) <= IDENTITY_EPS),
    },
  };
}
