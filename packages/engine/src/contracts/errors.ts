/**
 * Error and result contracts of the engine (architecture 3.6). Type-only.
 * Error code prefixes are the spec area prefixes (spec 000 registry), so a code
 * points to the governing spec.
 */

/** Success or failure of an engine call; failures are values, never thrown. */
export type Result<T, E = EngineError> =
  | {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly error: E};

/** Error payload of a failed {@link Result}. */
export interface EngineError {
  /** Spec-prefixed code, for example `CMP_PART_LOAD_FAILED`. */
  readonly code: string;
  /** Human-readable explanation. */
  readonly message: string;
  /** Code-specific details (see the `*Details` interfaces). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Composition errors (spec 001 REQ-CMP-*, spec 011 REQ-AST-028/029). */
export type CompositionErrorCode =
  'CMP_BODY_MISSING' | 'CMP_SLOT_MISMATCH' | 'CMP_PART_LOAD_FAILED';

/** Animation errors (spec 004 REQ-ANM-022). */
export type AnimationErrorCode = 'ANM_CLIP_LOAD_FAILED';

/** Asset errors (spec 011). */
export type AssetErrorCode = 'AST_RIG_MISMATCH';

/** Renderer errors (spec 003, architecture 4.4). */
export type RendererErrorCode = 'PIX_BACKEND_UNAVAILABLE';

/** Every error code the M1 engine returns. */
export type M1ErrorCode =
  | CompositionErrorCode
  | AnimationErrorCode
  | AssetErrorCode
  | RendererErrorCode;

/**
 * Pixel pipeline codes (spec 003 "Error and warning codes"). The settings
 * codes match parts-schema `RenderSettingsErrorCode`; `PIX_INVALID_SETTINGS`
 * covers fields without a dedicated code.
 */
export type PixelPipelineErrorCode =
  | 'PIX_INVALID_SETTINGS'
  | 'PIX_INVALID_RESOLUTION'
  | 'PIX_INVALID_CAMERA'
  | 'PIX_INVALID_DIRECTIONS'
  | 'PIX_INVALID_TOON'
  | 'PIX_PALETTE_TOO_LARGE'
  | 'PIX_PALETTE_PARSE'
  | 'PIX_DEVICE_LOST'
  | 'PIX_BACKEND_UNAVAILABLE';

/** Pixel pipeline warning codes (spec 003); reported, never a failed {@link Result}. */
export type PixelPipelineWarningCode =
  'PIX_FRAMING_CLIPPED' | 'PIX_PALETTE_DUPLICATES';

/** Every error code the M2 engine returns. */
export type M2ErrorCode = M1ErrorCode | PixelPipelineErrorCode;

/** One field issue in `details.issues` of a `PIX_INVALID_*` / `PIX_PALETTE_*` error (REQ-PIX-037). */
export interface SettingsIssueDetail {
  /** Dotted settings path, for example `toon.thresholds`. */
  readonly path: string;
  readonly code: PixelPipelineErrorCode;
  readonly message: string;
}

/** `details` of a settings validation error: every invalid field at once (REQ-PIX-037). */
export interface InvalidSettingsDetails {
  readonly issues: readonly SettingsIssueDetail[];
}

/** `details` of the `PIX_FRAMING_CLIPPED` warning (REQ-PIX-009). */
export interface FramingClippedDetails {
  readonly frames: ReadonlyArray<{
    readonly label: string;
    readonly direction: number;
  }>;
}

/** `details` of `PIX_BACKEND_UNAVAILABLE` (architecture 4.4, m2-plan R3). */
export interface BackendUnavailableDetails {
  readonly backend: 'webgpu' | 'webgl2';
  /** Missing capability, for example `EXT_color_buffer_half_float`. */
  readonly reason: string;
}

/** `details.reason` of `CMP_PART_LOAD_FAILED` (spec 011 REQ-AST-028/029). */
export type PartLoadFailedReason =
  | 'not-registered'
  | 'network'
  | 'parse'
  | 'region-missing'
  | 'extension-not-allowed';

/** `details` of `CMP_PART_LOAD_FAILED`. */
export interface PartLoadFailedDetails {
  readonly ref: string;
  readonly reason: PartLoadFailedReason;
}

/** `details.reason` of `ANM_CLIP_LOAD_FAILED` (spec 004 REQ-ANM-022). */
export type ClipLoadFailedReason =
  | 'not-registered'
  | 'network'
  | 'parse'
  | 'animation-missing'
  | 'extension-not-allowed';

/** `details` of `ANM_CLIP_LOAD_FAILED`. */
export interface ClipLoadFailedDetails {
  readonly ref: string;
  readonly reason: ClipLoadFailedReason;
}

/** `details` of `AST_RIG_MISMATCH`: joint names the part needs but the body lacks. */
export interface RigMismatchDetails {
  readonly missing: readonly string[];
}
