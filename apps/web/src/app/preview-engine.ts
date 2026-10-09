/**
 * The engine entry points of the preview, loaded with a dynamic `import()` after the shell's
 * first paint (constitution P-07: at most 400 KB gzipped initial JS before 3D assets load).
 * Everything that pulls in `@csg/engine` and three.js at runtime goes through this module, so
 * Vite puts the renderer in its own chunk.
 */
export {
  createAssetRegistry,
  createCharacterRenderer,
  previewTimingFor,
} from '@csg/engine';
export {loadBundledPacks} from './load-packs';
