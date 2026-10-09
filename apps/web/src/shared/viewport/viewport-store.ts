import {useSyncExternalStore} from 'react';
import {DEFAULT_CLIP_REFS, DIRECTION_ORDER} from '@csg/parts-schema';
import type {ClipRef} from '@csg/parts-schema';

/** Shared by Easy and Pro, never in history (REQ-UX-024, REQ-UX-051). */
export interface ViewportState {
  readonly mode: 'pixel' | '3d';
  /** Index into `DIRECTION_ORDER`. */
  readonly direction: number;
  readonly previewClip: ClipRef;
  readonly playing: boolean;
  /** Integer zoom for Pixel mode, or `'fit'`. */
  readonly zoom: number | 'fit';
  /** "Show export frames" (REQ-ANM-018): stepped export frames while playing, default on. */
  readonly showExportFrames: boolean;
  /** Zero-based playhead frame of the preview clip; the viewport publishes it while playing. */
  readonly frame: number;
  /** The latest seek request (`n` makes equal frames distinct); the viewport applies it. */
  readonly seek: {readonly frame: number; readonly n: number} | null;
}

/** Highest integer zoom. */
export const MAX_ZOOM = 16;

/** The viewport store: plain serializable state plus actions. */
export interface ViewportStore {
  getState(): ViewportState;
  subscribe(listener: () => void): () => void;
  setMode(mode: ViewportState['mode']): void;
  toggleMode(): void;
  setDirection(index: number): void;
  /** Steps by `delta` directions, wrapping around the ring. */
  stepDirection(delta: number): void;
  setPreviewClip(clip: ClipRef): void;
  setPlaying(playing: boolean): void;
  togglePlaying(): void;
  setZoom(zoom: number | 'fit'): void;
  /** One integer step; from `'fit'` it starts from `fitZoom`. */
  stepZoom(delta: 1 | -1, fitZoom?: number): void;
  setShowExportFrames(on: boolean): void;
  /** Publishes the playhead the renderer is showing; never a seek request. */
  setFrame(frame: number): void;
  /** Pauses and shows the given zero-based frame of the preview clip (REQ-ANM-017). */
  seekToFrame(frame: number): void;
}

/** Initial state: Pixel, facing south, the default idle clip, playing, fit. */
export function defaultViewportState(): ViewportState {
  const south = DIRECTION_ORDER.indexOf('s');
  return {
    mode: 'pixel',
    direction: south >= 0 ? south : 0,
    previewClip: DEFAULT_CLIP_REFS[0] as ClipRef,
    playing: true,
    zoom: 'fit',
    showExportFrames: true,
    frame: 0,
    seek: null,
  };
}

/** Creates a viewport store. */
export function createViewportStore(
  initial: Partial<ViewportState> = {},
): ViewportStore {
  let state: ViewportState = {...defaultViewportState(), ...initial};
  const listeners = new Set<() => void>();
  const update = (patch: Partial<ViewportState>) => {
    const next = {...state, ...patch};
    const keys = Object.keys(patch) as Array<keyof ViewportState>;
    if (keys.every(key => next[key] === state[key])) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const count = DIRECTION_ORDER.length;
  const wrap = (index: number) => ((index % count) + count) % count;
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setMode: mode => update({mode}),
    toggleMode: () => update({mode: state.mode === 'pixel' ? '3d' : 'pixel'}),
    setDirection(index) {
      if (Number.isInteger(index)) update({direction: wrap(index)});
    },
    stepDirection: delta => update({direction: wrap(state.direction + delta)}),
    setPreviewClip: previewClip => update({previewClip, frame: 0, seek: null}),
    setPlaying: playing => update({playing}),
    togglePlaying: () => update({playing: !state.playing}),
    setZoom(zoom) {
      if (zoom === 'fit') return update({zoom});
      if (Number.isInteger(zoom)) {
        update({zoom: Math.min(MAX_ZOOM, Math.max(1, zoom))});
      }
    },
    setShowExportFrames: showExportFrames => update({showExportFrames}),
    setFrame(frame) {
      if (Number.isInteger(frame) && frame >= 0) update({frame});
    },
    seekToFrame(frame) {
      if (!Number.isInteger(frame) || frame < 0) return;
      update({
        playing: false,
        frame,
        seek: {frame, n: (state.seek?.n ?? 0) + 1},
      });
    },
    stepZoom(delta, fitZoom = 1) {
      const current = state.zoom === 'fit' ? fitZoom : state.zoom;
      update({zoom: Math.min(MAX_ZOOM, Math.max(1, current + delta))});
    },
  };
}

/** Subscribes a component to a slice of the viewport state (selector must be stable). */
export function useViewport<T>(
  store: ViewportStore,
  select: (state: ViewportState) => T,
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getState()),
    () => select(store.getState()),
  );
}
