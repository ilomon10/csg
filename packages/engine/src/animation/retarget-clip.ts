/**
 * Three adapter over `@csg/engine/retarget` (spec 004 REQ-ANM-023): `AnimationClip` tracks to
 * plain {@link TrackData} and back. The math lives in the DOM-free `retarget/` module.
 */
import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import type {KeyframeTrack} from 'three';
import type {RetargetClip} from '../contracts/animation';
import type {EngineError} from '../contracts/errors';
import {createRetargetPlan, retargetTracks} from '../retarget';
import type {TrackData, TrackPath} from '../retarget';

const PROPERTY_TO_PATH: Readonly<Record<string, TrackPath>> = {
  quaternion: 'rotation',
  position: 'translation',
  scale: 'scale',
};

const PATH_STRIDE: Readonly<Record<TrackPath, number>> = {
  rotation: 4,
  translation: 3,
  scale: 3,
};

/**
 * Converts a clip's tracks (`<bone>.quaternion|position|scale`) to plain track data. Tracks on
 * other properties (for example morph targets) are left out. Throws when a track's value count
 * does not match its key count (cubic-spline tracks, which carry tangents).
 */
export function clipToTracks(clip: AnimationClip): TrackData[] {
  const out: TrackData[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const path = PROPERTY_TO_PATH[track.name.slice(dot + 1)];
    if (dot <= 0 || path === undefined) continue;
    if (track.values.length !== track.times.length * PATH_STRIDE[path]) {
      throw new Error(
        `track "${track.name}" has ${track.values.length} values for ${track.times.length} keys (cubic-spline tracks are not retargetable)`,
      );
    }
    out.push({
      bone: track.name.slice(0, dot),
      path,
      times: track.times,
      values: track.values,
    });
  }
  return out;
}

/** Builds a clip from plain track data (linear interpolation). */
export function tracksToClip(
  name: string,
  duration: number,
  tracks: readonly TrackData[],
  blendMode: AnimationClip['blendMode'],
): AnimationClip {
  const three: KeyframeTrack[] = tracks.map(t =>
    t.path === 'rotation'
      ? new QuaternionKeyframeTrack(`${t.bone}.quaternion`, t.times, t.values)
      : new VectorKeyframeTrack(
          `${t.bone}.${t.path === 'translation' ? 'position' : 'scale'}`,
          t.times,
          t.values,
        ),
  );
  return new AnimationClip(name, duration, three, blendMode);
}

function rigMismatch(
  message: string,
  missing: readonly string[],
): {ok: false; error: EngineError} {
  return {
    ok: false,
    error: {code: 'AST_RIG_MISMATCH', message, details: {missing}},
  };
}

/**
 * Retargets a clip onto the character skeleton (REQ-ANM-023). Hip is `rig.socketBones.pelvis`,
 * root is `rig.rootBone`, feet are `rig.anatomyBones.feet` of the body's rig. A clip of the
 * body's skeleton group, or whose plan is the identity, returns the input clip object. A
 * missing bone yields `AST_RIG_MISMATCH` with `details.missing`; an unusable clip (cubic-spline
 * tracks) yields `ANM_CLIP_LOAD_FAILED` with `reason: 'parse'`.
 */
export const retargetClip: RetargetClip = (clip, body) => {
  if (clip.entry.skeletonGroup === body.skeletonGroupId) {
    return {ok: true, value: {clip: clip.clip, dropped: []}};
  }
  const hipBone = body.rig.socketBones.pelvis;
  if (hipBone === undefined) {
    return rigMismatch(`rig "${body.rig.id}" has no pelvis socket bone`, [
      'pelvis',
    ]);
  }
  const plan = createRetargetPlan(clip.source, body.rest, {
    hipBone,
    rootBone: body.rig.rootBone,
    footBones: body.rig.anatomyBones.feet,
  });
  if (!plan.ok) return rigMismatch(plan.error.message, plan.error.missing);
  if (plan.value.identity) {
    return {ok: true, value: {clip: clip.clip, dropped: []}};
  }
  let source: TrackData[];
  try {
    source = clipToTracks(clip.clip);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'ANM_CLIP_LOAD_FAILED',
        message: error instanceof Error ? error.message : String(error),
        details: {ref: clip.ref, reason: 'parse'},
      },
    };
  }
  const {tracks, dropped} = retargetTracks(plan.value, source);
  return {
    ok: true,
    value: {
      clip: tracksToClip(
        clip.clip.name,
        clip.clip.duration,
        tracks,
        clip.clip.blendMode,
      ),
      dropped,
    },
  };
};
