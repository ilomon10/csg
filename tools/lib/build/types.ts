/**
 * Shared types of the `assets:build` pipeline (spec 011). Owned by M1-11; later stages import
 * from here. Stages are pure over gltf-transform documents; I/O happens at the edges.
 */
import type {Document} from '@gltf-transform/core';
import type {PackConfig} from '@csg/parts-schema';

/** Authored part entry of a pack config. */
export type PackConfigPart = PackConfig['parts'][number];
/** Authored clip entry of a pack config. */
export type PackConfigClip = PackConfig['clips'][number];

/** Entry of `tools/asset-sources.json` relevant to the build. */
export interface SourcePackInfo {
  packId: string;
  name: string;
  vendorUrl: string;
  tier: string;
  /** Folder under `assets-src/` (vendor name; may contain spaces and brackets). */
  dir: string;
  /** REQ-AST-024 tree hash; absent or null while not recorded yet. */
  treeSha256?: string | null;
}

/** A pack config together with its source description. */
export interface LoadedPack {
  packId: string;
  config: PackConfig;
  /** Folder under `assets-src/`; defaults to the pack ID. */
  dir: string;
  /** Source description from `asset-sources.json`, when listed there. */
  source?: SourcePackInfo;
  /** Path of the config file the pack was read from. */
  configPath: string;
}

/** One build output unit produced by the split stage. */
export type SplitItem =
  | {kind: 'part'; id: string; doc: Document; config: PackConfigPart}
  | {kind: 'clip'; id: string; doc: Document; config: PackConfigClip};

/** Non-fatal build finding. */
export interface BuildWarning {
  code: string;
  partId?: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Shared state handed to every stage. */
export interface BuildContext {
  /** Absolute path of `assets-src/`. */
  srcRoot: string;
  /** Absolute path of the output root (`assets/packs`). */
  outRoot: string;
  /** Warnings collected so far; stages push, never read for control flow. */
  warnings: BuildWarning[];
}

/** Error with a stable code and a process exit code (2 = usage or source problem). */
export class BuildError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number = 1,
  ) {
    super(`${code}: ${message}`);
    this.name = 'BuildError';
  }
}

/** A built part GLB plus the values computed while building it (REQ-AST-013). */
export interface BuiltPartInput {
  id: string;
  kind: 'skinned' | 'static';
  /** Final optimized GLB bytes. */
  bytes: Uint8Array;
  triangles: number;
  textures: number;
  /** Skeleton group found by the classifier; absent when unmatched (AC-AST-026.4). */
  skeletonGroup?: string;
  /** Pack-relative thumbnail path, when one exists. */
  thumbnail?: string;
}

/** A built clip GLB plus the values computed while building it (REQ-AST-013). */
export interface BuiltClipInput {
  id: string;
  /** Final optimized GLB bytes. */
  bytes: Uint8Array;
  durationSec: number;
  hasRootMotion: boolean;
  skeletonGroup: string;
}
