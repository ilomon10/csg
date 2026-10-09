import {renderToString} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type * as UsePreviewModule from './use-preview';
import type {PreviewControls, PreviewState} from './use-preview';

let current: PreviewState;

vi.mock('./use-preview', async importOriginal => {
  const actual = await importOriginal<typeof UsePreviewModule>();
  const noop = (): void => undefined;
  return {
    ...actual,
    usePreview: (): PreviewControls => ({
      state: current,
      togglePlay: noop,
      selectClip: noop,
      turn: noop,
      seek: noop,
      setShowExportFrames: noop,
      selectPalette: noop,
      setViewMode: noop,
      dismissError: noop,
      resumeAfterFailure: noop,
    }),
  };
});

const {PreviewViewport} = await import('./preview-viewport');

const READY: PreviewState = {
  status: 'ready',
  backend: 'webgl2',
  error: null,
  errorCode: null,
  clip: 'idle' as PreviewState['clip'],
  playing: true,
  direction: 0,
  clipDurationSec: 2,
  showExportFrames: true,
  timeSec: 0,
  palette: 'none',
  lutStats: null,
  viewMode: 'pixel',
};

describe('preview viewport recoverable errors (FX-W3)', () => {
  beforeEach(() => {
    current = READY;
  });

  it('AC-PIX-021.6: a ready preview with a LUT failure keeps controls enabled and offers Dismiss only', () => {
    current = {
      ...READY,
      error: 'PIX_PALETTE_LUT_FAILED: worker rejected',
      errorCode: 'PIX_PALETTE_LUT_FAILED',
    };
    const html = renderToString(<PreviewViewport />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('PIX_PALETTE_LUT_FAILED: worker rejected');
    expect(html).toContain('aria-label="Dismiss error"');
    expect(html).not.toContain('Resume preview');
    expect(html).not.toMatch(/data-testid="palette-select"[^>]*disabled/);
  });

  it('AC-PIX-039.1: a failed frame offers Resume and Dismiss', () => {
    current = {
      ...READY,
      playing: false,
      error: 'PIX_PREVIEW_FAILED: shader error',
      errorCode: 'PIX_PREVIEW_FAILED',
    };
    const html = renderToString(<PreviewViewport />);
    expect(html).toContain('aria-label="Resume preview"');
    expect(html).toContain('aria-label="Dismiss error"');
  });

  it('AC-PIX-026.2: a fatal error disables the controls and hides Dismiss', () => {
    current = {
      ...READY,
      status: 'error',
      error: 'PIX_BACKEND_UNAVAILABLE: no GPU',
      errorCode: 'PIX_BACKEND_UNAVAILABLE',
    };
    const html = renderToString(<PreviewViewport />);
    expect(html).toContain('PIX_BACKEND_UNAVAILABLE');
    expect(html).not.toContain('Dismiss error');
    expect(html).toMatch(
      /aria-label="Turn left"[^>]*disabled|disabled=""[^>]*aria-label="Turn left"/,
    );
  });
});
