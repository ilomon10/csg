/** How the preview treats an engine error code. */
export type PreviewErrorKind = 'recoverable' | 'fatal';

/**
 * Engine codes after which a ready preview stays usable: a failed palette LUT build keeps
 * the previous settings (REQ-PIX-021, AC-PIX-021.6) and a throwing frame only pauses the
 * loop, which `resume()` restarts (REQ-PIX-039, AC-PIX-039.1).
 */
const RECOVERABLE_CODES: ReadonlySet<string> = new Set([
  'PIX_PALETTE_LUT_FAILED',
  'PIX_PREVIEW_FAILED',
]);

/**
 * Classifies an engine error code. Unknown or missing codes (creation failures,
 * `PIX_BACKEND_UNAVAILABLE`, thrown start errors) are fatal.
 *
 * @param code Engine error code, if any.
 * @returns `recoverable` or `fatal`.
 */
export function classifyPreviewError(
  code: string | undefined,
): PreviewErrorKind {
  return code !== undefined && RECOVERABLE_CODES.has(code)
    ? 'recoverable'
    : 'fatal';
}
