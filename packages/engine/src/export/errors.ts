/** Error values of the exporter (spec 005 error codes). */
import type {EngineError} from '../contracts';

/** Codes this module returns or throws. */
export type ExportErrorCode =
  | 'EXP_FRAME_SIZE_MISMATCH'
  | 'EXP_INVALID_SETTINGS'
  | 'EXP_TOO_LARGE'
  | 'EXP_CANCELLED'
  | 'EXP_DUPLICATE_TAG'
  | 'EXP_WORKER_FAILED';

/**
 * Thrown (and rejected with) for cancellation, which is not a failed `Result` (AC-EXP-024.1),
 * and by the worker client for protocol failures that the caller maps to a `Result`.
 */
export class ExportError extends Error implements EngineError {
  /** Spec-prefixed code. */
  readonly code: ExportErrorCode;
  /** Code-specific details. */
  readonly details?: Readonly<Record<string, unknown>>;

  /**
   * @param code Error code.
   * @param message Explanation.
   * @param details Code-specific details.
   */
  constructor(
    code: ExportErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** Builds a failed result value. */
export function exportFailure(
  code: ExportErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): {readonly ok: false; readonly error: EngineError} {
  return {
    ok: false,
    error: details === undefined ? {code, message} : {code, message, details},
  };
}
