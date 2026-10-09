import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineError,
} from '@csg/engine';
import {describe, expect, it} from 'vitest';
import type {CharacterSpec, ClipRef, RenderSettings} from '@csg/parts-schema';
import {startPreviewSession} from './preview-session';
import type {PreviewSessionDeps, SessionCanvas} from './preview-session';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return {promise, resolve};
}

const PLAN = {
  character: {} as CharacterSpec,
  clip: 'builtin:test/idle' as ClipRef,
  settings: {} as RenderSettings,
};

/** A canvas that records every CSS size write and who made it. */
function recordingCanvas() {
  const writes: string[] = [];
  let writer = '';
  const style = {
    set width(v: string) {
      writes.push(`${writer}:width=${v}`);
    },
    set height(v: string) {
      writes.push(`${writer}:height=${v}`);
    },
    set marginLeft(v: string) {
      writes.push(`${writer}:ml=${v}`);
    },
    set marginTop(v: string) {
      writes.push(`${writer}:mt=${v}`);
    },
  } as SessionCanvas['style'];
  const canvas: SessionCanvas & {as(name: string): void} = {
    style,
    as(name: string) {
      writer = name;
    },
  };
  return {canvas, writes};
}

/** Fake engine entry points with gated pack loading and renderer creation. */
function fakeEngine(options: {createThrows?: boolean} = {}) {
  const packs: Deferred[] = [];
  const creations: Deferred[] = [];
  const renderers: Array<{disposed: boolean; label: number}> = [];
  let observers = 0;
  let onErrorHook: ((e: EngineError) => void) | null = null;
  const deps: PreviewSessionDeps = {
    createRegistry: () =>
      ({clipEntry: () => ({durationSec: 2})}) as unknown as EngineAssetRegistry,
    loadPacks: async () => {
      const gate = deferred();
      packs.push(gate);
      await gate.promise;
    },
    createRenderer: async (_canvas, rendererOptions) => {
      onErrorHook = rendererOptions.onError;
      const gate = deferred();
      creations.push(gate);
      await gate.promise;
      if (options.createThrows === true) throw new Error('GPU device lost');
      const state = {disposed: false, label: renderers.length};
      renderers.push(state);
      const renderer = {
        backend: 'webgl2',
        setCharacter: async () => ({ok: true, value: undefined}),
        playClip: async () => ({ok: true, value: undefined}),
        resize: (w: number, h: number, dpr: number) => ({
          cellW: 64,
          cellH: 64,
          scale: 4,
          cssW: 256 / dpr,
          cssH: 256 / dpr,
          viewport: [w, h],
        }),
        dispose: () => {
          state.disposed = true;
        },
      } as unknown as EngineCharacterRenderer;
      return {ok: true, value: renderer};
    },
    devicePixelRatio: () => 2,
    observeResize: () => {
      observers++;
      return () => {
        observers--;
      };
    },
  };
  return {
    deps,
    packs,
    creations,
    renderers,
    reportError: (e: EngineError) => onErrorHook?.(e),
    live: () => renderers.filter(r => !r.disposed).length,
    observers: () => observers,
  };
}

const VIEWPORT = {getBoundingClientRect: () => ({width: 640, height: 480})};

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function events() {
  const log: string[] = [];
  return {
    log,
    events: {
      onRenderer: () => log.push('renderer'),
      onReady: () => log.push('ready'),
      onError: (m: string, code?: string) =>
        log.push(code === undefined ? `error:${m}` : `error:${code}:${m}`),
    },
  };
}

describe('preview session (M1-31 M1: StrictMode and cancellation)', () => {
  it('a StrictMode mount, cleanup, mount ends with exactly one live renderer; the cancelled run never touches the canvas', async () => {
    const engine = fakeEngine();
    const {canvas, writes} = recordingCanvas();
    const first = events();
    const second = events();
    // Mount 1, immediate cleanup, mount 2 (React StrictMode in development).
    canvas.as('first');
    const a = startPreviewSession(
      canvas,
      VIEWPORT,
      PLAN,
      engine.deps,
      first.events,
    );
    a.cancel();
    canvas.as('second');
    const b = startPreviewSession(
      canvas,
      VIEWPORT,
      PLAN,
      engine.deps,
      second.events,
    );
    // Both pack loads finish; only the live session creates a renderer.
    for (const gate of engine.packs) gate.resolve();
    await flush();
    expect(engine.creations).toHaveLength(1);
    for (const gate of engine.creations) gate.resolve();
    await Promise.all([a.done, b.done]);
    await flush();
    expect(engine.renderers).toHaveLength(1);
    expect(engine.live()).toBe(1);
    expect(engine.observers()).toBe(1);
    expect(writes.filter(w => w.startsWith('first'))).toEqual([]);
    // AC-PIX-031.1: the session sets the integer-scaled CSS size (cell x scale / dpr).
    expect(writes.slice(0, 2)).toEqual([
      'second:width=128px',
      'second:height=128px',
    ]);
    expect(first.log).toEqual([]);
    expect(second.log).toEqual(['renderer', 'ready']);
    b.cancel();
    expect(engine.live()).toBe(0);
    expect(engine.observers()).toBe(0);
  });

  it('a cancel while the renderer is being created disposes it as soon as it exists and reports nothing', async () => {
    const engine = fakeEngine();
    const {canvas} = recordingCanvas();
    const {log, events: ev} = events();
    const session = startPreviewSession(
      canvas,
      VIEWPORT,
      PLAN,
      engine.deps,
      ev,
    );
    engine.packs[0]?.resolve();
    await flush();
    session.cancel();
    engine.creations[0]?.resolve();
    await session.done;
    expect(engine.renderers).toHaveLength(1);
    expect(engine.live()).toBe(0);
    expect(log).toEqual([]);
  });

  it('architecture 4.4: a thrown start error becomes inline error text, never an unhandled rejection', async () => {
    const engine = fakeEngine({createThrows: true});
    const {canvas} = recordingCanvas();
    const {log, events: ev} = events();
    const session = startPreviewSession(
      canvas,
      VIEWPORT,
      PLAN,
      engine.deps,
      ev,
    );
    engine.packs[0]?.resolve();
    await flush();
    engine.creations[0]?.resolve();
    await expect(session.done).resolves.toBeUndefined();
    expect(log).toEqual(['error:GPU device lost']);
  });
});

describe('preview session (FX-W2 L9: registry disposal and DPR changes)', () => {
  it('cancel disposes the registry once, and a DPR change re-runs the layout until cancel', async () => {
    const engine = fakeEngine();
    const disposed: unknown[] = [];
    const dprListener: {fn: (() => void) | null} = {fn: null};
    let dpr = 2;
    const deps: PreviewSessionDeps = {
      ...engine.deps,
      devicePixelRatio: () => dpr,
      observeDevicePixelRatio: onChange => {
        dprListener.fn = onChange;
        return () => {
          dprListener.fn = null;
        };
      },
      disposeRegistry: registry => disposed.push(registry),
    };
    const {canvas, writes} = recordingCanvas();
    const s = startPreviewSession(
      canvas,
      VIEWPORT,
      PLAN,
      deps,
      events().events,
    );
    for (const gate of engine.packs) gate.resolve();
    await flush();
    for (const gate of engine.creations) gate.resolve();
    await s.done;
    expect(writes.slice(0, 2)).toEqual([':width=128px', ':height=128px']);
    dpr = 1;
    dprListener.fn?.();
    expect(writes.slice(-4, -2)).toEqual([':width=256px', ':height=256px']);
    s.cancel();
    s.cancel();
    expect(disposed).toHaveLength(1);
    expect(dprListener.fn).toBeNull();
  });

  it('a cancel before the renderer exists still disposes the registry', async () => {
    const engine = fakeEngine();
    const disposed: unknown[] = [];
    const s = startPreviewSession(
      recordingCanvas().canvas,
      VIEWPORT,
      PLAN,
      {...engine.deps, disposeRegistry: r => disposed.push(r)},
      events().events,
    );
    s.cancel();
    expect(disposed).toHaveLength(1);
  });
});

describe('preview session (FX-W3: error codes reach the host)', () => {
  it('AC-PIX-021.6: a renderer onError report is forwarded with its code', async () => {
    const engine = fakeEngine();
    const {canvas} = recordingCanvas();
    const {log, events: ev} = events();
    const session = startPreviewSession(
      canvas,
      VIEWPORT,
      PLAN,
      engine.deps,
      ev,
    );
    engine.packs[0]?.resolve();
    await flush();
    engine.creations[0]?.resolve();
    await session.done;
    engine.reportError({
      code: 'PIX_PALETTE_LUT_FAILED',
      message: 'worker rejected',
    } as EngineError);
    expect(log).toContain(
      'error:PIX_PALETTE_LUT_FAILED:PIX_PALETTE_LUT_FAILED: worker rejected',
    );
  });
});

describe('preview session (M3-08: engine host lease and integer zoom)', () => {
  function leaseDeps() {
    const released: number[] = [];
    let grant!: () => void;
    const granted = new Promise<void>(r => {
      grant = r;
    });
    const deps: PreviewSessionDeps = {
      devicePixelRatio: () => 1,
      observeResize: () => () => undefined,
      lease: async () => {
        await granted;
        const renderer = {
          backend: 'webgl2',
          setCharacter: async () => ({ok: true, value: undefined}),
          playClip: async () => ({ok: true, value: undefined}),
          resize: (w: number, h: number) => {
            const scale = Math.max(1, Math.floor(Math.min(w, h) / 64 + 1e-6));
            return {
              cellW: 64,
              cellH: 64,
              scale,
              cssW: 64 * scale,
              cssH: 64 * scale,
            };
          },
          dispose: () => undefined,
        } as unknown as EngineCharacterRenderer;
        return {
          ok: true as const,
          value: {
            renderer,
            registry: {
              clipEntry: () => ({durationSec: 2}),
            } as unknown as EngineAssetRegistry,
            release: () => void released.push(1),
          },
        };
      },
    };
    return {deps, released, grant};
  }

  it('REQ-UX-057: the session takes its renderer from the host lease and cancel releases it', async () => {
    const {deps, released, grant} = leaseDeps();
    const {canvas} = recordingCanvas();
    const {log, events: ev} = events();
    const session = startPreviewSession(canvas, VIEWPORT, PLAN, deps, ev);
    grant();
    await session.done;
    expect(log).toEqual(['renderer', 'ready']);
    session.cancel();
    expect(released).toEqual([1]);
  });

  it('REQ-UX-057: a session cancelled while the lease is pending releases it as soon as it is granted', async () => {
    const {deps, released, grant} = leaseDeps();
    const {canvas} = recordingCanvas();
    const {log, events: ev} = events();
    const session = startPreviewSession(canvas, VIEWPORT, PLAN, deps, ev);
    session.cancel();
    grant();
    await session.done;
    expect(released).toEqual([1]);
    expect(log).toEqual([]);
  });

  it('AC-UX-003.1: an integer zoom below the fit lays the canvas out at exactly that scale', async () => {
    const {deps, grant} = leaseDeps();
    const {canvas} = recordingCanvas();
    const layouts: Array<[number, number]> = [];
    let zoom: number | 'fit' = 6;
    const session = startPreviewSession(
      canvas,
      {getBoundingClientRect: () => ({width: 792, height: 788})},
      {...PLAN, zoom: () => zoom},
      deps,
      {
        ...events().events,
        onLayout: (l, fit) => layouts.push([l.scale, fit]),
      },
    );
    grant();
    await session.done;
    expect(layouts.at(-1)).toEqual([6, 12]);
    zoom = 'fit';
    session.relayout();
    expect(layouts.at(-1)).toEqual([12, 12]);
    zoom = 20; // above the fit: capped at the fit
    session.relayout();
    expect(layouts.at(-1)).toEqual([12, 12]);
    session.cancel();
  });
});
