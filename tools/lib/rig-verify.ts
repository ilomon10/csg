/**
 * Pure rig-verification logic for `pnpm assets:verify-rig` (spec 011,
 * REQ-AST-003..008). No file I/O and no glTF parsing happens here; the reader
 * in `gltf-skeleton.ts` turns files into the plain data types below.
 */
import {SOCKET_IDS} from '@csg/parts-schema';
import {
  compose,
  decompose,
  distance,
  invert,
  maxAbsDiff,
  multiply,
  quatAngle,
} from './mat4.js';
import type {Quat, Vec3} from './mat4.js';

/** Default tolerances (REQ-AST-004). */
export const DEFAULT_TOLERANCES: Tolerances = {
  posM: 1e-4,
  rotRad: 1e-3,
  scale: 1e-4,
};

/** Comparison tolerances: position in metres, rotation in radians, scale. */
export interface Tolerances {
  posM: number;
  rotRad: number;
  scale: number;
}

/** One skin joint with its rest (local) transform. */
export interface JointRest {
  name: string;
  /** Name of the parent joint, or null when the parent is not a joint. */
  parent: string | null;
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
}

/** Skeleton extracted from one skin. */
export interface SkeletonData {
  /** Joints in skin order. */
  joints: JointRest[];
  /** Inverse bind matrices (column-major), aligned with `joints`. */
  inverseBind: number[][];
  /** World matrix of the non-joint ancestors of the root joint (armature). */
  armatureWorld: number[];
}

/** Aggregated vertex-weight statistics for one file. */
export interface WeightStats {
  vertices: number;
  sampled: number;
  triangles: number;
  maxInfluences: number;
  /** Sampled vertices whose weight sum deviates from 1 by more than 1e-3. */
  unnormalizedVertices: number;
  maxSumDeviation: number;
  /** Sampled vertices referencing a joint index outside the skin. */
  badJointIndexVertices: number;
}

/** Animation targets of one file. */
export interface ClipTargets {
  clipCount: number;
  channelCount: number;
  /** Distinct node names targeted by channels, sorted. */
  targetNames: string[];
}

/** Everything the reader extracts from one source file. */
export interface RigFileData {
  /** Path relative to the source root. */
  file: string;
  packId: string;
  /** Null when the file has no skin. */
  skeleton: SkeletonData | null;
  weights: WeightStats | null;
  clips: ClipTargets | null;
}

/** Report issue (spec 011 `RigReport`). */
export interface RigIssue {
  severity: 'info' | 'warn' | 'error';
  code: string;
  message: string;
}

/** Per-bone bind/rest deltas. */
export interface BindPoseDelta {
  bone: string;
  maxPosDelta: number;
  maxRotDelta: number;
  maxScaleDelta: number;
}

/** One report row (spec 011 `RigReport.items[]`, plus optional `metrics`). */
export interface RigReportItem {
  file: string;
  packId: string;
  kind: 'skinned-mesh' | 'animation';
  status: 'pass' | 'warn' | 'fail';
  jointCount: number;
  missingBones: string[];
  extraBones: string[];
  parentMismatches: Array<{
    bone: string;
    expected: string | null;
    actual: string | null;
  }>;
  bindPose: BindPoseDelta[];
  issues: RigIssue[];
  suggestedBoneMap?: Record<string, string | null>;
  /** Additive to spec 011: worst deltas and weight stats for readers. */
  metrics?: ItemMetrics;
  /** Additive (M1-S2): id of the declared skeleton group the file matches (REQ-AST-026). */
  skeletonGroup?: string;
}

/** Additive metrics attached to a report item. */
export interface ItemMetrics {
  skeletonHeightM?: number;
  worstBindPosM?: number;
  worstBindPosHeightFraction?: number;
  worstBindRotRad?: number;
  worstBindRotDeg?: number;
  worstBindScale?: number;
  worstRestPosM?: number;
  worstRestRotRad?: number;
  worstRestScale?: number;
  worstBone?: string;
  lengthAxis?: LengthAxis;
  weights?: WeightStats;
  clipCount?: number;
  channelCount?: number;
}

/** Local axis along which bone length runs. */
export type LengthAxis = 'x' | 'y' | 'z';

/** Rig outcome (REQ-AST-007). */
export type RigOutcome = 'shared' | 'mapped' | 'fallback';

/** Machine-readable report (spec 011 `RigReport`, with additive fields). */
export interface RigReport {
  format: 'sprite-rig-report';
  version: 1;
  canonicalRig: string;
  tolerances: Tolerances;
  toolVersions: Record<string, string>;
  summary: {pass: number; warn: number; fail: number};
  /** Additive: REQ-AST-007 outcome. */
  outcome: RigOutcome;
  /** Additive: reference file the others were compared with. */
  referenceFile: string;
  /** Additive: files grouped by identical skeleton (names, parents, bind pose). */
  skeletonGroups: SkeletonGroup[];
  items: RigReportItem[];
}

/** Files that share one skeleton within tolerance. */
export interface SkeletonGroup {
  /** Stable skeleton group id (`superhero-m`, ...), or `skeleton-N` for ad-hoc grouping. */
  id: string;
  /** Group containing the reference file. */
  isReference: boolean;
  files: string[];
  /** Worst deltas of the group's representative against the reference. */
  vsReference: {
    bonesOverTolerance: number;
    maxPosM: number;
    maxPosHeightFraction: number;
    maxRotDeg: number;
    maxScale: number;
  };
}

/** Replaces control characters so untrusted names are safe to print. */
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 96);
}

/** Computes world-space bind joint matrices from inverse bind matrices. */
export function bindWorldMatrices(
  skeleton: SkeletonData,
): Array<number[] | null> {
  return skeleton.inverseBind.map(ibm => invert(ibm));
}

/** Skeleton height: extent of bind-pose joint positions along +Y. */
export function skeletonHeight(skeleton: SkeletonData): number {
  let min = Infinity;
  let max = -Infinity;
  for (const w of bindWorldMatrices(skeleton)) {
    if (!w) continue;
    const y = w[13] ?? 0;
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return Number.isFinite(min) ? max - min : 0;
}

/**
 * Derives the bone length axis by majority vote over the dominant axis of each
 * child's rest translation (expressed in its parent's local frame).
 */
export function deriveLengthAxis(joints: readonly JointRest[]): {
  axis: LengthAxis;
  votes: Record<LengthAxis, number>;
} {
  const votes: Record<LengthAxis, number> = {x: 0, y: 0, z: 0};
  for (const j of joints) {
    if (j.parent === null) continue;
    const [x, y, z] = j.translation.map(Math.abs) as [number, number, number];
    if (Math.max(x, y, z) < 1e-6) continue;
    if (x >= y && x >= z) votes.x++;
    else if (y >= z) votes.y++;
    else votes.z++;
  }
  const axis: LengthAxis =
    votes.y >= votes.x && votes.y >= votes.z
      ? 'y'
      : votes.x >= votes.z
        ? 'x'
        : 'z';
  return {axis, votes};
}

/** Input arrays for {@link analyzeVertexWeights}: flat, 4 components per vertex. */
export interface InfluenceSet {
  joints: ArrayLike<number>;
  weights: ArrayLike<number>;
}

/** Empty weight statistics. */
export function emptyWeightStats(): WeightStats {
  return {
    vertices: 0,
    sampled: 0,
    triangles: 0,
    maxInfluences: 0,
    unnormalizedVertices: 0,
    maxSumDeviation: 0,
    badJointIndexVertices: 0,
  };
}

/**
 * Accumulates influence-count and weight-normalization statistics for one
 * primitive into `stats`. Samples at most `maxSamples` vertices (uniform
 * stride) so huge meshes stay cheap.
 */
export function analyzeVertexWeights(
  stats: WeightStats,
  sets: readonly InfluenceSet[],
  vertexCount: number,
  jointCount: number,
  maxSamples = 50000,
): void {
  const stride = Math.max(1, Math.ceil(vertexCount / maxSamples));
  stats.vertices += vertexCount;
  for (let v = 0; v < vertexCount; v += stride) {
    stats.sampled++;
    let sum = 0;
    let count = 0;
    let bad = false;
    for (const set of sets) {
      for (let k = 0; k < 4; k++) {
        const w = set.weights[v * 4 + k] ?? 0;
        if (w > 1e-6) {
          count++;
          sum += w;
          const j = set.joints[v * 4 + k] ?? 0;
          if (j < 0 || j >= jointCount) bad = true;
        }
      }
    }
    if (bad) stats.badJointIndexVertices++;
    stats.maxInfluences = Math.max(stats.maxInfluences, count);
    const dev = Math.abs(sum - 1);
    stats.maxSumDeviation = Math.max(stats.maxSumDeviation, dev);
    if (dev > 1e-3) stats.unnormalizedVertices++;
  }
}

/** Suggests a bone map for extra bones by case/punctuation-insensitive match. */
export function suggestBoneMap(
  missing: readonly string[],
  extra: readonly string[],
): Record<string, string | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNorm = new Map<string, string>();
  for (const m of missing) byNorm.set(norm(m), m);
  const out: Record<string, string | null> = {};
  for (const e of [...extra].sort()) out[e] = byNorm.get(norm(e)) ?? null;
  return out;
}

function trsDeltas(
  a: {translation: Vec3; rotation: Quat; scale: Vec3},
  b: {translation: Vec3; rotation: Quat; scale: Vec3},
) {
  return {
    pos: distance(a.translation, b.translation),
    rot: quatAngle(a.rotation, b.rotation),
    scale: maxAbsDiff(a.scale, b.scale),
  };
}

/** Result of comparing one skeleton with the reference. */
export interface SkeletonComparison {
  missingBones: string[];
  extraBones: string[];
  parentMismatches: RigReportItem['parentMismatches'];
  bindPose: BindPoseDelta[];
  issues: RigIssue[];
  metrics: ItemMetrics;
}

/**
 * Compares `cand` against `ref`: bone set, parents, world-space bind pose
 * (from inverse bind matrices), rest-pose local transforms, armature root and
 * length axis (REQ-AST-003 a-g).
 */
export function compareSkeletons(
  ref: SkeletonData,
  cand: SkeletonData,
  tol: Tolerances,
): SkeletonComparison {
  const issues: RigIssue[] = [];
  const refNames = new Set(ref.joints.map(j => j.name));
  const candNames = new Set(cand.joints.map(j => j.name));
  const missingBones = [...refNames].filter(n => !candNames.has(n)).sort();
  const extraBones = [...candNames].filter(n => !refNames.has(n)).sort();
  if (candNames.size !== cand.joints.length) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: 'Duplicate joint names in skin.',
    });
  }
  if (missingBones.length > 0) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Missing bones (${missingBones.length}): ${missingBones.slice(0, 8).map(safeName).join(', ')}`,
    });
  }
  if (extraBones.length > 0) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Extra bones (${extraBones.length}): ${extraBones.slice(0, 8).map(safeName).join(', ')}`,
    });
  }
  if (ref.joints.length !== cand.joints.length) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Joint count ${cand.joints.length}, expected ${ref.joints.length}.`,
    });
  }

  const refIdx = new Map(ref.joints.map((j, i) => [j.name, i]));
  const candIdx = new Map(cand.joints.map((j, i) => [j.name, i]));
  const refWorld = bindWorldMatrices(ref);
  const candWorld = bindWorldMatrices(cand);
  const height = skeletonHeight(ref);

  const parentMismatches: RigReportItem['parentMismatches'] = [];
  const bindPose: BindPoseDelta[] = [];
  const metrics: ItemMetrics = {
    skeletonHeightM: skeletonHeight(cand),
    worstBindPosM: 0,
    worstBindRotRad: 0,
    worstBindScale: 0,
    worstRestPosM: 0,
    worstRestRotRad: 0,
    worstRestScale: 0,
  };
  let worstScore = -1;
  const common = [...refIdx.keys()].filter(n => candIdx.has(n)).sort();
  for (const name of common) {
    const ri = refIdx.get(name) as number;
    const ci = candIdx.get(name) as number;
    const rj = ref.joints[ri];
    const cj = cand.joints[ci];
    if (!rj || !cj) continue;
    if (rj.parent !== cj.parent) {
      parentMismatches.push({
        bone: name,
        expected: rj.parent,
        actual: cj.parent,
      });
    }
    let pos = 0;
    let rot = 0;
    let scl = 0;
    const rw = refWorld[ri];
    const cw = candWorld[ci];
    if (!cw || !rw) {
      issues.push({
        severity: 'error',
        code: 'AST_RIG_MISMATCH',
        message: `Singular inverse bind matrix for ${safeName(name)}.`,
      });
      continue;
    }
    const d = trsDeltas(decompose(rw), decompose(cw));
    pos = d.pos;
    rot = d.rot;
    scl = d.scale;
    metrics.worstBindPosM = Math.max(metrics.worstBindPosM ?? 0, d.pos);
    metrics.worstBindRotRad = Math.max(metrics.worstBindRotRad ?? 0, d.rot);
    metrics.worstBindScale = Math.max(metrics.worstBindScale ?? 0, d.scale);
    const r = trsDeltas(rj, cj);
    metrics.worstRestPosM = Math.max(metrics.worstRestPosM ?? 0, r.pos);
    metrics.worstRestRotRad = Math.max(metrics.worstRestRotRad ?? 0, r.rot);
    metrics.worstRestScale = Math.max(metrics.worstRestScale ?? 0, r.scale);
    const maxPos = Math.max(pos, r.pos);
    const maxRot = Math.max(rot, r.rot);
    const maxScale = Math.max(scl, r.scale);
    const score = Math.max(
      maxPos / tol.posM,
      maxRot / tol.rotRad,
      maxScale / tol.scale,
    );
    if (score > worstScore) {
      worstScore = score;
      metrics.worstBone = name;
    }
    if (score > 1) {
      bindPose.push({
        bone: name,
        maxPosDelta: maxPos,
        maxRotDelta: maxRot,
        maxScaleDelta: maxScale,
      });
    }
  }
  if (parentMismatches.length > 0) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Parent mismatch on ${parentMismatches.length} bone(s), first: ${parentMismatches
        .slice(0, 3)
        .map(
          p =>
            `${safeName(p.bone)} (expected ${p.expected ?? 'none'}, got ${p.actual ?? 'none'})`,
        )
        .join('; ')}`,
    });
  }
  for (const b of bindPose.slice(0, 5)) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Bind pose differs on ${safeName(b.bone)}: pos ${b.maxPosDelta.toExponential(2)} m, rot ${b.maxRotDelta.toExponential(2)} rad, scale ${b.maxScaleDelta.toExponential(2)}.`,
    });
  }
  if (bindPose.length > 5) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Bind pose differs on ${bindPose.length - 5} more bone(s); see bindPose.`,
    });
  }

  // Armature root transform, unit scale and up axis (e).
  const ad = trsDeltas(
    decompose(ref.armatureWorld),
    decompose(cand.armatureWorld),
  );
  if (ad.pos > tol.posM || ad.rot > tol.rotRad || ad.scale > tol.scale) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Armature root transform differs: pos ${ad.pos.toExponential(2)} m, rot ${ad.rot.toExponential(2)} rad, scale ${ad.scale.toExponential(2)}.`,
    });
  }
  if (
    height > 0 &&
    Math.abs((metrics.skeletonHeightM ?? 0) / height - 1) > 1e-3
  ) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Skeleton height ${(metrics.skeletonHeightM ?? 0).toFixed(4)} m, expected ${height.toFixed(4)} m (unit scale or up axis).`,
    });
  }

  // Length axis (g).
  const refAxis = deriveLengthAxis(ref.joints).axis;
  const candAxis = deriveLengthAxis(cand.joints).axis;
  metrics.lengthAxis = candAxis;
  if (refAxis !== candAxis) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Bone length axis '${candAxis}', expected '${refAxis}'.`,
    });
  }

  metrics.worstBindPosHeightFraction =
    height > 0 ? (metrics.worstBindPosM ?? 0) / height : 0;
  metrics.worstBindRotDeg = ((metrics.worstBindRotRad ?? 0) * 180) / Math.PI;

  if (bindPose.length === 0) {
    issues.push({
      severity: 'info',
      code: 'AST_BIND_POSE_WITHIN_TOLERANCE',
      message: `Worst bind delta ${(metrics.worstBindPosM ?? 0).toExponential(2)} m (${(metrics.worstBindPosHeightFraction * 100).toExponential(2)} % of height), ${metrics.worstBindRotDeg.toExponential(2)} deg; worst rest-pose delta ${(metrics.worstRestPosM ?? 0).toExponential(2)} m, ${(metrics.worstRestRotRad ?? 0).toExponential(2)} rad.`,
    });
  }
  return {
    missingBones,
    extraBones,
    parentMismatches,
    bindPose,
    issues,
    metrics,
  };
}

/** Checks influence counts and weight normalization (REQ-AST-016, role rules). */
export function checkWeights(stats: WeightStats): RigIssue[] {
  const issues: RigIssue[] = [];
  if (stats.maxInfluences > 4) {
    issues.push({
      severity: 'error',
      code: 'AST_BUDGET_INFLUENCES',
      message: `Up to ${stats.maxInfluences} influences per vertex (max 4).`,
    });
  }
  if (stats.unnormalizedVertices > 0) {
    issues.push({
      severity: stats.maxSumDeviation > 1e-2 ? 'error' : 'warn',
      code: 'AST_WEIGHTS_UNNORMALIZED',
      message: `${stats.unnormalizedVertices} of ${stats.sampled} sampled vertices have weight sums off by up to ${stats.maxSumDeviation.toExponential(2)}.`,
    });
  }
  if (stats.badJointIndexVertices > 0) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `${stats.badJointIndexVertices} sampled vertices reference a joint outside the skin.`,
    });
  }
  return issues;
}

/** Checks that every animation channel targets a canonical bone (REQ-AST-003 h). */
export function checkClipTargets(
  canonical: ReadonlySet<string>,
  clips: ClipTargets,
): {extra: string[]; coverage: number; issues: RigIssue[]} {
  const extra = clips.targetNames.filter(n => !canonical.has(n)).sort();
  const covered = clips.targetNames.filter(n => canonical.has(n)).length;
  const issues: RigIssue[] = [];
  if (extra.length > 0) {
    issues.push({
      severity: 'error',
      code: 'AST_RIG_MISMATCH',
      message: `Animation channels target ${extra.length} non-canonical node(s): ${extra.slice(0, 8).map(safeName).join(', ')}`,
    });
  }
  issues.push({
    severity: 'info',
    code: 'AST_CLIP_TARGETS',
    message: `${clips.clipCount} clips, ${clips.channelCount} channels, ${covered} distinct canonical bones animated.`,
  });
  return {extra, coverage: covered, issues};
}

function statusOf(issues: readonly RigIssue[]): RigReportItem['status'] {
  if (issues.some(i => i.severity === 'error')) return 'fail';
  if (issues.some(i => i.severity === 'warn')) return 'warn';
  return 'pass';
}

/** Builds the report items for one file (skinned-mesh and/or animation). */
export function verifyFile(
  ref: SkeletonData,
  data: RigFileData,
  tol: Tolerances,
): RigReportItem[] {
  const items: RigReportItem[] = [];
  const canonical = new Set(ref.joints.map(j => j.name));
  if (data.skeleton) {
    const cmp = compareSkeletons(ref, data.skeleton, tol);
    const issues = [...cmp.issues];
    const metrics: ItemMetrics = {...cmp.metrics};
    if (data.weights) {
      issues.push(...checkWeights(data.weights));
      metrics.weights = data.weights;
    }
    const item: RigReportItem = {
      file: data.file,
      packId: data.packId,
      kind: 'skinned-mesh',
      status: statusOf(issues),
      jointCount: data.skeleton.joints.length,
      missingBones: cmp.missingBones,
      extraBones: cmp.extraBones,
      parentMismatches: cmp.parentMismatches,
      bindPose: cmp.bindPose,
      issues,
      metrics,
    };
    if (cmp.extraBones.length > 0) {
      item.suggestedBoneMap = suggestBoneMap(cmp.missingBones, cmp.extraBones);
    }
    items.push(item);
  }
  if (data.clips && data.clips.clipCount > 0) {
    const c = checkClipTargets(canonical, data.clips);
    const item: RigReportItem = {
      file: data.file,
      packId: data.packId,
      kind: 'animation',
      status: statusOf(c.issues),
      jointCount: data.skeleton?.joints.length ?? 0,
      missingBones: [],
      extraBones: c.extra,
      parentMismatches: [],
      bindPose: [],
      issues: c.issues,
      metrics: {
        clipCount: data.clips.clipCount,
        channelCount: data.clips.channelCount,
      },
    };
    if (c.extra.length > 0) {
      item.suggestedBoneMap = suggestBoneMap(
        [...canonical].filter(n => !data.clips?.targetNames.includes(n)),
        c.extra,
      );
    }
    items.push(item);
  }
  return items;
}

/**
 * Decides the REQ-AST-007 outcome: `shared` when nothing fails, `mapped` when
 * every failing bone-name difference has a suggested mapping, else `fallback`.
 */
export function decideOutcome(items: readonly RigReportItem[]): RigOutcome {
  const failing = items.filter(i => i.status === 'fail');
  if (failing.length === 0) return 'shared';
  for (const i of failing) {
    const map = i.suggestedBoneMap ?? {};
    const unmapped = i.extraBones.filter(
      e => map[e] === null || map[e] === undefined,
    );
    const missingUnmapped = i.missingBones.filter(
      m => !Object.values(map).includes(m),
    );
    if (
      i.kind === 'skinned-mesh' &&
      (unmapped.length > 0 || missingUnmapped.length > 0)
    ) {
      return 'fallback';
    }
    if (i.kind === 'animation' && unmapped.length > 0) return 'fallback';
  }
  return 'mapped';
}

/** Builds the full report from items. Items are sorted for determinism. */
export function buildReport(args: {
  canonicalRig: string;
  tolerances: Tolerances;
  toolVersions: Record<string, string>;
  referenceFile: string;
  skeletonGroups?: SkeletonGroup[];
  items: RigReportItem[];
}): RigReport {
  const items = [...args.items].sort(
    (a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind),
  );
  const summary = {pass: 0, warn: 0, fail: 0};
  for (const i of items) summary[i.status]++;
  return {
    format: 'sprite-rig-report',
    version: 1,
    canonicalRig: args.canonicalRig,
    tolerances: args.tolerances,
    toolVersions: args.toolVersions,
    summary,
    outcome: decideOutcome(items),
    referenceFile: args.referenceFile,
    skeletonGroups: args.skeletonGroups ?? [],
    items,
  };
}

/**
 * Greedily groups skeletons whose names, parents and bind poses agree within
 * tolerance. The first group is the one containing `reference`.
 */
export function groupSkeletons(
  reference: {file: string; skeleton: SkeletonData},
  others: ReadonlyArray<{file: string; skeleton: SkeletonData}>,
  tol: Tolerances,
): SkeletonGroup[] {
  const height = skeletonHeight(reference.skeleton);
  const groups: Array<{rep: SkeletonData; files: string[]}> = [
    {rep: reference.skeleton, files: [reference.file]},
  ];
  for (const o of [...others].sort((a, b) => a.file.localeCompare(b.file))) {
    if (o.file === reference.file) continue;
    const g = groups.find(x => {
      const c = compareSkeletons(x.rep, o.skeleton, tol);
      return (
        c.bindPose.length === 0 &&
        c.missingBones.length === 0 &&
        c.extraBones.length === 0 &&
        c.parentMismatches.length === 0
      );
    });
    if (g) g.files.push(o.file);
    else groups.push({rep: o.skeleton, files: [o.file]});
  }
  return groups.map((g, i) => {
    const c = compareSkeletons(reference.skeleton, g.rep, tol);
    const maxPos = c.metrics.worstBindPosM ?? 0;
    return {
      id: `skeleton-${i + 1}`,
      isReference: i === 0,
      files: g.files,
      vsReference: {
        bonesOverTolerance: c.bindPose.length,
        maxPosM: maxPos,
        maxPosHeightFraction: height > 0 ? maxPos / height : 0,
        maxRotDeg: ((c.metrics.worstBindRotRad ?? 0) * 180) / Math.PI,
        maxScale: c.metrics.worstBindScale ?? 0,
      },
    };
  });
}

/** True when `cand` has the same structure as `ref` and a rest/bind pose within tolerance. */
export function skeletonsMatch(
  ref: SkeletonData,
  cand: SkeletonData,
  tol: Tolerances,
): boolean {
  const c = compareSkeletons(ref, cand, tol);
  return (
    c.bindPose.length === 0 &&
    c.missingBones.length === 0 &&
    c.extraBones.length === 0 &&
    c.parentMismatches.length === 0 &&
    c.issues.every(i => i.severity !== 'error')
  );
}

/** Ids of every declared group whose representative matches `skeleton`. */
export function matchSkeletonGroups(
  groups: ReadonlyArray<{id: string; skeleton: SkeletonData}>,
  skeleton: SkeletonData,
  tol: Tolerances,
): string[] {
  return groups
    .filter(g => skeletonsMatch(g.skeleton, skeleton, tol))
    .map(g => g.id);
}

/**
 * Groups files by the declared skeleton groups (REQ-AST-026). Groups appear in
 * declaration order, the default group first. Files matching no group or more
 * than one are returned in `unmatched` and belong to no group.
 */
export function groupBySkeletonGroups(
  reference: SkeletonData,
  declared: readonly SkeletonGroupInput[],
  defaultId: string,
  files: ReadonlyArray<{file: string; skeleton: SkeletonData}>,
  tol: Tolerances,
): {
  groups: SkeletonGroup[];
  fileGroup: Map<string, string>;
  unmatched: Array<{file: string; matches: string[]}>;
} {
  const ordered = [
    ...declared.filter(g => g.id === defaultId),
    ...declared.filter(g => g.id !== defaultId),
  ];
  const height = skeletonHeight(reference);
  const members = new Map<string, string[]>(ordered.map(g => [g.id, []]));
  const fileGroup = new Map<string, string>();
  const unmatched: Array<{file: string; matches: string[]}> = [];
  for (const f of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
    const m = matchSkeletonGroups(ordered, f.skeleton, tol);
    if (m.length === 1 && m[0] !== undefined) {
      members.get(m[0])?.push(f.file);
      fileGroup.set(f.file, m[0]);
    } else {
      unmatched.push({file: f.file, matches: m});
    }
  }
  const groups = ordered.map(g => {
    const c = compareSkeletons(reference, g.skeleton, tol);
    const maxPos = c.metrics.worstBindPosM ?? 0;
    return {
      id: g.id,
      isReference: g.id === defaultId,
      files: members.get(g.id) ?? [],
      vsReference: {
        bonesOverTolerance: c.bindPose.length,
        maxPosM: maxPos,
        maxPosHeightFraction: height > 0 ? maxPos / height : 0,
        maxRotDeg: ((c.metrics.worstBindRotRad ?? 0) * 180) / Math.PI,
        maxScale: c.metrics.worstBindScale ?? 0,
      },
    };
  });
  return {groups, fileGroup, unmatched};
}

/**
 * Annotates the items of each file with its skeleton group: an info issue
 * `AST_SKELETON_GROUP` when matched, a warning `AST_SKELETON_GROUP_UNMATCHED`
 * (AC-AST-026.4) when the rest pose matches no declared group.
 */
export function annotateSkeletonGroups(
  items: RigReportItem[],
  fileGroup: ReadonlyMap<string, string>,
  unmatched: ReadonlyArray<{file: string; matches: string[]}>,
): void {
  const bad = new Map(unmatched.map(u => [u.file, u.matches]));
  for (const item of items) {
    const g = fileGroup.get(item.file);
    if (g !== undefined) {
      item.skeletonGroup = g;
      item.issues.push({
        severity: 'info',
        code: 'AST_SKELETON_GROUP',
        message: `Skeleton group ${g}.`,
      });
    } else if (bad.has(item.file) && item.kind === 'skinned-mesh') {
      const m = bad.get(item.file) ?? [];
      item.issues.push({
        severity: 'warn',
        code: 'AST_SKELETON_GROUP_UNMATCHED',
        message:
          m.length === 0
            ? `${safeName(item.file)} matches no declared skeleton group.`
            : `${safeName(item.file)} matches several skeleton groups: ${m.join(', ')}.`,
      });
      if (item.status === 'pass') item.status = 'warn';
    }
  }
}

/** Forward-kinematics world matrices of the rest pose, by joint name. */
export function restWorldMatrices(
  joints: readonly JointRest[],
  armatureWorld: readonly number[],
): Map<string, number[]> {
  const byName = new Map(joints.map(j => [j.name, j]));
  const out = new Map<string, number[]>();
  const visit = (j: JointRest, depth: number): number[] => {
    const done = out.get(j.name);
    if (done) return done;
    const local = compose(j.translation, j.rotation, j.scale);
    const p =
      j.parent !== null && depth < joints.length
        ? byName.get(j.parent)
        : undefined;
    const w = multiply(p ? visit(p, depth + 1) : armatureWorld, local);
    out.set(j.name, w);
    return w;
  };
  for (const j of joints) visit(j, 0);
  return out;
}

/**
 * Worst difference between the forward kinematics of a skeleton's rest TRS
 * (times the armature) and the inverse of its inverse bind matrices.
 */
export function restPoseFkError(skeleton: SkeletonData): {
  posM: number;
  rotRad: number;
  scale: number;
} {
  const world = restWorldMatrices(skeleton.joints, skeleton.armatureWorld);
  let posM = 0;
  let rotRad = 0;
  let scale = 0;
  skeleton.joints.forEach((j, i) => {
    const fk = world.get(j.name);
    const ibm = skeleton.inverseBind[i];
    const bind = ibm ? invert(ibm) : null;
    if (!fk || !bind) {
      posM = rotRad = scale = Infinity;
      return;
    }
    const d = trsDeltas(decompose(fk), decompose(bind));
    posM = Math.max(posM, d.pos);
    rotRad = Math.max(rotRad, d.rot);
    scale = Math.max(scale, d.scale);
  });
  return {posM, rotRad, scale};
}

/** Structural view of a rig with skeleton groups (subset of `RigDefinition`). */
export interface RigGroupsView {
  bones: readonly string[];
  /** Joint to parent joint (`null` for the root); additive to spec 002, needed for FK and parent checks. */
  parents: Readonly<Record<string, string | null>>;
  skeletonGroups: ReadonlyArray<{
    id: string;
    restPose: Readonly<
      Record<
        string,
        {t: readonly number[]; r: readonly number[]; s: readonly number[]}
      >
    >;
  }>;
}

/**
 * Builds a {@link SkeletonData} from the rest pose of one group of a rig:
 * joints in `bones` order (parents from `rig.parents`), inverse bind
 * matrices from forward kinematics, identity armature.
 */
export function skeletonFromGroup(
  rig: RigGroupsView,
  groupId: string,
): SkeletonData | null {
  const group = rig.skeletonGroups.find(g => g.id === groupId);
  if (!group) return null;
  const joints: JointRest[] = [];
  for (const name of rig.bones) {
    const r = group.restPose[name];
    if (!r || r.t.length !== 3 || r.r.length !== 4 || r.s.length !== 3) {
      return null;
    }
    joints.push({
      name,
      parent: rig.parents[name] ?? null,
      translation: r.t as unknown as Vec3,
      rotation: r.r as unknown as Quat,
      scale: r.s as unknown as Vec3,
    });
  }
  const identityM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const world = restWorldMatrices(joints, identityM);
  return {
    joints,
    inverseBind: joints.map(
      j => invert(world.get(j.name) ?? identityM) ?? identityM,
    ),
    armatureWorld: identityM,
  };
}

/**
 * Messages that only reflect a rest/bind pose difference (a moved pelvis also
 * changes the measured height), which `--built` mode downgrades to `warn`.
 */
function isPoseOnlyMessage(message: string): boolean {
  return (
    message.startsWith('Bind pose') || message.startsWith('Skeleton height')
  );
}

/** Result of {@link verifyBuiltPart}. */
export interface BuiltPartResult {
  /** False when any item failed (structure, influences, weights). */
  ok: boolean;
  status: 'pass' | 'warn' | 'fail';
  issues: RigIssue[];
  items: RigReportItem[];
}

/**
 * Verifies a built (output) skinned part against one skeleton group of the
 * rig (REQ-AST-026, `--built` mode; used by M1-15). Structural differences and
 * more than 4 influences fail; a bind-pose-only difference is a `warn`
 * naming the group. Pure: no I/O.
 *
 * @param rig the embedded rig (`bones`, `parents`, `skeletonGroups`).
 * @param groupId the group the part declares (`PartEntry.skeletonGroup`).
 * @param data parsed part; `skeleton` null means no skin.
 */
export function verifyBuiltPart(
  rig: RigGroupsView,
  groupId: string,
  data: RigFileData,
  tol: Tolerances = DEFAULT_TOLERANCES,
): BuiltPartResult {
  const fail = (message: string): BuiltPartResult => {
    const issues: RigIssue[] = [
      {severity: 'error', code: 'AST_RIG_MISMATCH', message},
    ];
    return {ok: false, status: 'fail', issues, items: []};
  };
  const ref = skeletonFromGroup(rig, groupId);
  if (!ref) {
    return fail(`Rig has no complete skeleton group ${safeName(groupId)}.`);
  }
  if (!data.skeleton) return fail(`${safeName(data.file)} has no skin.`);
  const items = verifyFile(ref, data, tol).filter(
    i => i.kind === 'skinned-mesh',
  );
  for (const item of items) {
    const structural =
      item.missingBones.length > 0 ||
      item.extraBones.length > 0 ||
      item.parentMismatches.length > 0 ||
      item.issues.some(
        i =>
          i.severity === 'error' &&
          (i.code === 'AST_BUDGET_INFLUENCES' ||
            i.code === 'AST_WEIGHTS_UNNORMALIZED' ||
            (i.code === 'AST_RIG_MISMATCH' && !isPoseOnlyMessage(i.message))),
      );
    if (!structural && item.bindPose.length > 0) {
      // Bind-pose-only difference: downgrade to a warning naming the group.
      const order = new Map(rig.bones.map((b, i) => [b, i]));
      const first = item.bindPose
        .slice()
        .sort((a, b) => (order.get(a.bone) ?? 0) - (order.get(b.bone) ?? 0))
        .slice(0, 5);
      item.issues = item.issues.filter(
        i => !(i.code === 'AST_RIG_MISMATCH' && isPoseOnlyMessage(i.message)),
      );
      item.issues.push({
        severity: 'warn',
        code: 'AST_BIND_POSE_DIFFERS',
        message: `Bind pose differs from skeleton group ${safeName(groupId)} on ${item.bindPose.length} bone(s), first in hierarchy order: ${first.map(x => `${safeName(x.bone)} (pos ${x.maxPosDelta.toExponential(2)} m, rot ${x.maxRotDelta.toExponential(2)} rad)`).join('; ')}.`,
      });
      item.status = item.issues.some(i => i.severity === 'error')
        ? 'fail'
        : 'warn';
    }
  }
  const issues = items.flatMap(i => i.issues);
  const status = items.some(i => i.status === 'fail')
    ? 'fail'
    : items.some(i => i.status === 'warn')
      ? 'warn'
      : 'pass';
  return {ok: status !== 'fail', status, issues, items};
}

function cell(s: string): string {
  return safeName(s).replace(/\|/g, '\\|');
}

/** Renders the Markdown report (REQ-AST-006). Deterministic. */
export function renderMarkdown(report: RigReport, date?: string): string {
  const lines: string[] = [];
  lines.push('# Rig verification report', '');
  if (date) lines.push(`Run date: ${date}`, '');
  lines.push(
    `- Canonical rig: \`${report.canonicalRig}\``,
    `- Reference: \`${cell(report.referenceFile)}\``,
    `- Outcome: **${report.outcome}**`,
    `- Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    `- Tolerances: position ${report.tolerances.posM} m, rotation ${report.tolerances.rotRad} rad, scale ${report.tolerances.scale}`,
    `- Tools: ${Object.entries(report.toolVersions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    '',
    '## Skeleton groups',
    '',
    ...report.skeletonGroups.map(
      g =>
        `- ${g.id}${g.isReference ? ' (reference)' : ''}: ${g.files.length} file(s); vs reference: ${g.vsReference.bonesOverTolerance} bone(s) over tolerance, max ${g.vsReference.maxPosM.toExponential(2)} m (${(g.vsReference.maxPosHeightFraction * 100).toFixed(2)} % of height), ${g.vsReference.maxRotDeg.toFixed(2)} deg`,
    ),
    '',
    '## Files',
    '',
    '| File | Pack | Kind | Status | Joints | Issues (first 5) |',
    '|------|------|------|--------|--------|------------------|',
  );
  for (const i of report.items) {
    const issues = i.issues
      .slice(0, 5)
      .map(x => `${x.severity}: ${cell(x.message)}`)
      .join('<br>');
    lines.push(
      `| ${cell(i.file)} | ${i.packId} | ${i.kind} | ${i.status} | ${i.jointCount} | ${issues} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Overlay holding hand-edited anatomy, region, socket and group data (REQ-AST-005, REQ-AST-026). */
export interface RigOverlay {
  comment?: string;
  lengthAxis?: LengthAxis;
  /** Group used as the verify-rig reference; must be a key of `skeletonGroups`. */
  defaultSkeletonGroup: string;
  /** Socket id (from parts-schema) to the real joint that carries it. */
  socketBones: Record<string, string>;
  /** Group id to its representative source file (relative to `assets-src`); declaration order is kept. */
  skeletonGroups: Record<string, string>;
  anatomyBones: Record<string, string[]>;
  regionBones: Record<string, string[]>;
}

/** Group id format (spec 002: `[a-z0-9-]{1,32}`). */
export const SKELETON_GROUP_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

/** A declared skeleton group with its parsed representative skeleton. */
export interface SkeletonGroupInput {
  id: string;
  packId: string;
  /** Representative file, relative to `assets-src`. */
  file: string;
  skeleton: SkeletonData;
}

/** Anatomy keys required by spec 002 REQ-ANA-001. */
export const ANATOMY_KEYS = [
  'height',
  'head',
  'torsoWidth',
  'shoulders',
  'armLength',
  'legLength',
  'hands',
  'feet',
  'limbThickness',
] as const;

/** Body regions required by spec 001 (`BodyRegion`). */
export const BODY_REGIONS = [
  'head',
  'hair',
  'neck',
  'torso',
  'upper-arms',
  'lower-arms',
  'hands',
  'pelvis',
  'upper-legs',
  'lower-legs',
  'feet',
] as const;

/** Local rest transform of one joint (spec 002 `RestTransform`). */
export interface RestTransformJson {
  t: Vec3;
  r: Quat;
  s: Vec3;
}

/** Canonical rig file content (architecture 3.2, spec 002 `RigDefinition`). */
export interface CanonicalRigFile {
  id: string;
  comment: string;
  bones: string[];
  rootBone: string;
  lengthAxis: LengthAxis;
  anatomyBones: Record<string, string[]>;
  regionBones: Record<string, string[]>;
  socketBones: Record<string, string>;
  skeletonHeightM: number;
  defaultSkeletonGroup: string;
  skeletonGroups: Array<{
    id: string;
    restPose: Record<string, RestTransformJson>;
  }>;
}

/** Orders joints parent-before-child, stable w.r.t. the input order. */
export function orderParentFirst(joints: readonly JointRest[]): JointRest[] {
  const byName = new Map(joints.map(j => [j.name, j]));
  const out: JointRest[] = [];
  const seen = new Set<string>();
  const visit = (j: JointRest, depth = 0) => {
    if (seen.has(j.name) || depth > joints.length) return;
    const p = j.parent ? byName.get(j.parent) : undefined;
    if (p) visit(p, depth + 1);
    seen.add(j.name);
    out.push(j);
  };
  for (const j of joints) visit(j);
  return out;
}

/**
 * Derives the canonical rig definition from the reference skeleton and the
 * hand-edited overlay. Returns validation errors instead of throwing so the
 * CLI can print them as a report.
 */
export function deriveRigDefinition(
  rigId: string,
  ref: SkeletonData,
  overlay: RigOverlay,
  groups: readonly SkeletonGroupInput[],
  tol: Tolerances = DEFAULT_TOLERANCES,
): {
  rig: (CanonicalRigFile & {parents: Record<string, string | null>}) | null;
  errors: string[];
} {
  const errors: string[] = [];
  const ordered = orderParentFirst(ref.joints);
  const names = new Set(ordered.map(j => j.name));
  const roots = ordered.filter(j => j.parent === null);
  if (roots.length !== 1) {
    errors.push(`Expected exactly one root joint, found ${roots.length}.`);
  }
  for (const key of ANATOMY_KEYS) {
    const list = overlay.anatomyBones[key];
    if (!list || list.length === 0)
      errors.push(`Overlay anatomyBones.${key} is missing or empty.`);
    for (const b of list ?? []) {
      if (!names.has(b))
        errors.push(
          `Overlay anatomyBones.${key} lists unknown bone ${safeName(b)}.`,
        );
    }
  }
  const assigned = new Map<string, string>();
  for (const region of BODY_REGIONS) {
    const list = overlay.regionBones[region];
    if (!list) errors.push(`Overlay regionBones.${region} is missing.`);
    for (const b of list ?? []) {
      if (!names.has(b))
        errors.push(
          `Overlay regionBones.${region} lists unknown bone ${safeName(b)}.`,
        );
      const prev = assigned.get(b);
      if (prev)
        errors.push(`Bone ${safeName(b)} is in regions ${prev} and ${region}.`);
      assigned.set(b, region);
    }
  }
  for (const n of names) {
    if (!assigned.has(n))
      errors.push(`AST_REGION_UNMAPPED: ${safeName(n)} is in no region.`);
  }
  const socketKeys = Object.keys(overlay.socketBones ?? {}).sort();
  const wanted = [...SOCKET_IDS].sort();
  if (socketKeys.join() !== wanted.join()) {
    errors.push(
      `Overlay socketBones keys must be exactly ${wanted.join(', ')}; got ${socketKeys.map(safeName).join(', ')}.`,
    );
  }
  for (const [sock, bone] of Object.entries(overlay.socketBones ?? {})) {
    if (!names.has(bone)) {
      errors.push(
        `Overlay socketBones.${safeName(sock)} names unknown bone ${safeName(bone)}.`,
      );
    }
  }
  const groupIds = Object.keys(overlay.skeletonGroups ?? {});
  if (groupIds.length === 0) errors.push('Overlay skeletonGroups is empty.');
  for (const id of groupIds) {
    if (!SKELETON_GROUP_ID_PATTERN.test(id)) {
      errors.push(
        `Overlay skeletonGroups id ${safeName(id)} must match [a-z0-9-]{1,32}.`,
      );
    }
  }
  if (!groupIds.includes(overlay.defaultSkeletonGroup)) {
    errors.push(
      `Overlay defaultSkeletonGroup ${safeName(String(overlay.defaultSkeletonGroup))} is not a declared group.`,
    );
  }
  const derived = deriveLengthAxis(ordered);
  if (overlay.lengthAxis && overlay.lengthAxis !== derived.axis) {
    errors.push(
      `Overlay lengthAxis ${overlay.lengthAxis} differs from derived ${derived.axis}.`,
    );
  }

  const parentOf = new Map(ordered.map(j => [j.name, j.parent]));
  const restPoses: CanonicalRigFile['skeletonGroups'] = [];
  for (const id of groupIds) {
    const g = groups.find(x => x.id === id);
    if (!g) {
      errors.push(
        `Skeleton group ${safeName(id)} has no parsed representative.`,
      );
      continue;
    }
    const byName = new Map(g.skeleton.joints.map(j => [j.name, j]));
    const c = compareSkeletons({...ref, joints: ordered}, g.skeleton, {
      posM: Infinity,
      rotRad: Infinity,
      scale: Infinity,
    });
    if (
      c.missingBones.length > 0 ||
      c.extraBones.length > 0 ||
      c.parentMismatches.length > 0
    ) {
      errors.push(
        `Skeleton group ${safeName(id)} (${safeName(g.file)}) differs structurally from the reference: ${c.issues
          .filter(i => i.severity === 'error')
          .map(i => i.message)
          .join(' ')}`,
      );
      continue;
    }
    const fk = restPoseFkError(g.skeleton);
    if (fk.posM > tol.posM || fk.rotRad > tol.rotRad || fk.scale > tol.scale) {
      errors.push(
        `Skeleton group ${safeName(id)}: rest-pose FK differs from inverse bind (pos ${fk.posM.toExponential(2)} m, rot ${fk.rotRad.toExponential(2)} rad).`,
      );
      continue;
    }
    const restPose: Record<string, RestTransformJson> = {};
    for (const j of ordered) {
      const r = byName.get(j.name);
      if (r) restPose[j.name] = {t: r.translation, r: r.rotation, s: r.scale};
    }
    restPoses.push({id, restPose});
  }
  if (errors.length > 0 || !roots[0]) return {rig: null, errors};
  const comment = [
    `Derived by pnpm assets:verify-rig from the reference skeleton (joint list, parents, lengthAxis by majority vote x=${derived.votes.x} y=${derived.votes.y} z=${derived.votes.z}) and the representative file of each skeleton group (rest poses).`,
    overlay.comment ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    errors,
    rig: {
      id: rigId,
      comment,
      bones: ordered.map(j => j.name),
      parents: Object.fromEntries(
        ordered.map(j => [j.name, parentOf.get(j.name) ?? null]),
      ),
      rootBone: roots[0].name,
      lengthAxis: derived.axis,
      anatomyBones: overlay.anatomyBones,
      regionBones: overlay.regionBones,
      socketBones: Object.fromEntries(
        SOCKET_IDS.map(s => [s, overlay.socketBones[s] as string]),
      ),
      skeletonHeightM: skeletonHeight(ref),
      defaultSkeletonGroup: overlay.defaultSkeletonGroup,
      skeletonGroups: restPoses,
    },
  };
}
