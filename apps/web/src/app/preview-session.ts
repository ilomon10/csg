import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
  Result,
} from '@csg/engine';
import type {CharacterSpec, ClipRef, RenderSettings} from '@csg/parts-schema';

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
  getBoundingClientRect(): {readonly width: number; readonly height: number};
}

/** Renderer options the session passes (a subset of `createCharacterRenderer`'s). */
export interface SessionRendererOptions {
  readonly registry: EngineAssetRegistry;
  /** Initial render settings (default preset, resolution and animations). */
  readonly settings: RenderSettings;
  readonly onError: (error: EngineError) => void;
}

/** Engine entry points the session uses; injectable so the lifecycle tests run in Node. */
export interface PreviewSessionDeps {
  createRegistry(): EngineAssetRegistry;
  loadPacks(registry: EngineAssetRegistry): Promise<void>;
  createRenderer(
    canvas: SessionCanvas,
    options: SessionRendererOptions,
  ): Promise<Result<EngineCharacterRenderer, EngineError>>;
  /** Calls `onResize` when the viewport resizes; returns a disconnect function. */
  /** Current `devicePixelRatio`. */
  devicePixelRatio(): number;
  observeResize(viewport: SessionViewport, onResize: () => void): () => void;
}

/** What the session starts with. */
export interface PreviewSessionPlan {
  readonly character: CharacterSpec;
  readonly clip: ClipRef;
  /** Initial render settings; must include the character's animations. */
  readonly settings: RenderSettings;
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
  /** Visible error text with its code (never a stack trace). */
  onError(message: string): void;
}

/** A running preview session. */
export interface PreviewSession {
  /**
   * Stops the session: disposes the renderer if it exists (or as soon as an
   * in-flight creation finishes) and never touches the canvas again.
   */
  cancel(): void;
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
 */
export function layoutPreview(
  canvas: SessionCanvas,
  viewport: SessionViewport,
  renderer: Pick<EngineCharacterRenderer, 'resize'>,
  devicePixelRatio: number,
): void {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const rect = viewport.getBoundingClientRect();
  const l = renderer.resize(
    Math.max(1, rect.width),
    Math.max(1, rect.height),
    dpr,
  );
  canvas.style.width = `${l.cssW}px`;
  canvas.style.height = `${l.cssH}px`;
  // Centre on a whole device pixel: a half-pixel offset would blur the upscale.
  const snap = (v: number): number => Math.floor(v * dpr) / dpr;
  canvas.style.marginLeft = `${snap(Math.max(0, (rect.width - l.cssW) / 2))}px`;
  canvas.style.marginTop = `${snap(Math.max(0, (rect.height - l.cssH) / 2))}px`;
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

  const fail = (message: string): void => {
    if (!cancelled) events.onError(message);
  };

  const run = async (): Promise<void> => {
    const registry = deps.createRegistry();
    await deps.loadPacks(registry);
    if (cancelled) return;
    const created = await deps.createRenderer(canvas, {
      registry,
      settings: plan.settings,
      onError: error => fail(`${error.code}: ${error.message}`),
    });
    if (!created.ok) {
      return fail(`${created.error.code}: ${created.error.message}`);
    }
    if (cancelled) {
      created.value.dispose();
      return;
    }
    renderer = created.value;
    layoutPreview(canvas, viewport, renderer, deps.devicePixelRatio());
    events.onRenderer(renderer, registry);
    const spec = await renderer.setCharacter(plan.character);
    if (cancelled) return;
    if (!spec.ok) return fail(`${spec.error.code}: ${spec.error.message}`);
    const played = await renderer.playClip(plan.clip);
    if (cancelled || !played.ok) return; // onError already reported it
    events.onReady({
      clipDurationSec: registry.clipEntry(plan.clip)?.durationSec ?? 0,
    });
    const live = renderer;
    disconnect = deps.observeResize(viewport, () =>
      layoutPreview(canvas, viewport, live, deps.devicePixelRatio()),
    );
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
      renderer?.dispose();
      renderer = null;
    },
    done,
  };
}
