/**
 * renderer module (architecture 3.6, spec 000 REQ-GEN-001/002, spec 001
 * REQ-CMP-043/044, spec 003 REQ-PIX-005/026/030/031/034, spec 004
 * REQ-ANM-018, spec 009 REQ-UX-003): backend selection with WebGL2 fallback,
 * the preview scene, the preview loop over the pixel pipeline, the canvas
 * presenter, the integer preview layout, the 3D orbit view, style notices and
 * the export entry (`prepareFrames` / `renderFrames`).
 */
export type {
  CharacterRenderer,
  CreateCharacterRenderer,
  EngineNotice,
  EngineNoticeCode,
  PreviewResize,
  RendererBackend,
  RendererOptions,
  StyleUnsupportedNotice,
  ViewMode,
} from '../contracts/renderer';
export {backendOf, createRendererBackend} from './backend';
export type {
  CreatedBackend,
  InitializableRenderer,
  RendererFactory,
  RendererParameters,
} from './backend';
export {
  CMP_STYLE_UNSUPPORTED,
  createCharacterRenderer,
  styleUnsupportedError,
  styleUnsupportedNotice,
} from './character-renderer';
export type {
  CharacterRendererOptions,
  EngineCharacterRenderer,
  OrbitViewFactory,
  PipelineFactory,
  PipelineFactoryArgs,
  PresenterFactory,
  PreviewRenderer,
  RendererOrbitView,
  RendererPipeline,
} from './character-renderer';
export {
  DEFAULT_ORBIT_STATE,
  ORBIT_FOV_DEG,
  ORBIT_FRAME_MARGIN,
  ORBIT_PITCH_LIMIT_DEG,
  frameBox,
  orbitBy,
  orbitClip,
  orbitEye,
  orbitEyeInto,
  orbitFar,
  orbitNear,
} from './orbit-camera';
export type {OrbitState, OrbitVec3} from './orbit-camera';
export {PIX_DEVICE_LOST, watchDeviceLoss} from './device-loss';
export type {WatchDeviceLossOptions} from './device-loss';
export {createOrbitView} from './orbit-view';
export type {OrbitView, OrbitViewOptions} from './orbit-view';
export {createCanvasPresenter} from './canvas-presenter';
export type {
  CanvasPresenterOptions,
  PreviewPresenter,
} from './canvas-presenter';
export {previewLayout} from './preview-layout';
export {previewTimeAt, previewTimingFor} from './preview-clock';
export type {PreviewTiming} from './preview-clock';
export {
  DIRECTION_ORDER,
  DIRECTION_STEP_DEG,
  MODEL_FORWARD_YAW_OFFSET_RAD,
  PREVIEW_FRAME_CENTER_Y_M,
  PREVIEW_FRAME_HEIGHT_M,
  createPreviewScene,
  directionYaw,
  stageYaw,
} from './preview-scene';
export type {DirectionLabel, PreviewScene} from './preview-scene';
