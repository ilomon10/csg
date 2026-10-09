/** Home frames (spec 014 REQ-UX-080 to 084): pre-rendered idle frames and avatars of the lineup. */
export {
  AVATAR_CROP_PX,
  AVATAR_PX,
  composeStrip,
  cropAvatar,
  frameIndexAt,
  type PixelFrame,
} from './avatar-crop';
export {
  MAX_ANIMATED,
  createHomeFrameService,
  outwardOrder,
  type HomeFrameService,
  type HomeFrameServiceOptions,
  type HomeFrames,
  type LineupEntry,
} from './home-frame-service';
export {homeFramesKey} from './home-frames-key';
export {
  HOME_RENDER_PROFILE,
  homeRenderSettings,
  type HomeIdleClip,
} from './home-profile';
