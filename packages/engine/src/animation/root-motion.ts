/** Root-motion policy (spec 004 REQ-ANM-013, REQ-ANM-014). */
import {AnimationClip, VectorKeyframeTrack} from 'three';
import type {ClipEntry, ClipRef} from '@csg/parts-schema';

/**
 * In-place variant ref of a clip (REQ-ANM-014): same pack, clip id `entry.inPlaceVariant`.
 * Returns `undefined` when the entry has no variant or the ref is a user ref. The caller
 * resolves it through the registry and passes that clip to the player instead.
 */
export function inPlaceVariantRef(
  ref: ClipRef,
  entry: Pick<ClipEntry, 'inPlaceVariant'>,
): ClipRef | undefined {
  if (entry.inPlaceVariant === undefined) return undefined;
  if (!ref.startsWith('builtin:')) return undefined;
  const slash = ref.indexOf('/');
  return `${ref.slice(0, slash + 1)}${entry.inPlaceVariant}`;
}

/**
 * Removes the root bone's horizontal (X/Z) translation relative to frame 0 and keeps Y and
 * rotation (REQ-ANM-013). Applied after retargeting. Returns the input clip when it has no
 * root translation track; never mutates the input.
 */
export function stripRootMotion(
  clip: AnimationClip,
  rootBone: string,
): AnimationClip {
  const name = `${rootBone}.position`;
  const index = clip.tracks.findIndex(t => t.name === name);
  const track = clip.tracks[index];
  if (track === undefined || track.times.length === 0) return clip;
  const values = new Float32Array(track.values);
  const x0 = values[0] as number;
  const z0 = values[2] as number;
  for (let i = 0; i < values.length; i += 3) {
    values[i] = x0;
    values[i + 2] = z0;
  }
  const tracks = clip.tracks.slice();
  tracks[index] = new VectorKeyframeTrack(name, track.times, values);
  return new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}
