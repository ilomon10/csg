import {defaultRenderSettings} from '@csg/parts-schema';
import type {ClipRef, RenderSettings} from '@csg/parts-schema';

/** Fixed render profile of the home frames (spec 014 REQ-UX-080). A change bumps `version`. */
export const HOME_RENDER_PROFILE = {
  version: 1,
  resolution: 64,
  camera: 'three-quarter',
  direction: 's',
  clip: 'idle',
  avatarSize: 64,
  pipeline: 'default',
} as const;

/** The idle clip of the profile: frame count and fps come from the clip manifest. */
export interface HomeIdleClip {
  readonly ref: ClipRef;
  /** 1 to 32. */
  readonly frameCount: number;
  /** 1 to 30. */
  readonly fps: number;
}

/**
 * Render settings of the home frames: `HOME_RENDER_PROFILE` (64 px, three-quarter camera,
 * facing south, the default pipeline) with the idle clip selected at its manifest frame count
 * and fps.
 */
export function homeRenderSettings(idle: HomeIdleClip): RenderSettings {
  const base = defaultRenderSettings(HOME_RENDER_PROFILE.camera);
  return {
    ...base,
    resolution: {
      width: HOME_RENDER_PROFILE.resolution,
      height: HOME_RENDER_PROFILE.resolution,
    },
    directions: 1,
    singleFacing: HOME_RENDER_PROFILE.direction,
    animations: [
      {
        clipId: idle.ref,
        label: HOME_RENDER_PROFILE.clip,
        frameCount: Math.min(32, Math.max(1, Math.round(idle.frameCount))),
        fps: Math.min(30, Math.max(1, Math.round(idle.fps))),
        loop: true,
        timing: 'fit',
      },
    ],
  };
}
