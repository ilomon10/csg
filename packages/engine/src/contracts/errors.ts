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
