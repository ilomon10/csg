import {
  DIRECTION_ORDER,
  createAssetRegistry,
  createCharacterRenderer,
} from '@csg/engine';
import type {EngineCharacterRenderer, RendererBackend} from '@csg/engine';
import type {ClipRef} from '@csg/parts-schema';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {DEFAULT_CLIP, createPreviewCharacter} from './default-character';
import {loadBundledPacks} from './load-packs';
import {startPreviewSession} from './preview-session';

/** State of the preview viewport. */
export interface PreviewState {
  readonly status: 'loading' | 'ready' | 'error';
  /** Backend actually in use (REQ-GEN-002), once the renderer exists. */
  readonly backend: RendererBackend | null;
  /** Visible error text (never console only). */
  readonly error: string | null;
  readonly clip: ClipRef;
  readonly playing: boolean;
  /** Index into `DIRECTION_ORDER`. */
  readonly direction: number;
  readonly clipDurationSec: number;
  /** Clip time shown by the scrubber. */
  readonly timeSec: number;
}

/** Controls returned by {@link usePreview}. */
export interface PreviewControls {
  readonly state: PreviewState;
  togglePlay(): void;
  selectClip(ref: ClipRef): void;
  turn(step: 1 | -1): void;
  seek(timeSec: number): void;
  dismissError(): void;
}

const INITIAL: PreviewState = {
  status: 'loading',
  backend: null,
  error: null,
  clip: DEFAULT_CLIP,
  playing: false,
  direction: 0,
  clipDurationSec: 0,
  timeSec: 0,
};

/**
 * Owns the engine renderer of the preview canvas: loads the bundled packs, assembles the
 * default character, plays the clip and exposes play, clip, direction and seek controls.
 *
 * @param canvasRef The canvas to render into.
 * @param viewportRef Element whose size drives the drawing buffer.
 * @returns State and controls.
 */
export function usePreview(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  viewportRef: RefObject<HTMLElement | null>,
): PreviewControls {
  const [state, setState] = useState<PreviewState>(INITIAL);
  const rendererRef = useRef<EngineCharacterRenderer | null>(null);
  const directionRef = useRef(0);
  const registryRef = useRef<ReturnType<typeof createAssetRegistry> | null>(
    null,
  );

  const patch = useCallback((next: Partial<PreviewState>): void => {
    setState(prev => ({...prev, ...next}));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (canvas === null || viewport === null) return;
    // StrictMode mounts, cleans up and mounts again: the first session is
    // cancelled before it can create a renderer (see startPreviewSession).
    const session = startPreviewSession(
      canvas,
      viewport,
      {character: createPreviewCharacter(), clip: DEFAULT_CLIP},
      {
        createRegistry: () => createAssetRegistry(),
        loadPacks: loadBundledPacks,
        createRenderer: (target, options) =>
          createCharacterRenderer(target as HTMLCanvasElement, options),
        observeResize: (element, onResize) => {
          const observer = new ResizeObserver(onResize);
          observer.observe(element as HTMLElement);
          return () => observer.disconnect();
        },
      },
      {
        onRenderer: (renderer, registry) => {
          rendererRef.current = renderer;
          registryRef.current = registry;
          patch({backend: renderer.backend});
        },
        onReady: ({clipDurationSec}) =>
          patch({status: 'ready', playing: true, clipDurationSec}),
        onError: message => patch({status: 'error', error: message}),
      },
    );
    return () => {
      session.cancel();
      rendererRef.current = null;
      registryRef.current = null;
    };
  }, [canvasRef, viewportRef, patch]);

  // The scrubber follows playback at a low rate; it is a readout, not the clock.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => {
      const r = rendererRef.current;
      if (r !== null) patch({timeSec: r.timeSec});
    }, 100);
    return () => clearInterval(id);
  }, [state.playing, patch]);

  const togglePlay = useCallback((): void => {
    const r = rendererRef.current;
    if (r === null) return;
    if (r.playing) {
      r.pause();
      patch({playing: false, timeSec: r.timeSec});
    } else if (r.resume()) {
      // Continues from the paused (or scrubbed) time; no reload, no re-retarget.
      patch({playing: true});
    } else {
      void r.playClip(state.clip).then(result => {
        if (result.ok) patch({playing: true});
      });
    }
  }, [state.clip, patch]);

  const selectClip = useCallback(
    (ref: ClipRef): void => {
      const r = rendererRef.current;
      if (r === null) return;
      void r.playClip(ref).then(result => {
        if (!result.ok) return;
        patch({
          clip: ref,
          playing: true,
          timeSec: 0,
          error: null,
          clipDurationSec:
            registryRef.current?.clipEntry(ref)?.durationSec ?? 0,
        });
      });
    },
    [patch],
  );

  const turn = useCallback(
    (step: 1 | -1): void => {
      const r = rendererRef.current;
      if (r === null) return;
      const n = DIRECTION_ORDER.length;
      const direction = (directionRef.current + step + n) % n;
      directionRef.current = direction;
      r.setDirection(direction);
      patch({direction});
    },
    [patch],
  );

  const seek = useCallback(
    (timeSec: number): void => {
      const r = rendererRef.current;
      if (r === null) return;
      r.pause();
      r.seek(timeSec);
      patch({playing: false, timeSec});
    },
    [patch],
  );

  const dismissError = useCallback((): void => {
    setState(prev => (prev.status === 'error' ? prev : {...prev, error: null}));
  }, []);

  return {state, togglePlay, selectClip, turn, seek, dismissError};
}
