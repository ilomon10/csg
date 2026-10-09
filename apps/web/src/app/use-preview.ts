import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  RendererBackend,
} from '@csg/engine';
import {DIRECTION_ORDER} from '@csg/parts-schema';
import type {ClipRef, RenderSettings} from '@csg/parts-schema';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {
  DEFAULT_CLIP,
  createPreviewCharacter,
  createPreviewSettings,
} from './default-character';
import {classifyPreviewError} from './preview-errors';
import {startPreviewSession} from './preview-session';
import type {PreviewSession} from './preview-session';
import type * as PreviewEngineModule from './preview-engine';

/** The lazily loaded engine entry points (`./preview-engine`). */
type PreviewEngine = typeof PreviewEngineModule;

/** Palette choices of the preview controls (spec 003 REQ-PIX-019). */
export const PREVIEW_PALETTES = ['none', 'pico-8', 'endesga-32'] as const;

/** One of {@link PREVIEW_PALETTES}. */
export type PreviewPalette = (typeof PREVIEW_PALETTES)[number];

/** Palette LUT build counters (AC-GEN-014.1): where LUTs were built. */
export interface PreviewLutStats {
  readonly workerBuilds: number;
  readonly mainThreadBuilds: number;
  readonly failures: number;
}

/** State of the preview viewport. */
export interface PreviewState {
  readonly status: 'loading' | 'ready' | 'error';
  /** Backend actually in use (REQ-GEN-002), once the renderer exists. */
  readonly backend: RendererBackend | null;
  /** Visible error text (never console only). */
  readonly error: string | null;
  /** Engine code of `error`, when it came from the engine. */
  readonly errorCode: string | null;
  readonly clip: ClipRef;
  readonly playing: boolean;
  /** Index into `DIRECTION_ORDER`. */
  readonly direction: number;
  readonly clipDurationSec: number;
  /** "Show export frames" (REQ-ANM-018): stepped export frames, default on. */
  readonly showExportFrames: boolean;
  /** Clip time shown by the scrubber. */
  readonly timeSec: number;
  /** Selected palette. */
  readonly palette: PreviewPalette;
  /** Palette LUT build counters of the renderer (null before it exists). */
  readonly lutStats: PreviewLutStats | null;
}

/** Controls returned by {@link usePreview}. */
export interface PreviewControls {
  readonly state: PreviewState;
  togglePlay(): void;
  selectClip(ref: ClipRef): void;
  turn(step: 1 | -1): void;
  seek(timeSec: number): void;
  setShowExportFrames(on: boolean): void;
  selectPalette(id: PreviewPalette): void;
  dismissError(): void;
  /** Restarts a preview loop that stopped with `PIX_PREVIEW_FAILED` (AC-PIX-039.1). */
  resumeAfterFailure(): void;
}

const INITIAL: PreviewState = {
  status: 'loading',
  backend: null,
  error: null,
  errorCode: null,
  clip: DEFAULT_CLIP,
  playing: false,
  direction: 0,
  clipDurationSec: 0,
  showExportFrames: true,
  timeSec: 0,
  palette: 'none',
  lutStats: null,
};

/** Watches `devicePixelRatio`: a `resolution` media query fires once per change and is re-armed. */
function observeDevicePixelRatio(onChange: () => void): () => void {
  let query: MediaQueryList | null = null;
  const arm = (): void => {
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handle, {once: true});
  };
  const handle = (): void => {
    onChange();
    arm();
  };
  arm();
  return () => query?.removeEventListener('change', handle);
}

/**
 * Runs `run` once, after the first contentful paint (AC-GEN-007.3 c). Uses the `paint` timing
 * entry; falls back to a double `requestAnimationFrame` when the entry type is unsupported
 * or no FCP arrives within `fallbackMs`. Returns a cancel function.
 */
function afterFirstContentfulPaint(
  run: () => void,
  fallbackMs = 1500,
): () => void {
  let done = false;
  let observer: PerformanceObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  const fire = (): void => {
    if (done) return;
    done = true;
    observer?.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    run();
  };
  const doubleRaf = (): void => {
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(fire);
    });
  };
  try {
    observer = new PerformanceObserver(list => {
      if (list.getEntries().some(e => e.name === 'first-contentful-paint')) {
        fire();
      }
    });
    observer.observe({type: 'paint', buffered: true});
    timer = setTimeout(doubleRaf, fallbackMs);
  } catch {
    doubleRaf();
  }
  return () => {
    done = true;
    observer?.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(raf);
  };
}

/**
 * Owns the engine renderer of the preview canvas: loads the bundled packs, assembles the
 * default character, plays the clip and exposes play, clip, direction and seek controls.
 *
 * The hook creates a fresh canvas element for every session (a disposed renderer leaves its
 * canvas with a lost or bound context, so StrictMode remounts and HMR must not reuse it) and
 * inserts it into the viewport element.
 *
 * @param viewportRef Element that hosts the canvas and whose size drives the drawing buffer.
 * @returns State and controls.
 */
export function usePreview(
  viewportRef: RefObject<HTMLElement | null>,
): PreviewControls {
  const [state, setState] = useState<PreviewState>(INITIAL);
  const rendererRef = useRef<EngineCharacterRenderer | null>(null);
  const directionRef = useRef(0);
  const settingsRef = useRef<RenderSettings | null>(null);
  const showFramesRef = useRef(true);
  const registryRef = useRef<EngineAssetRegistry | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);

  const patch = useCallback((next: Partial<PreviewState>): void => {
    setState(prev => ({...prev, ...next}));
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'preview-canvas';
    canvas.setAttribute('data-testid', 'preview-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Character preview canvas');
    viewport.prepend(canvas);
    // StrictMode mounts, cleans up and mounts again: the first session is
    // cancelled before it can create a renderer (see startPreviewSession).
    const settings = createPreviewSettings();
    settingsRef.current = settings;
    let cancelled = false;
    let session: PreviewSession | null = null;
    const start = (engine: PreviewEngine): PreviewSession =>
      startPreviewSession(
        canvas,
        viewport,
        {character: createPreviewCharacter(), clip: DEFAULT_CLIP, settings},
        {
          devicePixelRatio: () => window.devicePixelRatio,
          createRegistry: () => engine.createAssetRegistry(),
          loadPacks: engine.loadBundledPacks,
          createRenderer: (target, options) =>
            engine.createCharacterRenderer(target as HTMLCanvasElement, {
              ...options,
              paletteLutWorker: engine.createPreviewPaletteLutWorker,
            }),
          disposeRegistry: registry => registry.loader.clear(),
          observeDevicePixelRatio,
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
          onError: (message, code) =>
            setState(prev => {
              // Recoverable codes keep a ready preview usable (REQ-PIX-021, REQ-PIX-039).
              if (
                prev.status === 'ready' &&
                classifyPreviewError(code) === 'recoverable'
              ) {
                return {
                  ...prev,
                  error: message,
                  errorCode: code ?? null,
                  playing: code === 'PIX_PREVIEW_FAILED' ? false : prev.playing,
                };
              }
              return {
                ...prev,
                status: 'error',
                error: message,
                errorCode: code ?? null,
              };
            }),
        },
      );
    // P-07: the engine (three.js) chunk loads after the shell's first paint.
    const cancelDefer = afterFirstContentfulPaint(() => {
      void import('./preview-engine').then(
        engine => {
          if (cancelled) return;
          engineRef.current = engine;
          session = start(engine);
        },
        (error: unknown) => {
          if (cancelled) return;
          patch({
            status: 'error',
            error: `The renderer failed to load: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        },
      );
    });
    return () => {
      cancelled = true;
      cancelDefer();
      session?.cancel();
      canvas.remove();
      rendererRef.current = null;
      registryRef.current = null;
    };
  }, [viewportRef, patch]);

  // The scrubber follows playback at a low rate; it is a readout, not the clock.
  useEffect(() => {
    if (!state.playing) return;
    const id = setInterval(() => {
      const r = rendererRef.current;
      if (r !== null) patch({timeSec: r.timeSec});
    }, 100);
    return () => clearInterval(id);
  }, [state.playing, patch]);

  /** Applies the "Show export frames" choice to the renderer for `ref`. */
  const applyTiming = useCallback((ref: ClipRef, durationSec: number): void => {
    const r = rendererRef.current;
    if (r === null) return;
    const sel = settingsRef.current?.animations.find(a => a.clipId === ref);
    if (showFramesRef.current || sel === undefined) {
      r.setPreviewTiming(null); // engine default: export frames
    } else {
      const engine = engineRef.current;
      if (engine === null) return;
      r.setPreviewTiming(engine.previewTimingFor(sel, durationSec, false));
    }
  }, []);

  const setShowExportFrames = useCallback(
    (on: boolean): void => {
      showFramesRef.current = on;
      applyTiming(state.clip, state.clipDurationSec);
      patch({showExportFrames: on});
    },
    [state.clip, state.clipDurationSec, applyTiming, patch],
  );

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
        const clipDurationSec =
          registryRef.current?.clipEntry(ref)?.durationSec ?? 0;
        applyTiming(ref, clipDurationSec);
        patch({
          clip: ref,
          playing: true,
          timeSec: 0,
          error: null,
          errorCode: null,
          clipDurationSec,
        });
      });
    },
    [patch, applyTiming],
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

  const selectPalette = useCallback(
    (id: PreviewPalette): void => {
      const r = rendererRef.current;
      const current = settingsRef.current;
      if (r === null || current === null) return;
      const next: RenderSettings = {
        ...current,
        palette: {...current.palette, id},
      };
      void r.setRenderSettings(next).then(result => {
        if (!result.ok) return; // the renderer's onError reports the failure
        settingsRef.current = next;
        patch({palette: id, lutStats: {...r.paletteLutStats}});
      });
    },
    [patch],
  );

  const dismissError = useCallback((): void => {
    setState(prev =>
      prev.status === 'error' ? prev : {...prev, error: null, errorCode: null},
    );
  }, []);

  const resumeAfterFailure = useCallback((): void => {
    const r = rendererRef.current;
    if (r === null) return;
    // false: nothing to resume; the notice stays so the failure is not hidden.
    if (r.resume()) patch({playing: true, error: null, errorCode: null});
  }, [patch]);

  return {
    state,
    togglePlay,
    selectClip,
    turn,
    seek,
    setShowExportFrames,
    selectPalette,
    dismissError,
    resumeAfterFailure,
  };
}
