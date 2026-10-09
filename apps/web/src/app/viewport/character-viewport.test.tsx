// @vitest-environment jsdom
import type {
  EngineAssetRegistry,
  EngineCharacterRenderer,
  EngineNotice,
  PreviewResize,
} from '@csg/engine';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {CharacterTarget} from '../../shared/document';
import {resetAnnouncer} from '../../shared/ui';
import {createViewportStore} from '../../shared/viewport';
import {CharacterViewport} from './character-viewport';
import {IDLE_CLIP, WALK_CLIP, createPreviewSettings} from './default-character';
import type {EngineHost, LeaseOptions} from './engine-host';

vi.mock('./after-first-paint', () => ({
  afterFirstContentfulPaint: (run: () => void) => {
    queueMicrotask(run);
    return () => undefined;
  },
}));

// Same rule as the engine's previewLayout (REQ-PIX-031): largest integer device scale that fits.
function layoutFor(w: number, h: number, dpr: number): PreviewResize {
  const cell = 64;
  const scale = Math.max(
    1,
    Math.floor(Math.min((w * dpr) / cell, (h * dpr) / cell) + 1e-6),
  );
  return {
    cellW: cell,
    cellH: cell,
    scale,
    cssW: (cell * scale) / dpr,
    cssH: (cell * scale) / dpr,
  };
}

interface Fake {
  renderer: EngineCharacterRenderer & Record<string, ReturnType<typeof vi.fn>>;
  host: EngineHost;
  release: ReturnType<typeof vi.fn>;
  /** Raises or clears an engine notice through the lease's `onNotice`. */
  notify(notice: EngineNotice, active: boolean): void;
}

function fake(options: {threeD?: boolean} = {}): Fake {
  let playing = true;
  const renderer = {
    backend: 'webgl2',
    get playing() {
      return playing;
    },
    timeSec: 0,
    setCharacter: vi.fn(async () => ({ok: true, value: undefined})),
    setRenderSettings: vi.fn(async () => ({ok: true, value: undefined})),
    playClip: vi.fn(async () => {
      playing = true;
      return {ok: true, value: undefined};
    }),
    setPreviewTiming: vi.fn(),
    seek: vi.fn(),
    paletteLutStats: {workerBuilds: 0, mainThreadBuilds: 0, failures: 0},
    pause: vi.fn(() => {
      playing = false;
    }),
    resume: vi.fn(() => {
      playing = true;
      return true;
    }),
    setDirection: vi.fn(),
    resize: vi.fn((w: number, h: number, dpr = 1) => layoutFor(w, h, dpr)),
    dispose: vi.fn(),
    ...(options.threeD
      ? {setViewMode: vi.fn(), frameCharacter: vi.fn(), orbit: vi.fn()}
      : {}),
  } as unknown as Fake['renderer'];
  const registry = {
    clipEntry: () => ({durationSec: 2}),
  } as unknown as EngineAssetRegistry;
  const release = vi.fn();
  let onNotice: LeaseOptions['onNotice'];
  const host: EngineHost = {
    load: async () =>
      ({
        previewTimingFor: () => ({}),
        computeSampleTimes: () => ({times: [0]}),
      }) as never,
    borrow: () => null,
    borrowWhenReady: async () => ({ok: true, value: null}),
    registry: async () => registry,
    lease: async (_canvas, leaseOptions) => {
      onNotice = leaseOptions.onNotice;
      return {ok: true, value: {renderer, registry, release}};
    },
  };
  return {
    renderer,
    host,
    release,
    notify: (notice, active) => onNotice?.(notice, active),
  };
}

function target(
  spec: CharacterSpec = {...createDefaultCharacterSpec(), name: 'Knight'},
) {
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

const RUN = 'builtin:quaternius-ual/run' as ClipRef;

function mount(
  f: Fake,
  extra: Partial<Parameters<typeof CharacterViewport>[0]> = {},
  store = createViewportStore(),
) {
  const view = render(
    <CharacterViewport
      target={extra.target ?? target()}
      render={createPreviewSettings}
      label="Knight"
      variant="easy"
      store={store}
      host={f.host}
      {...extra}
    />,
  );
  return {view, store};
}

async function ready(): Promise<HTMLElement> {
  const stage = await screen.findByTestId('viewport-stage');
  await vi.waitFor(() => expect(stage.dataset['status']).toBe('ready'));
  return stage;
}

beforeEach(() => {
  resetAnnouncer();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sizeStage(stage: HTMLElement, w: number, h: number): void {
  stage.getBoundingClientRect = () =>
    ({width: w, height: h, top: 0, left: 0, right: w, bottom: h}) as DOMRect;
  (globalThis as {ResizeObserver?: unknown}).ResizeObserver ??= class {
    observe(): void {}
    disconnect(): void {}
  };
}

describe('CharacterViewport', () => {
  beforeEach(() => {
    (globalThis as {ResizeObserver?: unknown}).ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    window.matchMedia ??= (() => ({
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as never;
  });

  it('AC-UX-057.1: shows the 64 px cell at the largest integer zoom that fits (792x788 gives 12x, 768x768)', async () => {
    const f = fake();
    const {view} = mount(f);
    const stage = await screen.findByTestId('viewport-stage');
    sizeStage(stage, 792, 788);
    await ready();
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    await vi.waitFor(() => {
      expect(canvas.style.width).toBe('768px');
      expect(canvas.style.height).toBe('768px');
      expect(stage.dataset['zoom']).toBe('12');
    });
  });

  it('AC-UX-003.1: integer zoom 6x gives a 384x384 CSS canvas', async () => {
    const f = fake();
    const store = createViewportStore({zoom: 6});
    const {view} = mount(f, {variant: 'pro'}, store);
    const stage = await screen.findByTestId('viewport-stage');
    sizeStage(stage, 792, 788);
    await ready();
    act(() => store.setZoom(6));
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    await vi.waitFor(() => expect(canvas.style.width).toBe('384px'));
    expect(canvas.style.height).toBe('384px');
    await vi.waitFor(() =>
      expect(screen.getByTestId('zoom').textContent).toBe('6×'),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Zoom in'}));
    expect(canvas.style.width).toBe('448px');
  });

  it('AC-UX-003.2: V toggles Pixel and 3D and aria-pressed follows (when the engine supports 3D)', async () => {
    const f = fake({threeD: true});
    const {store} = mount(f, {variant: 'pro'});
    const stage = await ready();
    const pixel = screen.getByRole('button', {name: 'Pixel'});
    const three = screen.getByRole('button', {name: '3D'});
    expect(pixel.getAttribute('aria-pressed')).toBe('true');
    stage.focus();
    fireEvent.keyDown(stage, {key: 'v'});
    expect(store.getState().mode).toBe('3d');
    expect(three.getAttribute('aria-pressed')).toBe('true');
    expect(pixel.getAttribute('aria-pressed')).toBe('false');
    expect(f.renderer['setViewMode']).toHaveBeenLastCalledWith('3d');
    fireEvent.keyDown(stage, {key: 'V'});
    expect(pixel.getAttribute('aria-pressed')).toBe('true');
  });

  it('REQ-UX-003: without engine 3D support the 3D option is disabled and Pixel stays shown', async () => {
    const f = fake();
    const {store} = mount(
      f,
      {variant: 'pro'},
      createViewportStore({mode: '3d'}),
    );
    const stage = await ready();
    expect(stage.dataset['view']).toBe('pixel');
    const three = screen.getByRole('button', {name: '3D'}) as HTMLButtonElement;
    expect(three.disabled).toBe(true);
    fireEvent.keyDown(stage, {key: 'v'});
    expect(store.getState().mode).toBe('3d'); // untouched
    expect(
      screen.getByRole('button', {name: 'Pixel'}).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('AC-UX-058.1: the right arrow twice moves two labels forward (wrapping) and announces it', async () => {
    const f = fake();
    const store = createViewportStore({direction: 6}); // s
    const {view} = mount(f, {}, store);
    const stage = await ready();
    stage.focus();
    fireEvent.keyDown(stage, {key: 'ArrowRight'});
    fireEvent.keyDown(stage, {key: 'ArrowRight'});
    expect(store.getState().direction).toBe(0); // s -> se -> e
    expect(f.renderer['setDirection']).toHaveBeenLastCalledWith(0);
    expect(
      view.container.querySelector('[data-testid="direction"]')?.textContent,
    ).toBe('E');
  });

  it('AC-UX-058.1: the labelled turn buttons are the non-drag alternative', async () => {
    const f = fake();
    const store = createViewportStore({direction: 6});
    mount(f, {}, store);
    await ready();
    fireEvent.click(screen.getByRole('button', {name: 'Turn left'}));
    expect(store.getState().direction).toBe(5);
    fireEvent.click(screen.getByRole('button', {name: 'Turn right'}));
    fireEvent.click(screen.getByRole('button', {name: 'Turn right'}));
    expect(store.getState().direction).toBe(7);
  });

  it('AC-UX-058.2: a 100 px drag to the right moves exactly 2 steps', async () => {
    const f = fake();
    const store = createViewportStore({direction: 0});
    mount(f, {}, store);
    const stage = await ready();
    fireEvent.pointerDown(stage, {clientX: 200, button: 0, pointerId: 1});
    fireEvent.pointerMove(stage, {clientX: 250, pointerId: 1});
    expect(store.getState().direction).toBe(1);
    fireEvent.pointerMove(stage, {clientX: 300, pointerId: 1});
    fireEvent.pointerUp(stage, {clientX: 300, pointerId: 1});
    expect(store.getState().direction).toBe(2);
    // Dragging back below one step restores the start.
    fireEvent.pointerMove(stage, {clientX: 100, pointerId: 1});
    expect(store.getState().direction).toBe(2);
  });

  it('AC-UX-059.1: with clip run neither Idle nor Walk is pressed and the name is shown; Walk plays walk', async () => {
    const f = fake();
    const store = createViewportStore({previewClip: RUN});
    mount(f, {}, store);
    await ready();
    expect(
      screen.getByRole('button', {name: 'Idle'}).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByRole('button', {name: 'Walk'}).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByTestId('clip-name').textContent).toBe('run');
    fireEvent.click(screen.getByRole('button', {name: 'Walk'}));
    expect(store.getState().previewClip).toBe(WALK_CLIP);
    await vi.waitFor(() =>
      expect(f.renderer['playClip']).toHaveBeenLastCalledWith(WALK_CLIP),
    );
    expect(
      screen.getByRole('button', {name: 'Walk'}).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByTestId('clip-name')).toBeNull();
  });

  it('AC-UX-051.2: the viewport shows the mode, direction and clip already in the shared store', async () => {
    const f = fake({threeD: true});
    const store = createViewportStore({direction: 1, previewClip: WALK_CLIP});
    mount(f, {variant: 'pro'}, store);
    await ready();
    await vi.waitFor(() =>
      expect(f.renderer['setDirection']).toHaveBeenLastCalledWith(1),
    );
    expect(f.renderer['playClip']).toHaveBeenCalledWith(WALK_CLIP);
    expect(
      screen.getByRole('button', {name: 'Walk'}).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByTestId('direction').textContent).toBe('NE');
  });

  it('AC-UX-039.1: the live summary names the clip and updates within a second of a clip change', async () => {
    const f = fake();
    const store = createViewportStore();
    mount(f, {}, store);
    await ready();
    await vi.waitFor(() =>
      expect(screen.getByTestId('viewport-summary').textContent).toContain(
        'idle',
      ),
    );
    expect(screen.getByTestId('viewport-summary').textContent).toMatch(
      /^Knight: \d+ parts, idle, frame \d+ of \d+, direction \d of 8, 64 px, Pixel view$/,
    );
    act(() => store.setPreviewClip(RUN));
    await vi.waitFor(
      () =>
        expect(screen.getByTestId('viewport-summary').textContent).toContain(
          'run',
        ),
      {timeout: 1500},
    );
  });

  it('REQ-UX-039: the canvas has an accessible name and the stage is focusable with the summary as description', async () => {
    const f = fake();
    const {view} = mount(f);
    const stage = await ready();
    expect(
      view.container.querySelector('canvas')?.getAttribute('aria-label'),
    ).toBe('Knight');
    expect(stage.tabIndex).toBe(0);
    const describedBy = stage.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)).not.toBeNull();
  });

  it('AC-UX-097.1 / REQ-UX-097: the placeholder image shows until the live preview is ready; the wizard has no mode toggle', async () => {
    const f = fake();
    const {view} = mount(f, {
      variant: 'wizard',
      placeholderUrl: '/packs/x/thumb.png',
    });
    expect(view.container.querySelector('img.cv__placeholder')).not.toBeNull();
    expect(screen.queryByRole('button', {name: '3D'})).toBeNull();
    await ready();
    expect(view.container.querySelector('img.cv__placeholder')).toBeNull();
  });

  it('REQ-UX-057: character edits reach the renderer; unmount releases the lease', async () => {
    const f = fake();
    const t = target();
    const {view} = mount(f, {target: t});
    await ready();
    (f.renderer['setCharacter'] as ReturnType<typeof vi.fn>).mockClear();
    t.set({...t.getSpec(), tints: {...t.getSpec().tints, hair: '#ff00ff'}});
    await vi.waitFor(() =>
      expect(f.renderer['setCharacter']).toHaveBeenCalledTimes(1),
    );
    view.unmount();
    expect(f.release).toHaveBeenCalled();
  });

  it('REQ-UX-051: the idle clip toggle is pressed for the default idle clip', async () => {
    const f = fake();
    mount(f);
    await ready();
    expect(IDLE_CLIP).toBeDefined();
    expect(
      screen.getByRole('button', {name: 'Idle'}).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('AC-CMP-043.1: an engine notice shows persistently as text, not as an error alert', async () => {
    const f = fake();
    const onNotice = vi.fn();
    mount(f, {onNotice});
    await ready();
    const notice = {
      code: 'CMP_STYLE_UNSUPPORTED',
      message: 'Stickman is coming soon. Showing Realistic for now.',
    } as EngineNotice;
    act(() => f.notify(notice, true));
    const shown = screen.getByTestId('viewport-notice');
    expect(shown.textContent).toBe(notice.message);
    expect(shown.dataset['code']).toBe('CMP_STYLE_UNSUPPORTED');
    expect(onNotice).toHaveBeenCalledWith({
      code: 'CMP_STYLE_UNSUPPORTED',
      message: notice.message,
    });
    expect(screen.queryByTestId('preview-error')).toBeNull();
  });

  it('AC-CMP-043.3: the notice disappears when the engine clears it', async () => {
    const f = fake();
    mount(f);
    await ready();
    const notice = {
      code: 'CMP_STYLE_UNSUPPORTED',
      message: 'Monster is coming soon. Showing Human for now.',
    } as EngineNotice;
    act(() => f.notify(notice, true));
    expect(screen.queryByTestId('viewport-notice')).not.toBeNull();
    act(() => f.notify(notice, false));
    expect(screen.queryByTestId('viewport-notice')).toBeNull();
  });

  it('AC-UX-003.1: in 3D mode the canvas fills the stage at device pixels, in Pixel it is the integer-scaled cell', async () => {
    const f = fake({threeD: true});
    const {view, store} = mount(f, {variant: 'pro'});
    const stage = await screen.findByTestId('viewport-stage');
    sizeStage(stage, 792, 788);
    await ready();
    const canvas = view.container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('768px');
    act(() => store.setMode('3d'));
    expect(stage.dataset['view']).toBe('3d');
    expect(canvas.style.width).toBe('792px');
    expect(canvas.style.height).toBe('788px');
    expect(f.renderer['resize']).toHaveBeenLastCalledWith(792, 788, 1);
    act(() => store.setMode('pixel'));
    expect(canvas.style.width).toBe('768px');
  });

  it('AC-UX-003.2: a drag orbits in 3D mode and leaves the direction alone; in Pixel it still turns', async () => {
    const f = fake({threeD: true});
    const store = createViewportStore({direction: 0, mode: '3d'});
    mount(f, {variant: 'pro'}, store);
    const stage = await ready();
    fireEvent.pointerDown(stage, {
      clientX: 200,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(stage, {clientX: 300, clientY: 120, pointerId: 1});
    fireEvent.pointerUp(stage, {clientX: 300, clientY: 120, pointerId: 1});
    expect(f.renderer['orbit']).toHaveBeenCalledWith(-50, 10);
    expect(store.getState().direction).toBe(0);
    act(() => store.setMode('pixel'));
    fireEvent.pointerDown(stage, {
      clientX: 0,
      clientY: 0,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(stage, {clientX: 100, clientY: 0, pointerId: 1});
    fireEvent.pointerUp(stage, {clientX: 100, clientY: 0, pointerId: 1});
    expect(store.getState().direction).toBe(2);
    expect(f.renderer['orbit']).toHaveBeenCalledTimes(1);
  });

  it('AC-UX-003.2: F and the Frame button frame the character in 3D', async () => {
    const f = fake({threeD: true});
    const store = createViewportStore({mode: '3d'});
    mount(f, {variant: 'pro'}, store);
    const stage = await ready();
    stage.focus();
    fireEvent.keyDown(stage, {key: 'f'});
    expect(f.renderer['frameCharacter']).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name: 'Frame character'}));
    expect(f.renderer['frameCharacter']).toHaveBeenCalledTimes(2);
    act(() => store.setMode('pixel'));
    expect(
      (
        screen.getByRole('button', {
          name: 'Frame character',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('AC-UX-058.1: arrows still turn the direction in 3D mode (spec defines no orbit keys)', async () => {
    const f = fake({threeD: true});
    const store = createViewportStore({direction: 6, mode: '3d'});
    mount(f, {variant: 'pro'}, store);
    const stage = await ready();
    stage.focus();
    fireEvent.keyDown(stage, {key: 'ArrowRight'});
    expect(store.getState().direction).toBe(7);
    expect(f.renderer['orbit']).not.toHaveBeenCalled();
  });
});
