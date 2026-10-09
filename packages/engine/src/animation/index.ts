/** animation module: sample times, retarget adapter, root motion, clip player (spec 004). */
export type {
  ClipPlayer,
  ComputeSampleTimes,
  CreateClipPlayer,
  DefaultFps,
  EvaluatePose,
  PoseContext,
  RetargetClip,
  RetargetedClip,
  RootMotionMode,
  SampleTimeWarning,
  SampleTimes,
} from '../contracts/animation';
export {computeSampleTimes, defaultFps, playbackSpeed} from './sample-times';
export {clipToTracks, retargetClip, tracksToClip} from './retarget-clip';
export {inPlaceVariantRef, stripRootMotion} from './root-motion';
export {RETARGET_CACHE_SIZE, createClipPlayer} from './clip-player';
