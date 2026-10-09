import {describe, expect, it} from 'vitest';
import {classifyPreviewError} from './preview-errors';

describe('preview error classification', () => {
  it('AC-PIX-021.6: a failed palette LUT build is recoverable', () => {
    expect(classifyPreviewError('PIX_PALETTE_LUT_FAILED')).toBe('recoverable');
  });
  it('AC-PIX-039.1: a throwing preview frame is recoverable', () => {
    expect(classifyPreviewError('PIX_PREVIEW_FAILED')).toBe('recoverable');
  });
  it('AC-PIX-026.2: backend and creation failures stay fatal', () => {
    expect(classifyPreviewError('PIX_BACKEND_UNAVAILABLE')).toBe('fatal');
    expect(classifyPreviewError(undefined)).toBe('fatal');
  });
});
