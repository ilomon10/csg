/**
 * Export sampling (spec 003 REQ-PIX-006/007/009/010, spec 004 REQ-ANM-011,
 * spec 005 REQ-EXP-001/024): the deterministic frame plan, the union screen
 * bounds and the two-phase frame sampler (`prepareFrames`, `renderFrames`)
 * over the pixel pipeline.
 */
export * from './frame-plan';
export * from './frame-sampler';
export * from './union-bounds';
