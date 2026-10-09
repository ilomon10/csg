/**
 * `@csg/engine/catalog`: pre-engine, three-free and DOM-free helpers for the home screen, the
 * wizard and the Easy tiles, which need compatibility, manifest parsing and style gating before
 * the engine chunk loads (REQ-UX-083, architecture 3.7). Only these modules may be imported
 * here; `eslint.config.js` bans `three`, React and DOM globals in this folder.
 */
export {checkCompatibility} from '../registry/compatibility';
export {
  parseClipManifestJson,
  parsePartManifestJson,
} from '../registry/manifest-json';
export {resolveRenderPair} from './resolve-render-pair';
export type {RenderPair} from './resolve-render-pair';
export {SUPPORTED_STYLE_COMBOS} from './supported-style-combos';
