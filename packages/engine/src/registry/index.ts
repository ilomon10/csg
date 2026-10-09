/**
 * Asset registry (architecture 3.6): bundled part and clip manifests, compatibility
 * (REQ-CMP-008), rest poses and the character skeleton group (REQ-CMP-037), and clip
 * resolution (REQ-ANM-021/022).
 */
export type {
  AssetRegistry,
  ClipEntryView,
  Compatibility,
  CompatibilityCheck,
  CharacterKind,
  CharacterSkeletonGroupOf,
  IncompatibleReason,
  LoadedClip,
  LoadedPart,
  LoadedPartInternal,
  PartEntryView,
  RestPoseOf,
  StyleCombo,
} from '../contracts/registry';
export {createAssetRegistry} from './asset-registry';
export type {
  AssetRegistryOptions,
  AssetRegistryTestOptions,
  EngineAssetRegistry,
} from './asset-registry';
export {checkCompatibility} from './compatibility';
export {parseClipManifestJson, parsePartManifestJson} from './manifest-json';
export {characterSkeletonGroupOf, restPoseOf} from './rest-pose';
