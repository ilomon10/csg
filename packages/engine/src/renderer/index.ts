/**
 * renderer module (architecture 3.6, spec 000 REQ-GEN-001/002, spec 003
 * REQ-PIX-005/026, spec 004 REQ-ANM-018): backend selection with WebGL2
 * fallback, the M1 preview scene and the preview playback loop.
 */
export type {
  CharacterRenderer,
  CreateCharacterRenderer,
  RendererBackend,
  RendererOptions,
} from '../contracts/renderer';
export {backendOf, createRendererBackend} from './backend';
export type {
  CreatedBackend,
  InitializableRenderer,
  RendererFactory,
  RendererParameters,
} from './backend';
export {createCharacterRenderer} from './character-renderer';
export type {
  CharacterRendererOptions,
  EngineCharacterRenderer,
  PreviewRenderer,
} from './character-renderer';
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
