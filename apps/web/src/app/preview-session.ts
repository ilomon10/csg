import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
  Result,
} from '@csg/engine';
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';

/** The canvas size fields the session writes (an `HTMLCanvasElement` fits). */
export interface SessionCanvas {
  width: number;
  height: number;
}

/** The element whose size drives the drawing buffer. */
export interface SessionViewport {
  getBoundingClientRect(): {readonly width: number; readonly height: number};
}

/** Renderer options the session passes (a subset of `createCharacterRenderer`'s). */
export interface SessionRendererOptions {
  readonly registry: EngineAssetRegistry;
  readonly previewScale: number;
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
  observeResize(viewport: SessionViewport, onResize: () => void): () => void;
}

/** What the session starts with. */
export interface PreviewSessionPlan {
  readonly character: CharacterSpec;
  readonly clip: ClipRef;
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
    const rect = viewport.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));
    const created = await deps.createRenderer(canvas, {
      registry,
      previewScale: 1,
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
    disconnect = deps.observeResize(viewport, () => {
      const r = viewport.getBoundingClientRect();
      live.resize(Math.max(1, r.width), Math.max(1, r.height));
    });
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
