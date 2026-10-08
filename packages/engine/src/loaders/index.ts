/**
 * Bundled GLB loaders (spec 011 REQ-AST-028/029): `GLTFLoader` with the Meshopt decoder
 * only, a same-origin/`blob:` URL policy and `_REGION` to `regionId` conversion.
 */
export type {LoadGlb, LoadGlbOptions} from '../contracts/loaders';
export {
  DISALLOWED_GLTF_EXTENSIONS,
  createGlbLoader,
  inspectGlb,
} from './glb-loader';
export type {
  GlbFailureReason,
  GlbFetch,
  GlbInspection,
  GlbLoader,
  GlbLoaderConfig,
} from './glb-loader';
export {
  REGION_ATTRIBUTE,
  SOURCE_REGION_ATTRIBUTE,
  convertRegionAttribute,
} from './region';
export {BLOCKED_URL, isAllowedAssetUrl, joinPackUrl} from './url-policy';
