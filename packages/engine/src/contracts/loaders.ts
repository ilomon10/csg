/**
 * Loader contracts (spec 011 REQ-AST-028/029). Type-only.
 */
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import type {EngineError, Result} from './errors';

/** Options of {@link LoadGlb}. */
export interface LoadGlbOptions {
  /** Expected SHA-256 (hex); part of the cache key together with the URL (REQ-ANM-021). */
  readonly sha256?: string;
  /** Which error code a refusal or failure carries. */
  readonly errorCode: 'CMP_PART_LOAD_FAILED' | 'ANM_CLIP_LOAD_FAILED';
  /** Body parts: require `_region` and convert it to Float32 `regionId` (REQ-AST-028). */
  readonly convertRegion?: boolean;
}

/**
 * Loads a bundled GLB on the calling thread: `GLTFLoader` with the Meshopt
 * decoder only (no Draco, no KTX2, no workers; REQ-AST-029). Draco or KTX2
 * declared in the file yields `reason: 'extension-not-allowed'`; a body without
 * `_REGION` yields `reason: 'region-missing'`. Cache key is url + sha256.
 */
export type LoadGlb = (
  url: string,
  options: LoadGlbOptions,
) => Promise<Result<GLTF, EngineError>>;
