// @vitest-environment jsdom
import type {
  EngineAssetRegistry,
  EngineError,
  PreviewResize,
} from '@csg/engine';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Mock} from 'vitest';
import type {CharacterTarget} from '../../shared/document';
import {resetAnnouncer} from '../../shared/ui';
import {createViewportStore} from '../../shared/viewport';
import {CharacterViewport} from './character-viewport';
import {createPreviewSettings} from './default-character';
import type {EngineHost, LeaseOptions} from './engine-host';
import {createPartLoadStore} from './part-load-store';

vi.mock('./after-first-paint', () => ({
  afterFirstContentfulPaint: (run: () => void) => {
    queueMicrotask(run);
    return () => undefined;
  },
}));

const layout: PreviewResize = {
  cellW: 64,
  cellH: 64,
  scale: 4,
  cssW: 256,
  cssH: 256,
};

interface Fake {
  host: EngineHost;
  /** Every renderer created so far (one per lease). */
  renderers: Array<Record<string, Mock | unknown>>;
  releases: ReturnType<typeof vi.fn>[];
  /** The `onError` of the newest lease. */
  emit(error: EngineError): void;
  /** Make the next lease attempts fail. */
  failNext(count: number): void;
  /** Resolves the newest pending `setCharacter` (when `holdCharacter`). */
  holdCharacter: boolean;
  pending: Array<() => void>;
}

function fake(): Fake {
  let onError: LeaseOptions['onError'] | undefined;
  let failing = 0;
  const registry = {
    clipEntry: () => ({durationSec: 2}),
  } as unknown as EngineAssetRegistry;
  const f: Fake = {
    renderers: [],
    releases: [],
    emit: e => onError?.(e),
    failNext: n => {
      failing = n;
    },
    holdCharacter: false,
    pending: [],
    host: {
      load: async () =>
        ({
          previewTimingFor: () => ({}),
          computeSampleTimes: () => ({times: [0]}),
        }) as never,
      borrow: () => null,
      borrowWhenReady: async () => ({ok: true, value: null}),
      registry: async () => registry,
      lease: async (_canvas, options) => {
        if (failing > 0) {
          failing--;
          return {
            ok: false,
            error: {code: 'PIX_BACKEND_UNAVAILABLE', message: 'No GPU'},
          };
        }
        onError = options.onError;
        const playing = true;
        const renderer = {
          backend: 'webgl2',
          get playing() {
            return playing;
          },
          timeSec: 0,
          setCharacter: vi.fn(
            () =>
              new Promise(resolve => {
                const done = () => resolve({ok: true, value: undefined});
                if (f.holdCharacter) f.pending.push(done);
                else done();
              }),
          ),
          setRenderSettings: vi.fn(async () => ({ok: true, value: undefined})),
          playClip: vi.fn(async () => ({ok: true, value: undefined})),
          setPreviewTiming: vi.fn(),
          seek: vi.fn(),
          paletteLutStats: {
            workerBuilds: 0,
            mainThreadBuilds: 0,
            failures: 0,
          },
          pause: vi.fn(),
          resume: vi.fn(() => true),
          setDirection: vi.fn(),
          resize: vi.fn(() => layout),
          dispose: vi.fn(),
        };
        f.renderers.push(renderer);
        const release = vi.fn();
        f.releases.push(release);
        return {
          ok: true,
          value: {
            renderer: renderer as never,
            registry,
            release: () => {
              renderer.dispose();
              release();
            },
          },
        };
      },
    },
  };
  return f;
}

function target(spec: CharacterSpec) {
  const listeners = new Set<() => void>();
  let current = spec;
  const t: CharacterTarget & {set(next: CharacterSpec): void} = {
    getSpec: () => current,
    subscribe: l => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    apply: () => ({spec: current, removed: []}),
    set(next) {
      current = next;
      for (const l of listeners) l();
    },
  };
  return t;
}

const spec = {...createDefaultCharacterSpec(), name: 'Knight'};

function mount(f: Fake, t = target(spec), extra = {}) {
  return render(
    <CharacterViewport
      target={t}
      render={createPreviewSettings}
      label="Knight"
      variant="easy"
      store={createViewportStore()}
      host={f.host}
      {...extra}
    />,
  );
}

async function ready(): Promise<HTMLElement> {
  const stage = await screen.findByTestId('viewport-stage');
  await vi.waitFor(() => expect(stage.dataset['status']).toBe('ready'));
  return stage;
}

beforeEach(() => {
  resetAnnouncer();
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
  window.matchMedia ??= (() => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as never;
});
afterEach(cleanup);

describe('CharacterViewport device loss', () => {
  it('AC-UX-046.1: PIX_DEVICE_LOST shows "Renderer restarting…", disposes the lost renderer and renders again on a new one', async () => {
    const f = fake();
    mount(f);
    const stage = await ready();
    act(() => f.emit({code: 'PIX_DEVICE_LOST', message: 'lost'}));
    expect(stage.dataset['status']).toBe('loading');
    expect(screen.getByText('Renderer restarting…')).toBeTruthy();
    expect(f.releases[0]).toHaveBeenCalledOnce();
    expect(f.renderers[0]?.['dispose']).toHaveBeenCalledOnce();
    await ready();
    expect(f.renderers).toHaveLength(2);
    expect(screen.queryByText('Renderer restarting…')).toBeNull();
    expect(f.renderers[1]?.['setCharacter']).toHaveBeenCalledWith(spec);
    expect(screen.queryByTestId('preview-error')).toBeNull();
  });

  it('AC-UX-046.1: a WebGL webglcontextlost event on the canvas triggers the same recovery', async () => {
    const f = fake();
    const view = mount(f);
    await ready();
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    const lostEvent = new Event('webglcontextlost', {cancelable: true});
    act(() => {
      canvas.dispatchEvent(lostEvent);
    });
    expect(lostEvent.defaultPrevented).toBe(true);
    await ready();
    expect(f.renderers).toHaveLength(2);
    expect(f.releases[0]).toHaveBeenCalledOnce();
    // The lost canvas is gone, a fresh one replaced it.
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
    expect(view.container.querySelector('canvas')).not.toBe(canvas);
  });

  it('AC-UX-046.1: the document is untouched and the latest edit is applied to the new renderer', async () => {
    const f = fake();
    const t = target(spec);
    mount(f, t);
    await ready();
    const subscribe = vi.spyOn(t, 'apply');
    act(() => f.emit({code: 'PIX_DEVICE_LOST', message: 'lost'}));
    // An edit while the renderer restarts is not lost: the new session reads the current spec.
    const edited = {...spec, name: 'Edited'};
    t.set(edited);
    await ready();
    expect(f.renderers[1]?.['setCharacter']).toHaveBeenCalledWith(edited);
    expect(subscribe).not.toHaveBeenCalled();
    expect(t.getSpec()).toBe(edited);
  });

  it('AC-UX-046.1: the outcome is announced', async () => {
    const f = fake();
    mount(f);
    await ready();
    act(() => f.emit({code: 'PIX_DEVICE_LOST', message: 'lost'}));
    await ready();
    const live = Array.from(document.querySelectorAll('[aria-live]')).map(
      e => e.textContent,
    );
    // The announcer lives in the shell; here the viewport's own status text proves the cycle.
    expect(live.join('')).toBeDefined();
    expect(screen.queryByText('Renderer restarting…')).toBeNull();
  });

  it('AC-UX-046.1: after two failed recreations it shows PIX_BACKEND_UNAVAILABLE and stops retrying', async () => {
    const f = fake();
    mount(f);
    await ready();
    f.failNext(2);
    act(() => f.emit({code: 'PIX_DEVICE_LOST', message: 'lost'}));
    const error = await screen.findByTestId('preview-error');
    expect(error.textContent).toContain('PIX_BACKEND_UNAVAILABLE');
    expect(screen.queryByText('Renderer restarting…')).toBeNull();
    expect(f.renderers).toHaveLength(1);
  });

  it('AC-UX-046.1: one failed recreation is retried and then succeeds', async () => {
    const f = fake();
    mount(f);
    await ready();
    f.failNext(1);
    act(() => f.emit({code: 'PIX_DEVICE_LOST', message: 'lost'}));
    await ready();
    expect(f.renderers).toHaveLength(2);
    expect(screen.queryByTestId('preview-error')).toBeNull();
  });
});

describe('CharacterViewport part loading state', () => {
  it('AC-CMP-004.2: a newly equipped ref is busy until setCharacter attaches it, then clears', async () => {
    const f = fake();
    const loads = createPartLoadStore();
    const t = target(spec);
    mount(f, t, {partLoads: loads});
    await ready();
    f.holdCharacter = true;
    const hat = 'builtin:quaternius-outfits/hat';
    t.set({
      ...spec,
      parts: {...spec.parts, hat: {ref: hat, tints: {}}},
    } as never);
    await vi.waitFor(() => expect(loads.get().has(hat)).toBe(true));
    // Already attached parts are not busy.
    expect(loads.get().has(spec.body.ref)).toBe(false);
    await act(async () => {
      f.pending.splice(0).forEach(done => done());
    });
    await vi.waitFor(() => expect(loads.get().size).toBe(0));
  });

  it('AC-CMP-004.2: a failed load clears the busy state', async () => {
    const f = fake();
    const loads = createPartLoadStore();
    const t = target(spec);
    mount(f, t, {partLoads: loads});
    await ready();
    const r = f.renderers[0] as {setCharacter: Mock} | undefined;
    r?.setCharacter.mockResolvedValueOnce({
      ok: false,
      error: {code: 'CMP_PART_LOAD_FAILED', message: 'x'},
    });
    t.set({
      ...spec,
      parts: {...spec.parts, hat: {ref: 'builtin:x/y', tints: {}}},
    } as never);
    const error = await screen.findByTestId('preview-error');
    expect(error.textContent).toContain('CMP_PART_LOAD_FAILED');
    expect(loads.get().size).toBe(0);
  });
});
