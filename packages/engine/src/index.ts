/**
 * `@csg/engine` public API (architecture 3.6). Framework-agnostic: no React,
 * no DOM beyond a passed-in canvas. The DOM-free `rig` and `retarget` modules
 * are also published as the `@csg/engine/rig` and `@csg/engine/retarget`
 * subpaths for `tools/`, which must not import this barrel.
 */
export type * from './contracts';
export * from './loaders';
export * from './registry';
export * from './composition';
export * from './anatomy';
export * from './animation';
export * from './renderer';
export * from './rig';
export * from './retarget';
