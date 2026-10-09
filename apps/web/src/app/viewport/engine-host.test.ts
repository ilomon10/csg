import type {EngineAssetRegistry, EngineCharacterRenderer} from '@csg/engine';
import {describe, expect, it, vi} from 'vitest';
import {createEngineHost} from './engine-host';
import type {PreviewEngine} from './engine-host';

function fakeEngine() {
  const created: Array<{dispose: ReturnType<typeof vi.fn>}> = [];
  const clear = vi.fn();
  const registry = {loader: {clear}} as unknown as EngineAssetRegistry;
  const loadBundledPacks = vi.fn(async () => undefined);
  const engine = {
    createAssetRegistry: vi.fn(() => registry),
    loadBundledPacks,
    createPreviewPaletteLutWorker: vi.fn(),
    createCharacterRenderer: vi.fn(async () => {
      const dispose = vi.fn();
      created.push({dispose});
      return {
        ok: true as const,
        value: {dispose} as unknown as EngineCharacterRenderer,
      };
    }),
  } as unknown as PreviewEngine;
  return {engine, created, clear, loadBundledPacks};
}

const options = {settings: {} as never, onError: () => undefined};
const canvas = {} as HTMLCanvasElement;

describe('engine host', () => {
  it('REQ-UX-057: loads the engine and the packs once for any number of leases', async () => {
    const {engine, loadBundledPacks} = fakeEngine();
    const load = vi.fn(async () => engine);
    const host = createEngineHost(load);
    const a = await host.lease(canvas, options);
    if (!a.ok) throw new Error('lease failed');
    a.value.release();
    const b = await host.lease(canvas, options);
    if (!b.ok) throw new Error('lease failed');
    expect(load).toHaveBeenCalledTimes(1);
    expect(loadBundledPacks).toHaveBeenCalledTimes(1);
  });

  it('REQ-UX-057: holds one live renderer at a time; the next lease waits for the release', async () => {
    const {engine, created, clear} = fakeEngine();
    const host = createEngineHost(async () => engine);
    const first = await host.lease(canvas, options);
    if (!first.ok) throw new Error('lease failed');
    let secondGranted = false;
    const second = host.lease(canvas, options).then(r => {
      secondGranted = true;
      return r;
    });
    await new Promise(r => setTimeout(r, 10));
    expect(secondGranted).toBe(false);
    expect(created).toHaveLength(1);
    first.value.release();
    first.value.release(); // idempotent
    const granted = await second;
    expect(granted.ok).toBe(true);
    expect(created).toHaveLength(2);
    expect(created[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('REQ-UX-080: a waiting lease asks the holder to release through onPreempt', async () => {
    const {engine} = fakeEngine();
    const host = createEngineHost(async () => engine);
    const onPreempt = vi.fn();
    const home = await host.lease(canvas, {...options, onPreempt});
    if (!home.ok) throw new Error('lease failed');
    const next = host.lease(canvas, options);
    expect(onPreempt).toHaveBeenCalledTimes(1);
    home.value.release();
    expect((await next).ok).toBe(true);
  });

  it('REQ-UX-083: a failed engine import is a result and is retried on the next lease', async () => {
    const {engine} = fakeEngine();
    let attempts = 0;
    const host = createEngineHost(async () => {
      attempts++;
      if (attempts === 1) throw new Error('chunk offline');
      return engine;
    });
    const failed = await host.lease(canvas, options);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toContain('chunk offline');
    expect((await host.lease(canvas, options)).ok).toBe(true);
  });

  it('REQ-UX-057: a throwing dispose still frees the slot for the next lease', async () => {
    const {engine, created} = fakeEngine();
    const host = createEngineHost(async () => engine);
    const first = await host.lease(canvas, options);
    if (!first.ok) throw new Error('lease failed');
    created[0]?.dispose.mockImplementation(() => {
      throw new Error('dispose failed');
    });
    expect(() => first.value.release()).toThrow('dispose failed');
    const next = await host.lease(canvas, options);
    expect(next.ok).toBe(true);
  });

  it('REQ-UX-080: a queued lease learns about a later request through onPreempt', async () => {
    const {engine} = fakeEngine();
    const host = createEngineHost(async () => engine);
    const a = await host.lease(canvas, options);
    if (!a.ok) throw new Error('lease failed');
    const onPreemptB = vi.fn();
    const b = host.lease(canvas, {...options, onPreempt: onPreemptB});
    const c = host.lease(canvas, options);
    a.value.release();
    const granted = await b;
    if (!granted.ok) throw new Error('lease failed');
    expect(onPreemptB).toHaveBeenCalledTimes(1);
    granted.value.release();
    expect((await c).ok).toBe(true);
  });

  it('REQ-UX-057: borrow lends only a shareable lease and its release is a no-op', async () => {
    const {engine, created} = fakeEngine();
    const host = createEngineHost(async () => engine);
    expect(host.borrow()).toBeNull();
    const plain = await host.lease(canvas, options);
    if (!plain.ok) throw new Error('lease failed');
    expect(host.borrow()).toBeNull();
    plain.value.release();
    const view = await host.lease(canvas, {...options, shareable: true});
    if (!view.ok) throw new Error('lease failed');
    const borrowed = host.borrow();
    expect(borrowed?.renderer).toBe(view.value.renderer);
    borrowed?.release();
    expect(created[1]?.dispose).not.toHaveBeenCalled();
    view.value.release();
    expect(host.borrow()).toBeNull();
  });

  it('REQ-UX-057: borrowWhenReady waits for a pending shareable lease and then borrows it', async () => {
    const {engine} = fakeEngine();
    const host = createEngineHost(async () => engine);
    expect((await host.borrowWhenReady()).ok).toBe(true);
    expect((await host.borrowWhenReady()).ok && null).toBeNull();
    const pending = host.lease(canvas, {...options, shareable: true});
    const early = host.borrowWhenReady(5000);
    const view = await pending;
    if (!view.ok) throw new Error('lease failed');
    const got = await early;
    if (!got.ok) throw new Error('borrow failed');
    expect(got.value?.renderer).toBe(view.value.renderer);
  });

  it('REQ-UX-057: borrowWhenReady returns an error, not a hang, when the lease never settles', async () => {
    const host = createEngineHost(() => new Promise<never>(() => undefined));
    void host.lease(canvas, {...options, shareable: true});
    const res = await host.borrowWhenReady(50);
    expect(res.ok).toBe(false);
  });
});
