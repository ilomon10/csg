import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
  EngineNotice,
  Result,
} from '@csg/engine';
import type {RenderSettings} from '@csg/parts-schema';
import type * as PreviewEngineModule from './preview-engine';

/** The lazily loaded engine entry points (`./preview-engine`). */
export type PreviewEngine = typeof PreviewEngineModule;

/** What a lease asks for. The registry and the palette LUT worker come from the host. */
export interface LeaseOptions {
  /** Initial render settings. */
  readonly settings: RenderSettings;
  /** Renderer errors (the renderer reports recoverable ones here after creation). */
  readonly onError: (error: EngineError) => void;
  /** A notice was raised (`active`) or cleared (REQ-CMP-043); never an error. */
  readonly onNotice?: (notice: EngineNotice, active: boolean) => void;
  /**
   * Called when another view asks for a lease while this one is held. The holder should release
   * as soon as it is at a safe point (home frame generation stops after the current character).
   */
  readonly onPreempt?: () => void;
  /**
   * The holder is a long-lived view that stays usable while another feature runs an exclusive
   * operation on its renderer (the engine serializes them and restores the preview). Such a
   * lease can be {@link EngineHost.borrow}ed instead of preempted.
   */
  readonly shareable?: boolean;
}

/** A shareable lease's renderer lent to another feature; releasing it does nothing. */
export type RendererBorrow = RendererLease;

/** The one live renderer (architecture decision D4). */
export interface RendererLease {
  readonly renderer: EngineCharacterRenderer;
  readonly registry: EngineAssetRegistry;
  /** Disposes the renderer and frees the slot. Idempotent. */
  release(): void;
}

/**
 * Owns the lazily imported engine, one asset registry (packs load once) and the single live
 * renderer lease (D4): two views never hold a GPU device at the same time.
 */
export interface EngineHost {
  /** Imports the engine chunk (once). Call only after first contentful paint (REQ-UX-083). */
  load(): Promise<PreviewEngine>;
  /** The shared registry with the bundled packs registered (loaded once; a failure is retried). */
  registry(): Promise<EngineAssetRegistry>;
  /**
   * Borrows the live renderer of the current shareable lease (the mounted viewport), or `null`
   * when none is held. The borrower must run only engine exclusive operations
   * (`prepareFrames`, `renderFrames`) and never dispose it; `release()` is a no-op.
   */
  borrow(): RendererBorrow | null;
  /**
   * Like {@link borrow}, but when a shareable lease is still being acquired it waits for it.
   * Resolves to `null` only when no shareable lease is held or pending (the caller then takes a
   * fresh lease). A lease that does not become ready within `timeoutMs` is an error result, never
   * a hang.
   */
  borrowWhenReady(
    timeoutMs?: number,
  ): Promise<Result<RendererBorrow | null, EngineError>>;
  /**
   * Creates a renderer on `canvas`. Waits for the previous lease to be released and asks that
   * holder to release through `onPreempt`. Failures are results, never throws.
   */
  lease(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    options: LeaseOptions,
  ): Promise<Result<RendererLease, EngineError>>;
}

function engineFailure(error: unknown): EngineError {
  return {
    code: 'ENGINE_LOAD_FAILED',
    message: `The renderer failed to load: ${
      error instanceof Error ? error.message : String(error)
    }`,
  };
}

/**
 * Creates an engine host. `loadEngine` is injectable so tests run without three.js.
 *
 * @param loadEngine Imports the engine entry points; the default is the dynamic `import()`
 *   that Vite puts in its own chunk.
 */
export function createEngineHost(
  loadEngine: () => Promise<PreviewEngine> = () => import('./preview-engine'),
): EngineHost {
  let enginePromise: Promise<PreviewEngine> | null = null;
  let registryPromise: Promise<EngineAssetRegistry> | null = null;
  let tail: Promise<void> = Promise.resolve();
  let holder: LeaseOptions | null = null;
  let live: {
    readonly options: LeaseOptions;
    readonly renderer: EngineCharacterRenderer;
    readonly registry: EngineAssetRegistry;
  } | null = null;
  /** Requests that have asked for a lease and not acquired the slot yet. */
  let waiting = 0;
  /** Shareable lease requests that have not settled yet. */
  let pendingShareable = 0;
  let readyListeners: Array<() => void> = [];
  const settleShareable = (): void => {
    pendingShareable--;
    const listeners = readyListeners;
    readyListeners = [];
    for (const l of listeners) l();
  };
  const borrowNow = (): RendererBorrow | null => {
    if (live === null || live.options.shareable !== true) return null;
    return {
      renderer: live.renderer,
      registry: live.registry,
      release(): void {},
    };
  };

  const load = (): Promise<PreviewEngine> => {
    enginePromise ??= loadEngine().catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
    return enginePromise;
  };

  const registry = (): Promise<EngineAssetRegistry> => {
    registryPromise ??= (async () => {
      const engine = await load();
      const reg = engine.createAssetRegistry();
      await engine.loadBundledPacks(reg);
      return reg;
    })().catch((error: unknown) => {
      registryPromise = null;
      throw error;
    });
    return registryPromise;
  };

  return {
    load,
    registry,
    borrow: borrowNow,
    async borrowWhenReady(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (pendingShareable > 0) {
        const left = deadline - Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await Promise.race([
          new Promise<boolean>(resolve => {
            readyListeners.push(() => resolve(false));
          }),
          new Promise<boolean>(resolve => {
            timer = setTimeout(() => resolve(true), Math.max(0, left));
          }),
        ]);
        clearTimeout(timer);
        if (timedOut) {
          return {
            ok: false,
            error: {
              code: 'ENGINE_LOAD_FAILED',
              message: 'The preview renderer is not ready yet. Try again.',
            },
          };
        }
      }
      return {ok: true, value: borrowNow()};
    },
    async lease(canvas, options) {
      if (options.shareable !== true) return leaseInner(canvas, options);
      pendingShareable++;
      try {
        return await leaseInner(canvas, options);
      } finally {
        settleShareable();
      }
    },
  };

  async function leaseInner(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    options: LeaseOptions,
  ): Promise<Result<RendererLease, EngineError>> {
    {
      const previous = tail;
      let open!: () => void;
      tail = new Promise<void>(resolve => {
        open = resolve;
      });
      waiting++;
      holder?.onPreempt?.();
      await previous;
      waiting--;
      try {
        const engine = await load();
        const reg = await registry();
        const created = await engine.createCharacterRenderer(
          canvas as HTMLCanvasElement,
          {
            registry: reg,
            settings: options.settings,
            onError: options.onError,
            onNotice: options.onNotice,
            paletteLutWorker: engine.createPreviewPaletteLutWorker,
          },
        );
        if (!created.ok) {
          open();
          return created;
        }
        const renderer = created.value;
        holder = options;
        live = {options, renderer, registry: reg};
        // A later request is already queued: this holder is preempted from the start.
        if (waiting > 0) options.onPreempt?.();
        let released = false;
        return {
          ok: true,
          value: {
            renderer,
            registry: reg,
            release(): void {
              if (released) return;
              released = true;
              try {
                renderer.dispose();
                // Parsed scenes are per lease: the registry keeps its packs, not its scene cache.
                reg.loader.clear();
              } finally {
                if (holder === options) holder = null;
                if (live?.options === options) live = null;
                open();
              }
            },
          },
        };
      } catch (error) {
        open();
        return {ok: false, error: engineFailure(error)};
      }
    }
  }
}

/** The editor's engine host (one per page). */
export const engineHost: EngineHost = createEngineHost();
