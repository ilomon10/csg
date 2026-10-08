/** Keyframe track retargeting (REQ-ANM-023, m1-plan section 2.6). */
import type {RetargetDrop, RetargetPlan, TrackData, Vec3} from './types';

function strideOf(track: TrackData): number {
  return track.path === 'rotation' ? 4 : 3;
}

function retargetRotation(
  pre: readonly [number, number, number, number],
  src: Float32Array,
): Float32Array {
  const out = new Float32Array(src.length);
  const [px, py, pz, pw] = pre;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let lw = 0;
  for (let i = 0; i < src.length; i += 4) {
    let sx = src[i] as number;
    let sy = src[i + 1] as number;
    let sz = src[i + 2] as number;
    let sw = src[i + 3] as number;
    const sn = Math.sqrt(sx * sx + sy * sy + sz * sz + sw * sw);
    if (sn === 0) {
      sx = 0;
      sy = 0;
      sz = 0;
      sw = 1;
    }
    // pre · q_s
    let x = pw * sx + px * sw + py * sz - pz * sy;
    let y = pw * sy - px * sz + py * sw + pz * sx;
    let z = pw * sz + px * sy - py * sx + pz * sw;
    let w = pw * sw - px * sx - py * sy - pz * sz;
    const n = Math.sqrt(x * x + y * y + z * z + w * w);
    x /= n;
    y /= n;
    z /= n;
    w /= n;
    // Hemisphere continuity with the previous output key.
    if (i > 0 && x * lx + y * ly + z * lz + w * lw < 0) {
      x = -x;
      y = -y;
      z = -z;
      w = -w;
    }
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
    out[i + 3] = w;
    lx = x;
    ly = y;
    lz = z;
    lw = w;
  }
  return out;
}

function retargetTranslation(
  sourceRest: Vec3,
  targetRest: Vec3,
  k: number,
  src: Float32Array,
): Float32Array {
  const out = new Float32Array(src.length);
  const [sx, sy, sz] = sourceRest;
  const [tx, ty, tz] = targetRest;
  for (let i = 0; i < src.length; i += 3) {
    out[i] = tx + k * ((src[i] as number) - sx);
    out[i + 1] = ty + k * ((src[i + 1] as number) - sy);
    out[i + 2] = tz + k * ((src[i + 2] as number) - sz);
  }
  return out;
}

/**
 * Retargets keyframe tracks with a plan (REQ-ANM-023):
 * - rotation: `q_t = pre · q_s`, normalized and hemisphere-continuous;
 * - translation of the hip (pelvis) and root bones:
 *   `t_t = t_tRest + k · (t_s − t_sRest)`; every other translation track is
 *   dropped (reason `'translation'`), so the bone keeps its target rest;
 * - scale: passed through unchanged (values copied) onto the mapped bone;
 * - tracks of bones with no target are dropped (reason `'unmapped'`).
 *
 * Pure: never mutates inputs, returns new value arrays, shares `times`.
 * Output order follows the input tracks, then target names (code-unit order).
 *
 * @param plan - Plan from {@link createRetargetPlan}.
 * @param tracks - Source tracks.
 * @returns Retargeted target tracks and the dropped source tracks.
 * @throws Error when a track's value count does not match its key count.
 */
export function retargetTracks(
  plan: RetargetPlan,
  tracks: readonly TrackData[],
): {tracks: TrackData[]; dropped: RetargetDrop[]} {
  const bySource = new Map<
    string,
    {target: string; pre: readonly [number, number, number, number]}[]
  >();
  for (const b of plan.bones) {
    let list = bySource.get(b.source);
    if (!list) {
      list = [];
      bySource.set(b.source, list);
    }
    list.push({target: b.target, pre: b.preRotation});
  }
  const out: TrackData[] = [];
  const dropped: RetargetDrop[] = [];
  const k = plan.legLengthRatio;
  for (const track of tracks) {
    const stride = strideOf(track);
    if (track.values.length !== track.times.length * stride) {
      throw new Error(
        `retargetTracks: ${track.bone}.${track.path} has ${track.values.length} values for ${track.times.length} keys`,
      );
    }
    const targets = bySource.get(track.bone);
    if (!targets) {
      dropped.push({bone: track.bone, path: track.path, reason: 'unmapped'});
      continue;
    }
    let translationKept = false;
    for (const {target, pre} of targets) {
      let values: Float32Array;
      if (track.path === 'rotation') {
        values = retargetRotation(pre, track.values);
      } else if (track.path === 'scale') {
        values = new Float32Array(track.values);
      } else if (target === plan.hip.target) {
        values = retargetTranslation(
          plan.hip.sourceRest,
          plan.hip.targetRest,
          k,
          track.values,
        );
      } else if (target === plan.root.target) {
        values = retargetTranslation(
          plan.root.sourceRest,
          plan.root.targetRest,
          k,
          track.values,
        );
      } else {
        continue;
      }
      if (track.path === 'translation') translationKept = true;
      out.push({bone: target, path: track.path, times: track.times, values});
    }
    if (track.path === 'translation' && !translationKept) {
      dropped.push({bone: track.bone, path: track.path, reason: 'translation'});
    }
  }
  return {tracks: out, dropped};
}
