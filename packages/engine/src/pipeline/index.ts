/**
 * Pixel pipeline public surface (spec 003; m2-plan 2.1 to 2.5): pure CPU
 * modules (framing, snapping, Bayer, palette LUT, readback, part IDs,
 * directions), the settings binder and stage context, the toon material and
 * scene MRT, the emitter-shaped stages, the camera and the render pipeline.
 * The palette-LUT worker entry (`palette-lut.worker.ts`) is loaded by URL and
 * is not re-exported.
 */
export * from './bayer';
export * from './camera';
export * from './directions';
export * from './framing';
export * from './oklab';
export * from './palette-lut';
export * from './part-ids';
export * from './readback';
export * from './render-pipeline';
export * from './settings-binder';
export * from './snap';
export * from './srgb8';
export * from './stage-context';
export * from './stages/index';
export * from './toon-material';
