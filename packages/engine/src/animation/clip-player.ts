/**
 * Clip player (spec 004 REQ-ANM-008, REQ-ANM-013, REQ-ANM-023). Evaluates the clip's keyframe
 * interpolants at an absolute time and writes the result into the character bones, so a pose
 * never depends on earlier seeks and `seek` allocates nothing.
 */
import type {AnimationClip, Bone, Interpolant} from 'three';
import type {
  ClipPlayer,
  CreateClipPlayer,
  RetargetedClip,
} from '../contracts/animation';
import type {LoadedClip} from '../contracts/registry';
import {retargetClip} from './retarget-clip';
import {stripRootMotion} from './root-motion';

/** Retargeted clips kept per player (LRU). */
export const RETARGET_CACHE_SIZE = 16;

/** Newest log entries kept. */
const LOG_LIMIT = 256;

type Channel = {
  readonly interpolant: Interpolant;
  readonly bone: Bone;
  readonly property: 'quaternion' | 'position' | 'scale';
};

/**
 * Creates a clip player bound to a character skeleton. `setClip` retargets (LRU keyed
 * `${clipRef}|${skeletonGroupId}`, logging `retarget:miss` or `retarget:hit`), then strips
 * root motion for `in-place` clips that have it, then logs `source:<ref>`. A clip that cannot be
 * retargeted keeps the previous clip and logs `retarget:error:<code>`.
 */
export const createClipPlayer: CreateClipPlayer = body => {
  const log: string[] = [];
  const cache = new Map<string, RetargetedClip>();
  const rest = new Map(body.rest.joints.map(j => [j.name, j]));
  let channels: Channel[] = [];

  const note = (entry: string): void => {
    log.push(entry);
    if (log.length > LOG_LIMIT) log.shift();
  };

  const restoreRest = (): void => {
    for (const {bone, property} of channels) {
      const j = rest.get(bone.name);
      if (j === undefined) continue;
      if (property === 'quaternion') bone.quaternion.fromArray(j.rotation);
      else if (property === 'position') bone.position.fromArray(j.translation);
      else bone.scale.fromArray(j.scale);
    }
  };

  const bind = (clip: AnimationClip): Channel[] => {
    const out: Channel[] = [];
    for (const track of clip.tracks) {
      const dot = track.name.lastIndexOf('.');
      const property = track.name.slice(dot + 1);
      const bone = body.bones.get(track.name.slice(0, dot));
      if (
        bone === undefined ||
        (property !== 'quaternion' &&
          property !== 'position' &&
          property !== 'scale')
      ) {
        continue;
      }
      const factory = (track as {createInterpolant?: () => Interpolant})
        .createInterpolant;
      const interpolant =
        typeof factory === 'function'
          ? factory.call(track)
          : track.InterpolantFactoryMethodLinear();
      out.push({interpolant, bone, property});
    }
    return out;
  };

  const player: ClipPlayer = {
    setClip(clip: LoadedClip | null, rootMotion): void {
      if (clip === null) {
        restoreRest();
        channels = [];
        note('source:none');
        return;
      }
      const key = `${clip.ref}|${body.skeletonGroupId}`;
      let retargeted = cache.get(key);
      if (retargeted !== undefined) {
        cache.delete(key);
        cache.set(key, retargeted);
        note('retarget:hit');
      } else {
        const result = retargetClip(clip, body);
        if (!result.ok) {
          note(`retarget:error:${result.error.code}`);
          return;
        }
        retargeted = result.value;
        cache.set(key, retargeted);
        if (cache.size > RETARGET_CACHE_SIZE) {
          cache.delete(cache.keys().next().value as string);
        }
        note('retarget:miss');
      }
      const playable =
        rootMotion === 'in-place' && clip.entry.hasRootMotion
          ? stripRootMotion(retargeted.clip, body.rig.rootBone)
          : retargeted.clip;
      restoreRest();
      channels = bind(playable);
      note(`source:${clip.ref}`);
    },
    seek(timeSec: number): void {
      for (let i = 0; i < channels.length; i++) {
        const {interpolant, bone, property} = channels[i] as Channel;
        const v = interpolant.evaluate(timeSec);
        if (property === 'quaternion') bone.quaternion.fromArray(v);
        else if (property === 'position') bone.position.fromArray(v);
        else bone.scale.fromArray(v);
      }
    },
    log,
  };
  return player;
};
