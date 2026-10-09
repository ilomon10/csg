import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
  EngineNotice,
  PaletteLutWorker,
  Result,
} from '@csg/engine';
import type {CharacterSpec, ClipRef, RenderSettings} from '@csg/parts-schema';
import type {PreviewResize} from '@csg/engine';
import type {RendererLease} from './engine-host';

/**
 * The canvas fields the session writes (an `HTMLCanvasElement` fits). The
 * drawing buffer (`width`/`height`) belongs to the engine (cell size, REQ-PIX-031);
 * the session only sets the CSS size.
 */
export interface SessionCanvas {
  readonly style: {
    width: string;
    height: string;
    marginLeft: string;
    marginTop: string;
  };
}

/** The element whose size drives the drawing buffer. */
export interface SessionViewport {
  getBoundingClientRect(): {
    readonly width: number;
    readonly height: number;
    /** Viewport origin; with it the canvas lands on a whole device pixel (absent: 0). */
    readonly left?: number;
    readonly top?: number;
  };
}

/** Renderer options the session passes (a subset of `createCharacterRenderer`'s). */
export interface SessionRendererOptions {
  readonly registry: EngineAssetRegistry;
  /** Initial render settings (default preset, resolution and animations). */
  readonly settings: RenderSettings;
  readonly onError: (error: EngineError) => void;
  /** A notice was raised or cleared (REQ-CMP-043). */
  readonly onNotice?: (notice: EngineNotice, active: boolean) => void;
  /** Host-created palette LUT worker factory (REQ-GEN-014); absent: main-thread builds. */
  readonly paletteLutWorker?: () => PaletteLutWorker;
}

/** Engine entry points the session uses; injectable so the lifecycle tests run in Node. */
export interface PreviewSessionDeps {
  /**
   * Takes the one live renderer from the engine host (D4). When present it replaces
   * `createRegistry`, `loadPacks` and `createRenderer`, and `cancel()` releases the lease.
   */
  lease?(
    canvas: SessionCanvas,
    options: Pick<SessionRendererOptions, 'settings' | 'onError' | 'onNotice'>,
  ): Promise<Result<RendererLease, EngineError>>;
  createRegistry?(): EngineAssetRegistry;
  loadPacks?(registry: EngineAssetRegistry): Promise<void>;
  createRenderer?(
    canvas: SessionCanvas,
    options: SessionRendererOptions,
  ): Promise<Result<EngineCharacterRenderer, EngineError>>;
  /** Current `devicePixelRatio`. */
  devicePixelRatio(): number;
  /** Calls `onResize` when the viewport resizes; returns a disconnect function. */
  observeResize(viewport: SessionViewport, onResize: () => void): () => void;
  /** Calls `onChange` when `devicePixelRatio` changes (zoom, monitor move); returns a disconnect function. */
  observeDevicePixelRatio?(onChange: () => void): () => void;
  /** Releases what the registry caches; called once when the session is cancelled. */
  disposeRegistry?(registry: EngineAssetRegistry): void;
}

/** What the session starts with. */
export interface PreviewSessionPlan {
  readonly character: CharacterSpec;
  readonly clip: ClipRef;
  /** Initial render settings; must include the character's animations. */
  readonly settings: RenderSettings;
  /** Current integer zoom, or `'fit'` (default) for the largest that fits (REQ-UX-003). */
  readonly zoom?: () => number | 'fit';
  /**
   * The view in effect (default `pixel`). In `3d` the canvas fills the viewport and the
   * engine draws at device pixels (REQ-UX-003); in `pixel` it is the cell at an integer zoom.
   */
  readonly mode?: () => 'pixel' | '3d';
}

/** Session callbacks; none is called after `cancel()`. */
export interface PreviewSessionEvents {
  /** The renderer exists and owns the canvas. */
  onRenderer(
    renderer: EngineCharacterRenderer,
    registry: EngineAssetRegistry,
  ): void;
  /** The character is assembled and the clip plays. */
  onReady(info: {readonly clipDurationSec: number}): void;
  /**
   * Visible error text with its code (never a stack trace). `code` is the engine error
   * code when the failure came from the engine (see `classifyPreviewError`).
   */
  onError(message: string, code?: string): void;
  /** A notice was raised (`active`) or cleared; persistent and non-blocking (REQ-CMP-043). */
  onNotice?(notice: EngineNotice, active: boolean): void;
  /** The canvas was laid out; `fitScale` is the largest integer zoom that fits the viewport. */
  onLayout?(layout: PreviewResize, fitScale: number): void;
}

/** A running preview session. */
export interface PreviewSession {
  /**
   * Stops the session: disposes the renderer if it exists (or as soon as an
   * in-flight creation finishes) and never touches the canvas again.
   */
  cancel(): void;
  /** Lays the canvas out again (after a zoom or resolution change). No-op before the renderer exists. */
  relayout(): void;
  /** Settles when the start sequence ends (never rejects). */
  readonly done: Promise<void>;
}

/**
 * Lays the preview out in the viewport: the engine returns the integer-scaled
 * CSS size and the canvas shows its cell-sized buffer at that size
 * (`image-rendering: pixelated` in CSS, AC-PIX-031.1). Call again after a
 * settings change that alters the resolution.
 *
 * @param canvas Target canvas.
 * @param viewport Element that bounds the canvas.
 * @param renderer Renderer to lay out.
 * @param dpr Device pixel ratio.
 * @param zoom Integer device scale below the fit, or `'fit'` (the default).
 * @param mode `3d` fills the viewport at device resolution (no integer upscale).
 * @returns The layout and the fit scale.
 */
export function layoutPreview(
  canvas: SessionCanvas,
  viewport: SessionViewport,
  renderer: Pick<EngineCharacterRenderer, 'resize'>,
  devicePixelRatio: number,
  zoom: number | 'fit' = 'fit',
  mode: 'pixel' | '3d' = 'pixel',
): {readonly layout: PreviewResize; readonly fitScale: number} {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const rect = viewport.getBoundingClientRect();
  const fit = renderer.resize(
    Math.max(1, rect.width),
    Math.max(1, rect.height),
    dpr,
  );
  if (mode === '3d') {
    // The engine's drawing buffer follows the viewport at device pixels, so the canvas fills it
    // exactly: no fractional upscale of a low-res cell happens here.
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.style.marginLeft = '0px';
    canvas.style.marginTop = '0px';
    return {layout: fit, fitScale: fit.scale};
  }
  // An integer zoom below the fit asks the engine for exactly that many device pixels per
  // sprite pixel by offering it a viewport of that size (never fractional, P-05).
  const l =
    zoom !== 'fit' && Number.isInteger(zoom) && zoom >= 1 && zoom < fit.scale
      ? renderer.resize((fit.cellW * zoom) / dpr, (fit.cellH * zoom) / dpr, dpr)
      : fit;
  canvas.style.width = `${l.cssW}px`;
  canvas.style.height = `${l.cssH}px`;
  // Centre on a whole device pixel: a fractional position (the stage may sit at y = 141.875)
  // makes the browser snap the box edges separately, which blurs or skips sprite pixels.
  const snap = (origin: number, ideal: number): number =>
    Math.floor((origin + ideal) * dpr + 1e-6) / dpr - origin;
  canvas.style.marginLeft = `${snap(rect.left ?? 0, Math.max(0, (rect.width - l.cssW) / 2))}px`;
  canvas.style.marginTop = `${snap(rect.top ?? 0, Math.max(0, (rect.height - l.cssH) / 2))}px`;
  return {layout: l, fitScale: fit.scale};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts the preview: loads the bundled packs, creates the renderer on the
 * canvas, assembles the character and plays the clip. `cancelled` is checked
 * after every await, so a cancelled session (React StrictMode's first mount,
 * or an unmount during loading) never creates a renderer or writes the canvas
 * after `cancel()`, and at most one session at a time holds a live renderer.
 * Every failure, including a thrown one, becomes `onError` text.
 *
 * @param canvas Target canvas.
 * @param viewport Element whose size drives the drawing buffer.
 * @param plan Character and clip to show.
 * @param deps Engine entry points.
 * @param events Callbacks.
 * @returns The session.
 */
export function startPreviewSession(
  canvas: SessionCanvas,
  viewport: SessionViewport,
  plan: PreviewSessionPlan,
  deps: PreviewSessionDeps,
  events: PreviewSessionEvents,
): PreviewSession {
  let cancelled = false;
  let renderer: EngineCharacterRenderer | null = null;
  let disconnect: (() => void) | null = null;
  let registry: EngineAssetRegistry | null = null;
  let release: (() => void) | null = null;

  const layout = (r: Pick<EngineCharacterRenderer, 'resize'>): void => {
    const done = layoutPreview(
      canvas,
      viewport,
      r,
      deps.devicePixelRatio(),
      plan.zoom?.() ?? 'fit',
      plan.mode?.() ?? 'pixel',
    );
    events.onLayout?.(done.layout, done.fitScale);
  };

  const fail = (message: string, code?: string): void => {
    if (!cancelled) events.onError(message, code);
  };

  const run = async (): Promise<void> => {
    const failure = (error: EngineError): void =>
      fail(`${error.code}: ${error.message}`, error.code);
    const notice = (n: EngineNotice, active: boolean): void => {
      if (!cancelled) events.onNotice?.(n, active);
    };
    let reg: EngineAssetRegistry;
    if (deps.lease) {
      const leased = await deps.lease(canvas, {
        settings: plan.settings,
        onError: failure,
        onNotice: notice,
      });
      if (!leased.ok) return failure(leased.error);
      if (cancelled) {
        leased.value.release();
        return;
      }
      release = leased.value.release;
      renderer = leased.value.renderer;
      reg = leased.value.registry;
    } else {
      if (!deps.createRegistry || !deps.loadPacks || !deps.createRenderer) {
        throw new Error('preview session: no engine entry points');
      }
      reg = deps.createRegistry();
      registry = reg;
      await deps.loadPacks(reg);
      if (cancelled) return;
      const created = await deps.createRenderer(canvas, {
        registry: reg,
        settings: plan.settings,
        onError: failure,
        onNotice: notice,
      });
      if (!created.ok) return failure(created.error);
      if (cancelled) {
        created.value.dispose();
        return;
      }
      renderer = created.value;
    }
    layout(renderer);
    events.onRenderer(renderer, reg);
    const spec = await renderer.setCharacter(plan.character);
    if (cancelled) return;
    if (!spec.ok) {
      return fail(`${spec.error.code}: ${spec.error.message}`, spec.error.code);
    }
    const played = await renderer.playClip(plan.clip);
    if (cancelled || !played.ok) return; // onError already reported it
    events.onReady({
      clipDurationSec: reg.clipEntry(plan.clip)?.durationSec ?? 0,
    });
    const live = renderer;
    const relayout = (): void => layout(live);
    const stopResize = deps.observeResize(viewport, relayout);
    const stopDpr = deps.observeDevicePixelRatio?.(relayout);
    disconnect = () => {
      stopResize();
      stopDpr?.();
    };
  };

  const done = run().catch((error: unknown) => {
    fail(messageOf(error));
  });

  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      disconnect?.();
      disconnect = null;
      if (release !== null) release();
      else renderer?.dispose();
      release = null;
      renderer = null;
      if (registry !== null) deps.disposeRegistry?.(registry);
      registry = null;
    },
    relayout(): void {
      if (!cancelled && renderer !== null) layout(renderer);
    },
    done,
  };
}
