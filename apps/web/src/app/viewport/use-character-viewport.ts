import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
} from '@csg/engine';
import type {RenderSettings} from '@csg/parts-schema';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import type {CharacterTarget} from '../../shared/document';
import {announce} from '../../shared/ui';
import {useViewport} from '../../shared/viewport';
import type {ViewportStore} from '../../shared/viewport';
import {afterFirstContentfulPaint} from './after-first-paint';
import {browserSessionDeps} from './browser-session-deps';
import type {EngineHost, PreviewEngine} from './engine-host';
import {characterRefs, partLoadStore} from './part-load-store';
import type {PartLoadStore} from './part-load-store';
import {classifyPreviewError} from './preview-errors';
import {startPreviewSession} from './preview-session';
import type {PreviewSession} from './preview-session';
import {
  buildViewportSummary,
  facingAnnouncement,
  frameAt,
} from './viewport-summary';

/** Recreations that may fail before the viewport gives up (REQ-UX-046). */
export const MAX_RESTART_FAILURES = 2;

/** Shown while the renderer is recreated after a device loss (REQ-UX-046). */
export const RESTARTING_TEXT = 'Renderer restarting…';

/** The summary changes at most once per second (REQ-UX-039). */
export const SUMMARY_INTERVAL_MS = 1000;

/** A notice the viewport raises instead of an error (`CMP_STYLE_UNSUPPORTED`, REQ-CMP-043). */
export interface ViewportNotice {
  readonly code: string;
  readonly message: string;
}

/** Inputs of {@link useCharacterViewport}. */
export interface UseCharacterViewportInput {
  readonly target: CharacterTarget;
  readonly render: () => RenderSettings;
  readonly label: string;
  readonly store: ViewportStore;
  readonly host: EngineHost;
  /** Where busy part refs are reported (default: the shared store, REQ-UX-067). */
  readonly partLoads?: PartLoadStore;
  readonly onNotice?: (notice: ViewportNotice) => void;
  readonly onBackend?: (backend: 'webgpu' | 'webgl2') => void;
  /**
   * A document change (character or render settings) has been applied and its frame handed to
   * the compositor. Fires after the last queued change, one animation frame after the draw.
   */
  readonly onFramePresented?: () => void;
}

/** What the view needs from {@link useCharacterViewport}. */
export interface CharacterViewportModel {
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: string | null;
  readonly errorCode: string | null;
  readonly summary: string;
  /** Largest integer zoom that fits the stage (1 before the first layout). */
  readonly fitZoom: number;
  /** The zoom the canvas shows. */
  readonly zoom: number;
  /** Whether the engine can show the orbitable 3D view (M3-05); Pixel is shown until then. */
  readonly canThreeD: boolean;
  /** The view in effect: Pixel while 3D is unavailable. */
  readonly effectiveMode: 'pixel' | '3d';
  /** Palette LUT build counters of the renderer (AC-GEN-014.1 diagnostics). */
  readonly lutStats: {
    readonly workerBuilds: number;
    readonly mainThreadBuilds: number;
    readonly failures: number;
  };
  /** The active persistent notice (REQ-CMP-043), or `null`. */
  readonly notice: ViewportNotice | null;
  /** The GPU device was lost and the renderer is being recreated (REQ-UX-046). */
  readonly restarting: boolean;
  turn(delta: number): void;
  zoomBy(delta: 1 | -1): void;
  frameCharacter(): void;
  /** Turns the 3D orbit camera (degrees; pitch is clamped by the engine). No-op in Pixel. */
  orbit(dYawDeg: number, dPitchDeg: number): void;
  dismissError(): void;
  resume(): void;
}

interface ThreeDCapable {
  setViewMode(mode: 'pixel' | '3d'): void;
  orbit?(dYawDeg: number, dPitchDeg: number): void;
  frameCharacter?(): void;
}

function threeDOf(renderer: EngineCharacterRenderer): ThreeDCapable | null {
  const r = renderer as unknown as Partial<ThreeDCapable>;
  return typeof r.setViewMode === 'function' ? (r as ThreeDCapable) : null;
}

/**
 * Owns the viewport's renderer lease and keeps it in sync with the document and the shared
 * viewport store (REQ-UX-051): character and settings changes go to the renderer (diff-based in
 * the engine), direction, clip, playing, mode and zoom come from the store. The engine chunk is
 * requested after first contentful paint (REQ-UX-083).
 */
export function useCharacterViewport(
  input: UseCharacterViewportInput,
): CharacterViewportModel {
  const {store, host} = input;
  const stageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const rendererRef = useRef<EngineCharacterRenderer | null>(null);
  const registryRef = useRef<EngineAssetRegistry | null>(null);
  const sessionRef = useRef<PreviewSession | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const appliedClip = useRef<string | null>(null);
  const appliedMode = useRef<'pixel' | '3d'>('pixel');

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<{message: string; code: string | null}>();
  const [fitZoom, setFitZoom] = useState(1);
  const [canThreeD, setCanThreeD] = useState(false);
  const [notice, setNotice] = useState<ViewportNotice | null>(null);
  const [summary, setSummary] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [lutStats, setLutStats] = useState({
    workerBuilds: 0,
    mainThreadBuilds: 0,
    failures: 0,
  });
  /** Bumped to dispose the lost renderer and lease a new one on a fresh canvas. */
  const [restartKey, setRestartKey] = useState(0);
  const recovering = useRef(false);
  const failures = useRef(0);

  const mode = useViewport(store, s => s.mode);
  const direction = useViewport(store, s => s.direction);
  const clip = useViewport(store, s => s.previewClip);
  const playing = useViewport(store, s => s.playing);
  const showExportFrames = useViewport(store, s => s.showExportFrames);
  const seek = useViewport(store, s => s.seek);
  const zoomState = useViewport(store, s => s.zoom);
  const zoom = zoomState === 'fit' ? fitZoom : Math.min(zoomState, fitZoom);
  const effectiveMode = canThreeD ? mode : 'pixel';

  const report = useCallback(
    (e: EngineError | {code?: string; message: string}) => {
      const code = e.code ?? null;
      setError({message: code ? `${code}: ${e.message}` : e.message, code});
    },
    [],
  );

  // Lease lifecycle: a fresh canvas per session (a disposed renderer leaves a lost context).
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'cv__canvas preview-canvas';
    canvas.setAttribute('data-testid', 'preview-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', inputRef.current.label);
    stage.prepend(canvas);
    let cancelled = false;
    let lost = false;
    let session: PreviewSession | null = null;
    /**
     * A device loss (WebGPU `device.lost`, WebGL `webglcontextlost`, engine `PIX_DEVICE_LOST`)
     * or a failed recreation. The document, its history and the render settings live outside
     * the renderer, so recovery is: dispose, lease again, and let the session re-apply them.
     */
    const restart = (cause: 'loss' | 'failure'): void => {
      if (cancelled || lost) return;
      lost = true;
      if (cause === 'loss' && !recovering.current) {
        recovering.current = true;
        failures.current = 0;
        announce(RESTARTING_TEXT, 'assertive');
      } else {
        failures.current++;
      }
      if (failures.current >= MAX_RESTART_FAILURES) {
        recovering.current = false;
        setRestarting(false);
        setStatus('error');
        setError({
          message:
            'PIX_BACKEND_UNAVAILABLE: The renderer could not be restarted. Editing and saving still work.',
          code: 'PIX_BACKEND_UNAVAILABLE',
        });
        announce('The preview could not be restarted.', 'assertive');
        return;
      }
      setRestarting(true);
      setStatus('loading');
      setRestartKey(k => k + 1);
    };
    const onContextLost = (e: Event): void => {
      e.preventDefault();
      restart('loss');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    let settingsKey = '';
    const partLoads = inputRef.current.partLoads ?? partLoadStore;
    /** Refs the renderer has attached; a ref outside it is loading while `setCharacter` runs. */
    let attached = new Set<string>();
    const deps = browserSessionDeps(host);
    const cancelDefer = afterFirstContentfulPaint(() => {
      void host.load().then(
        engine => {
          if (cancelled) return;
          engineRef.current = engine;
          const cur = inputRef.current;
          const settings = cur.render();
          settingsKey = JSON.stringify(settings);
          session = startPreviewSession(
            canvas,
            stage,
            {
              character: cur.target.getSpec(),
              clip: store.getState().previewClip,
              settings,
              zoom: () => store.getState().zoom,
              mode: () =>
                rendererRef.current !== null &&
                threeDOf(rendererRef.current) !== null
                  ? store.getState().mode
                  : 'pixel',
            },
            deps,
            {
              onRenderer: (renderer, registry) => {
                rendererRef.current = renderer;
                registryRef.current = registry;
                setCanThreeD(threeDOf(renderer) !== null);
                inputRef.current.onBackend?.(renderer.backend);
              },
              onNotice: (n, active) => {
                // Persistent while active, gone within the same frame it clears (AC-CMP-043.3).
                if (active) {
                  const next = {code: n.code, message: n.message};
                  setNotice(next);
                  inputRef.current.onNotice?.(next);
                } else {
                  setNotice(cur => (cur?.code === n.code ? null : cur));
                }
              },
              onLayout: (_layout, fit) => setFitZoom(fit),
              onReady: () => {
                appliedClip.current = store.getState().previewClip;
                if (recovering.current) {
                  recovering.current = false;
                  failures.current = 0;
                  setRestarting(false);
                  announce('Renderer restarted', 'polite');
                }
                attached = new Set(
                  characterRefs(inputRef.current.target.getSpec()),
                );
                setStatus('ready');
              },
              onError: (message, code) => {
                if (code === 'PIX_DEVICE_LOST') {
                  restart('loss');
                  return;
                }
                if (
                  recovering.current &&
                  classifyPreviewError(code) === 'fatal'
                ) {
                  restart('failure');
                  return;
                }
                setStatus(prev =>
                  prev === 'ready' &&
                  classifyPreviewError(code) === 'recoverable'
                    ? prev
                    : 'error',
                );
                setError({message, code: code ?? null});
              },
            },
          );
          sessionRef.current = session;
        },
        (e: unknown) => {
          if (cancelled) return;
          if (recovering.current) {
            restart('failure');
            return;
          }
          setStatus('error');
          setError({
            message: `The renderer failed to load: ${
              e instanceof Error ? e.message : String(e)
            }`,
            code: null,
          });
        },
      );
    });
    // Document changes: character and render settings, latest wins, one at a time.
    let running = false;
    let dirty = false;
    const apply = async (): Promise<void> => {
      const r = rendererRef.current;
      if (r === null || cancelled) return;
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      try {
        do {
          dirty = false;
          const cur = inputRef.current;
          const settings = cur.render();
          const key = JSON.stringify(settings);
          if (key !== settingsKey) {
            settingsKey = key;
            const res = await r.setRenderSettings(settings);
            if (cancelled) return;
            if (!res.ok) report(res.error);
            session?.relayout();
          }
          const spec = cur.target.getSpec();
          const refs = characterRefs(spec);
          partLoads.set(refs.filter(ref => !attached.has(ref)));
          const res = await r.setCharacter(spec);
          if (cancelled) return;
          // The part is attached (or the load failed and the previous one stays): not busy.
          partLoads.set([]);
          if (res.ok) attached = new Set(refs);
          else report(res.error);
        } while (dirty && !cancelled);
        // The engine redraws inside the exclusive op; the compositor shows it next frame.
        requestAnimationFrame(() => {
          if (!cancelled) inputRef.current.onFramePresented?.();
        });
      } finally {
        running = false;
      }
    };
    const unsubscribe = inputRef.current.target.subscribe(() => {
      void apply();
    });
    return () => {
      cancelled = true;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      cancelDefer();
      unsubscribe();
      session?.cancel();
      sessionRef.current = null;
      rendererRef.current = null;
      registryRef.current = null;
      engineRef.current = null;
      appliedClip.current = null;
      appliedMode.current = 'pixel';
      partLoads.set([]);
      setNotice(null);
      canvas.remove();
    };
  }, [host, store, report, restartKey]);

  useEffect(() => {
    stageRef.current
      ?.querySelector('canvas')
      ?.setAttribute('aria-label', input.label);
  }, [input.label]);

  /** The clip's selection, duration and the engine, when the renderer is ready. */
  const clipContext = useCallback(() => {
    const r = rendererRef.current;
    const engine = engineRef.current;
    if (r === null || engine === null) return null;
    const clipRef = store.getState().previewClip;
    const selection = inputRef.current
      .render()
      .animations.find(a => a.clipId === clipRef);
    const durationSec =
      registryRef.current?.clipEntry(clipRef)?.durationSec ?? 0;
    return {r, engine, selection, durationSec};
  }, [store]);

  /** "Show export frames" (REQ-ANM-018): the engine default steps the export frames. */
  const applyTiming = useCallback((): void => {
    const c = clipContext();
    if (c === null) return;
    if (store.getState().showExportFrames || c.selection === undefined) {
      c.r.setPreviewTiming(null);
    } else {
      c.r.setPreviewTiming(
        c.engine.previewTimingFor(c.selection, c.durationSec, false),
      );
    }
  }, [clipContext, store]);

  useEffect(() => {
    if (status === 'ready') applyTiming();
  }, [status, showExportFrames, applyTiming]);

  // A seek request pauses and shows that frame's sample time (REQ-ANM-017).
  useEffect(() => {
    if (status !== 'ready' || seek === null) return;
    const c = clipContext();
    if (c === null) return;
    const frameCount = c.selection?.frameCount ?? 8;
    let time = (seek.frame / Math.max(1, frameCount)) * c.durationSec;
    if (c.selection !== undefined) {
      time =
        c.engine.computeSampleTimes(c.selection, c.durationSec).times[
          seek.frame
        ] ?? time;
    }
    c.r.pause();
    c.r.seek(time);
  }, [status, seek, clipContext]);

  // While playing, the playhead follows the renderer (REQ-ANM-017).
  useEffect(() => {
    if (status !== 'ready' || !playing) return;
    const timer = setInterval(() => {
      const c = clipContext();
      if (c === null || !c.r.playing) return;
      const t = c.r.timeSec;
      const frameCount = c.selection?.frameCount ?? 8;
      let frame = Math.floor((t / Math.max(1e-9, c.durationSec)) * frameCount);
      if (c.selection !== undefined && store.getState().showExportFrames) {
        const times = c.engine.computeSampleTimes(
          c.selection,
          c.durationSec,
        ).times;
        frame = 0;
        for (let i = 0; i < times.length; i++) {
          if ((times[i] ?? 0) <= t + 1e-6) frame = i;
        }
      }
      store.setFrame(Math.min(Math.max(0, frame), frameCount - 1));
    }, 40);
    return () => clearInterval(timer);
  }, [status, playing, clipContext, store]);

  // Diagnostics for the e2e check that palette LUTs are built in the worker (AC-GEN-014.1).
  useEffect(() => {
    if (status !== 'ready') return;
    const read = (): void => {
      const s = rendererRef.current?.paletteLutStats;
      if (s === undefined) return;
      setLutStats(prev =>
        prev.workerBuilds === s.workerBuilds &&
        prev.mainThreadBuilds === s.mainThreadBuilds &&
        prev.failures === s.failures
          ? prev
          : {
              workerBuilds: s.workerBuilds,
              mainThreadBuilds: s.mainThreadBuilds,
              failures: s.failures,
            },
      );
    };
    read();
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
  }, [status]);

  // The shared viewport state drives the renderer.
  useEffect(() => {
    const r = rendererRef.current;
    if (status !== 'ready' || r === null) return;
    r.setDirection(direction);
    if (appliedClip.current !== clip) {
      appliedClip.current = clip;
      void r.playClip(clip).then(res => {
        if (!res.ok) report(res.error);
        else {
          applyTiming();
          if (!store.getState().playing) r.pause();
        }
      });
    } else if (playing && !r.playing) {
      if (!r.resume()) void r.playClip(clip);
    } else if (!playing && r.playing) {
      r.pause();
    }
    const three = threeDOf(r);
    if (three !== null && appliedMode.current !== mode) {
      appliedMode.current = mode;
      three.setViewMode(mode);
      // Pixel is the cell at an integer zoom, 3D fills the stage at device pixels.
      sessionRef.current?.relayout();
    }
  }, [status, direction, clip, playing, mode, report, store, applyTiming]);

  useEffect(() => {
    if (status === 'ready') sessionRef.current?.relayout();
  }, [status, zoomState]);

  // Summary: at most one update per second, immediately after a discrete change when due.
  const lastSummary = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const compute = (): string => {
      const cur = inputRef.current;
      const spec = cur.target.getSpec();
      const settings = cur.render();
      const anim = settings.animations.find(a => a.clipId === clip);
      const r = rendererRef.current;
      const duration = registryRef.current?.clipEntry(clip)?.durationSec ?? 0;
      const frameCount = anim?.frameCount ?? null;
      return buildViewportSummary({
        label: cur.label,
        partCount: Object.keys(spec.parts).length + 1,
        clip,
        frame:
          r !== null && frameCount !== null
            ? frameAt(r.timeSec, duration, frameCount)
            : null,
        frameCount,
        direction,
        sizePx: settings.resolution.width,
        mode: effectiveMode,
      });
    };
    const tick = (): void => {
      lastSummary.current = Date.now();
      setSummary(compute());
      if (playing && status === 'ready') {
        timer = setTimeout(tick, SUMMARY_INTERVAL_MS);
      }
    };
    const wait = Math.max(
      0,
      SUMMARY_INTERVAL_MS - (Date.now() - lastSummary.current),
    );
    timer = setTimeout(tick, wait);
    return () => clearTimeout(timer);
  }, [clip, direction, effectiveMode, playing, status, input.label, seek]);

  const turn = useCallback(
    (delta: number): void => {
      store.stepDirection(delta);
      announce(facingAnnouncement(store.getState().direction));
    },
    [store],
  );

  const zoomBy = useCallback(
    (delta: 1 | -1): void => {
      const current = store.getState().zoom;
      const eff = current === 'fit' ? fitZoom : Math.min(current, fitZoom);
      store.setZoom(Math.min(fitZoom, Math.max(1, eff + delta)));
    },
    [store, fitZoom],
  );

  const frameCharacter = useCallback((): void => {
    const r = rendererRef.current;
    if (r !== null) threeDOf(r)?.frameCharacter?.();
  }, []);

  const orbit = useCallback((dYawDeg: number, dPitchDeg: number): void => {
    const r = rendererRef.current;
    if (r !== null) threeDOf(r)?.orbit?.(dYawDeg, dPitchDeg);
  }, []);

  const dismissError = useCallback(() => setError(undefined), []);
  const resume = useCallback((): void => {
    const r = rendererRef.current;
    if (r?.resume()) setError(undefined);
  }, []);

  return {
    stageRef,
    status,
    error: error?.message ?? null,
    errorCode: error?.code ?? null,
    summary,
    fitZoom,
    zoom,
    canThreeD,
    effectiveMode,
    lutStats,
    notice,
    restarting,
    turn,
    zoomBy,
    frameCharacter,
    orbit,
    dismissError,
    resume,
  };
}
