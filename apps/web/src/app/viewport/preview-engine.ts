/**
 * The engine entry points of the preview, loaded with a dynamic `import()` after the shell's
 * first paint (constitution P-07: at most 400 KB gzipped initial JS before 3D assets load).
 * Everything that pulls in `@csg/engine` and three.js at runtime goes through this module, so
 * Vite puts the renderer in its own chunk.
 */
import {createPaletteLutWorker} from '@csg/engine';
import type {PaletteLutWorker} from '@csg/engine';
import {PALETTE_WORKER_URL, createWorkerScriptUrl} from '../trusted-types';

export {
  createAssetRegistry,
  computeSampleTimes,
  createCharacterRenderer,
  previewTimingFor,
} from '@csg/engine';
export {loadBundledPacks} from './load-packs';

/**
 * The palette LUT worker factory the renderer receives (REQ-GEN-014: the engine never builds a
 * `Worker` from a URL; the host does, through the `csg-worker-url` policy).
 *
 * @returns A palette LUT worker.
 */
export function createPreviewPaletteLutWorker(): PaletteLutWorker {
  return createPaletteLutWorker({
    createWorker: () =>
      new Worker(
        createWorkerScriptUrl(PALETTE_WORKER_URL) as unknown as string,
        {type: 'module', name: 'palette-lut'},
      ),
  });
}
