/**
 * renderer module (architecture 3.6, spec 000 REQ-GEN-001/002, spec 003
 * REQ-PIX-005/026/030/031/034, spec 004 REQ-ANM-018): backend selection with
 * WebGL2 fallback, the preview scene, the preview loop over the pixel
 * pipeline, the canvas presenter, the integer preview layout and the export
 * entry (`prepareFrames` / `renderFrames`).
 */
export type {
  CharacterRenderer,
  CreateCharacterRenderer,
  PreviewResize,
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
  PipelineFactory,
  PipelineFactoryArgs,
  PresenterFactory,
  PreviewRenderer,
  RendererPipeline,
} from './character-renderer';
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
