/** Types of the sprite sheet exporter (spec 005 Data & contracts). No three.js, no DOM. */
import type {AssetLicense, DirectionLabel} from '@csg/parts-schema';

/** Progress of one export phase (REQ-EXP-023). The exporter reports `encode` and `package`. */
export interface ExportProgress {
  readonly phase: 'render' | 'encode' | 'package';
  readonly done: number;
  readonly total: number;
}

/** One animation of the export, the fields of an `AnimationSelection` the exporter reads. */
export interface ExportAnimation {
  readonly label: string;
  readonly clipId: string;
  readonly frameCount: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly pingPong?: boolean | undefined;
  readonly bakePingPong?: boolean | undefined;
}

/**
 * The part of `RenderSettings` the exporter reads. A full `RenderSettings` is assignable; the
 * worker checks only these fields by hand (REQ-GEN-015: no Zod in the worker).
 */
export interface ExportRenderInfo {
  readonly resolution: {readonly width: number; readonly height: number};
  readonly directions: number;
  readonly singleFacing?: DirectionLabel | undefined;
  readonly mirrorWest: boolean;
  readonly animations: readonly ExportAnimation[];
}

/** Everything the exporter needs besides the frames and the settings. */
export interface ExportContext {
  readonly render: ExportRenderInfo;
  /** `sha256(canonicalJson(ProjectDocument))`, computed by the caller (REQ-EXP-011). */
  readonly projectSha256: string;
  readonly characterName: string;
  /** `ref` is a `ClipRef` for kind `clip`, otherwise an `AssetRef` or a palette id. */
  readonly credits: ReadonlyArray<{
    readonly ref: string;
    readonly kind: 'body' | 'part' | 'clip' | 'decal' | 'palette';
    readonly license: AssetLicense;
  }>;
  readonly build: {
    readonly appVersion: string;
    readonly threeVersion: string;
    readonly backend: 'webgpu' | 'webgl2';
  };
  /** Pivot in cell pixels, top-left origin (spec 003 REQ-PIX-008). */
  readonly pivotPx: readonly [number, number];
}

/** Warning codes of an export (spec 005). */
export type ExportWarningCode =
  | 'LICENSE_UNKNOWN'
  | 'LICENSE_NON_COMMERCIAL'
  | 'LICENSE_SHARE_ALIKE'
  | 'EXP_LARGE_TEXTURE'
  | 'EXP_GIF_TOO_MANY_COLORS'
  | 'EXP_EMPTY_FRAMES'
  | 'PIX_FRAMING_CLIPPED';

/** One export warning; licence warnings list the assets, others carry a message. */
export interface ExportWarning {
  readonly code: ExportWarningCode;
  readonly assets?: string[];
  readonly message?: string;
}

/** One output file. */
export interface ExportFile {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

/** Result of {@link exportSpriteSheet}. */
export interface SpriteSheetExport {
  /** Sorted by name (code-unit order). */
  readonly files: ExportFile[];
  readonly warnings: ExportWarning[];
  /** `<base>.zip`: every file of `files` (REQ-EXP-017). */
  readonly zipName: string;
  /** The ZIP bytes (REQ-EXP-018). */
  readonly zip: Uint8Array;
}

/** The `SpriteExportManifest` contract (REQ-EXP-011). */
export interface SpriteExportManifest {
  format: 'sprite-export-manifest';
  version: 1;
  source: {
    projectSha256: string;
    appVersion: string;
    threeVersion: string;
    backend: 'webgpu' | 'webgl2';
  };
  cell: {width: number; height: number};
  pivotPx: [number, number];
  directions: string[];
  scales: number[];
  sheets: Array<{file: string; scale: number; width: number; height: number}>;
  clips: Array<{
    label: string;
    clipId: string;
    fps: number;
    frameCount: number;
    loop: boolean;
    direction: 'forward' | 'pingpong';
  }>;
  frames: Array<{
    name: string;
    label: string;
    direction: string;
    frame: number;
    durationMs: number;
    mirrored: boolean;
    sheet: string;
    rect: {x: number; y: number; w: number; h: number};
  }>;
  warnings: ExportWarning[];
}

/** Hard limits of REQ-EXP-025. */
export const EXPORT_LIMITS = {
  maxSheetPx: 8192,
  largeTexturePx: 4096,
  maxFrames: 4096,
  maxBytes: 512 * 1024 * 1024,
} as const;
