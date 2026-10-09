import {describe, expect, it, vi} from 'vitest';
import {createViewportStore} from './viewport-store';

describe('viewport store', () => {
  it('AC-UX-051.2: mode, direction and clip are shared state that observers see', () => {
    const store = createViewportStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setMode('pixel');
    expect(listener).not.toHaveBeenCalled();
    store.setDirection(7);
    store.setPreviewClip('builtin:quaternius-ual/walk' as never);
    expect(store.getState()).toMatchObject({
      mode: 'pixel',
      direction: 7,
      previewClip: 'builtin:quaternius-ual/walk',
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('AC-UX-024.1: direction wraps and zoom stays an integer in range', () => {
    const store = createViewportStore({direction: 7});
    store.stepDirection(1);
    expect(store.getState().direction).toBe(0);
    store.stepDirection(-1);
    expect(store.getState().direction).toBe(7);
    store.stepZoom(1, 3);
    expect(store.getState().zoom).toBe(4);
    store.setZoom(1.5);
    expect(store.getState().zoom).toBe(4);
    store.setZoom(999);
    expect(store.getState().zoom).toBe(16);
    store.toggleMode();
    expect(store.getState().mode).toBe('3d');
  });

  it('AC-ANM-018.2: export frames default on; a seek pauses and publishes the frame', () => {
    const store = createViewportStore();
    expect(store.getState().showExportFrames).toBe(true);
    store.setShowExportFrames(false);
    expect(store.getState().showExportFrames).toBe(false);
    store.seekToFrame(3);
    expect(store.getState()).toMatchObject({
      playing: false,
      frame: 3,
      seek: {frame: 3, n: 1},
    });
    store.seekToFrame(3);
    expect(store.getState().seek?.n).toBe(2);
    store.setPreviewClip('builtin:quaternius-ual/walk' as never);
    expect(store.getState()).toMatchObject({frame: 0, seek: null});
  });
});
