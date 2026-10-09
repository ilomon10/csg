import type {EngineCharacterRenderer} from '@csg/engine';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';
import {describe, expect, it, vi} from 'vitest';
import type {HomeFramesRecord} from '../../shared/persistence';
import type {EngineHost, RendererLease} from '../viewport/engine-host';
import {
  createHomeFrameService,
  MAX_ANIMATED,
  outwardOrder,
} from './home-frame-service';
import type {HomeFrameServiceOptions, LineupEntry} from './home-frame-service';

const IDLE = {
  ref: 'builtin:quaternius-ual/idle' as ClipRef,
  frameCount: 4,
  fps: 5,
};

function frame(): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
} {
  const pixels = new Uint8ClampedArray(64 * 64 * 4);
  pixels.set([200, 100, 50, 255], (10 * 64 + 30) * 4);
  return {width: 64, height: 64, pixels};
}

interface Harness {
  options: HomeFrameServiceOptions;
  rendered: string[];
  renderFramesCalls: () => number;
  puts: HomeFramesRecord[];
  store: Map<string, HomeFramesRecord>;
  decoded: {open: number};
  yields: () => number;
  leases: () => number;
  hidden: {value: boolean; fire(): void};
  releases: () => number;
  onPreempt: () => void;
}

function harness(
  overrides: Partial<HomeFrameServiceOptions> = {},
  preseeded: HomeFramesRecord[] = [],
): Harness {
  const rendered: string[] = [];
  let renderFramesCalls = 0;
  let yields = 0;
  let leases = 0;
  let releases = 0;
  const preempt: {fn: () => void} = {fn: () => undefined};
  const store = new Map(preseeded.map(r => [r.key, r]));
  const puts: HomeFramesRecord[] = [];
  const decoded = {open: 0};
  const hidden = {
    value: false,
    listeners: new Set<() => void>(),
    fire() {
      for (const l of this.listeners) l();
    },
  };
  const renderer = {
    setCharacter: vi.fn(async (spec: CharacterSpec) => {
      rendered.push(spec.name);
      return {ok: true as const, value: undefined};
    }),
    prepareFrames: vi.fn(async () => ({ok: true as const, value: {} as never})),
    renderFrames: vi.fn(async function* () {
      renderFramesCalls++;
      for (let i = 0; i < IDLE.frameCount; i++) yield frame();
    }),
  } as unknown as EngineCharacterRenderer;
  const host: EngineHost = {
    load: async () => ({}) as never,
    registry: async () => ({}) as never,
    borrow: () => null,
    borrowWhenReady: async () => ({ok: true, value: null}),
    lease: async (_canvas, opts) => {
      leases++;
      preempt.fn = opts.onPreempt ?? (() => undefined);
      const lease: RendererLease = {
        renderer,
        registry: {} as never,
        release: () => {
          releases++;
        },
      };
      return {ok: true, value: lease};
    },
  };
  const img = (w: number, h: number) => {
    decoded.open++;
    return {width: w, height: h, close: () => void decoded.open--};
  };
  const options: HomeFrameServiceOptions = {
    host,
    packVersions: ['p@0000000000000001'],
    idleClip: () => IDLE,
    repository: {
      get: async key => {
        const record = store.get(key);
        if (record === undefined) return null;
        return {
          record,
          strip: img(64 * record.frameCount, 64),
          avatar: img(64, 64),
        };
      },
      put: async record => {
        puts.push(record);
        store.set(record.key, record);
      },
      touch: async () => undefined,
      evictUnreferenced: async () => 0,
    },
    decode: async blob => img(blob.size > 1000 ? 64 * IDLE.frameCount : 64, 64),
    encodePng: async (_pixels, w) =>
      new Blob([new Uint8Array(w > 64 ? 2000 : 500)]),
    yieldToMain: async () => {
      yields++;
    },
    visibility: {
      isHidden: () => hidden.value,
      subscribe: l => {
        hidden.listeners.add(l);
        return () => void hidden.listeners.delete(l);
      },
    },
    afterFirstPaint: async () => undefined,
    createCanvas: () => ({}) as HTMLCanvasElement,
    now: () => 1,
    ...overrides,
  };
  return {
    options,
    rendered,
    renderFramesCalls: () => renderFramesCalls,
    puts,
    store,
    decoded,
    yields: () => yields,
    leases: () => leases,
    releases: () => releases,
    hidden,
    onPreempt: () => preempt.fn(),
  };
}

function lineup(n: number, hair = '#000000'): LineupEntry[] {
  return Array.from({length: n}, (_, i) => {
    const base = createDefaultCharacterSpec();
    return {
      id: `c${i}`,
      spec: {
        ...base,
        name: `Hero ${i}`,
        tints: {...base.tints, hair: i === 0 ? hair : base.tints.hair},
        seed: i,
      },
    };
  });
}

const settle = async (ms = 20): Promise<void> => {
  await new Promise(r => setTimeout(r, ms));
};

describe('home frame service', () => {
  it('REQ-UX-080: renders the selected character first, then outward, one at a time', async () => {
    const h = harness();
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(5), 2);
    await vi.waitFor(() => expect(h.rendered).toHaveLength(5));
    expect(h.rendered).toEqual([
      'Hero 2',
      'Hero 3',
      'Hero 1',
      'Hero 4',
      'Hero 0',
    ]);
    expect(outwardOrder(5, 2)).toEqual([2, 3, 1, 4, 0]);
    svc.dispose();
  });

  it('REQ-UX-080: yields to the browser between characters', async () => {
    const h = harness();
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(4), 0);
    await vi.waitFor(() => expect(h.rendered).toHaveLength(4));
    expect(h.yields()).toBeGreaterThanOrEqual(4);
    svc.dispose();
  });

  it('REQ-UX-082: persists a validated record with the strip and a 64x64 avatar', async () => {
    const h = harness();
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(1), 0);
    await settle();
    const record = h.puts[0];
    expect(record?.format).toBe('sprite-home-frames');
    expect(record?.frameCount).toBe(IDLE.frameCount);
    expect(record?.fps).toBe(5);
    expect(record?.key).toMatch(/^[0-9a-f]{64}$/);
    const key = svc.keyOf('c0');
    expect(key).toBe(record?.key);
    expect(svc.frames(key ?? '')?.frameCount).toBe(IDLE.frameCount);
    svc.dispose();
  });

  it('AC-UX-080.2: cached frames are not rendered again; a changed hair renders once', async () => {
    const h = harness();
    const first = createHomeFrameService(h.options);
    first.request(lineup(1), 0);
    await settle();
    first.dispose();
    expect(h.renderFramesCalls()).toBe(1);

    const reopened = createHomeFrameService(h.options);
    reopened.request(lineup(1), 0);
    await settle();
    expect(h.renderFramesCalls()).toBe(1);
    expect(reopened.frames(reopened.keyOf('c0') ?? '')).toBeDefined();

    reopened.request(lineup(1, '#ff00ff'), 0);
    await settle();
    expect(h.renderFramesCalls()).toBe(2);
    reopened.dispose();
  });

  it('AC-UX-080.1: at most 7 characters have decoded frames, off-window ones keep only blobs', async () => {
    const h = harness();
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(30), 15);
    await settle(200);
    expect(h.rendered).toHaveLength(30);
    let decoded = 0;
    for (let i = 0; i < 30; i++) {
      const frames = svc.frames(svc.keyOf(`c${i}`) ?? '');
      expect(frames?.stripBlob).toBeDefined();
      if (frames?.strip) decoded++;
    }
    expect(decoded).toBeLessThanOrEqual(MAX_ANIMATED);
    expect(decoded).toBe(7);
    // Moving the selection moves the window.
    svc.request(lineup(30), 2);
    await settle(50);
    expect(svc.frames(svc.keyOf('c15') ?? '')?.strip).toBeNull();
    expect(svc.frames(svc.keyOf('c2') ?? '')?.strip).not.toBeNull();
    svc.dispose();
    expect(h.decoded.open).toBe(0);
  });

  it('REQ-UX-080: pauses while the page is hidden and resumes when shown', async () => {
    const h = harness();
    h.hidden.value = true;
    const svc = createHomeFrameService(h.options);
    const listener = vi.fn();
    svc.subscribe(listener);
    expect(svc.isPaused()).toBe(true);
    svc.request(lineup(2), 0);
    await settle(30);
    expect(h.rendered).toHaveLength(0);
    h.hidden.value = false;
    h.hidden.fire();
    expect(svc.isPaused()).toBe(false);
    expect(listener).toHaveBeenCalled();
    await settle(50);
    expect(h.rendered).toHaveLength(2);
    svc.dispose();
  });

  it('REQ-UX-083: no engine lease until the first paint, and none when every frame is cached', async () => {
    let paint!: () => void;
    const gate = new Promise<void>(r => {
      paint = r;
    });
    const h = harness({afterFirstPaint: () => gate});
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(1), 0);
    await settle(30);
    expect(h.leases()).toBe(0);
    paint();
    await settle(30);
    expect(h.leases()).toBe(1);
    svc.dispose();

    const cached = harness({}, h.puts);
    const again = createHomeFrameService(cached.options);
    again.request(lineup(1), 0);
    await settle(30);
    expect(cached.leases()).toBe(0);
    again.dispose();
  });

  it('REQ-UX-081: a character that cannot render reports an error and the others continue', async () => {
    const onError = vi.fn();
    const h = harness({onError});
    const svc = createHomeFrameService(h.options);
    const list = lineup(3);
    const renderer = (await h.options.host.lease({} as never, {} as never)) as {
      ok: true;
      value: RendererLease;
    };
    (
      renderer.value.renderer.setCharacter as ReturnType<typeof vi.fn>
    ).mockImplementation(async (spec: CharacterSpec) => {
      h.rendered.push(spec.name);
      return spec.name === 'Hero 1'
        ? {ok: false, error: {code: 'CMP_PART_LOAD_FAILED', message: 'x'}}
        : {ok: true, value: undefined};
    });
    svc.request(list, 0);
    await settle(50);
    expect(onError).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({code: 'CMP_PART_LOAD_FAILED'}),
    );
    expect(svc.frames(svc.keyOf('c2') ?? '')).toBeDefined();
    expect(svc.frames(svc.keyOf('c1') ?? '')).toBeUndefined();
    svc.dispose();
  });

  it('REQ-UX-080: releases the renderer lease when the queue drains and when another view preempts', async () => {
    const h = harness();
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(2), 0);
    await settle(40);
    expect(h.leases()).toBe(1);
    expect(h.releases()).toBe(1);
    svc.dispose();
  });

  it('REQ-UX-080: a preempting view stops generation after the current character and gets the renderer', async () => {
    const gates: Array<() => void> = [];
    const h = harness({
      yieldToMain: () => new Promise<void>(r => gates.push(r)),
    });
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(5), 0);
    await settle(30);
    gates.shift()?.(); // the yield before the first render
    await settle(30);
    expect(h.rendered).toHaveLength(1);
    h.onPreempt();
    while (gates.length > 0) gates.shift()?.();
    await settle(30);
    expect(h.rendered).toHaveLength(1);
    expect(h.releases()).toBe(1);
    // A later request leases again and finishes the lineup.
    svc.dispose();
  });

  it('REQ-UX-080: a preempt in a hidden tab releases the renderer without waiting to become visible', async () => {
    const gates: Array<() => void> = [];
    const h = harness({
      yieldToMain: () => new Promise<void>(r => gates.push(r)),
    });
    const svc = createHomeFrameService(h.options);
    svc.request(lineup(5), 0);
    await settle(30);
    gates.shift()?.();
    await settle(30);
    expect(h.rendered).toHaveLength(1);
    h.hidden.value = true;
    h.hidden.fire();
    while (gates.length > 0) gates.shift()?.();
    await settle(30);
    expect(h.releases()).toBe(0); // parked at whenVisible, still holding the lease
    h.onPreempt();
    await settle(30);
    expect(h.releases()).toBe(1);
    expect(h.rendered).toHaveLength(1);
    svc.dispose();
  });
});
