/**
 * Animation feature (spec 004): the Pro Animation panel (clip picker, selections, per-clip
 * settings) and the dock timeline. Never imports another feature.
 */
export {AnimationPanel, type AnimationPanelProps} from './animation-panel';
export {Timeline, TIMELINE_SPEEDS, type TimelineProps} from './timeline';
export {
  prefersReducedMotion,
  useTimelinePlayback,
  type TimelinePlayback,
  type TimelinePlaybackOptions,
} from './use-timeline-playback';
export {
  MAX_ANIMATIONS,
  defaultFps,
  playbackSpeed,
  type AnimationCatalog,
  type PanelClip,
} from './animation-model';
