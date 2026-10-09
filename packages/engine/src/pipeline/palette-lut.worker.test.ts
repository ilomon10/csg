import {PALETTE_PRESETS} from '@csg/parts-schema';
import {describe, expect, it, vi} from 'vitest';
import {
  PALETTE_LUT_BYTES,
  buildPaletteLut,
  createPaletteLutWorker,
} from './palette-lut';
import {handlePaletteLutRequest} from './palette-lut.worker';

/** Byte-for-byte equality of two arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const PICO8 = PALETTE_PRESETS['pico-8'].colors;

/** In-process stand-in for the module worker: runs the real handler on a microtask. */
class FakeWorker extends EventTarget {
  terminated = false;
  posted = 0;
  postMessage(data: unknown): void {
    this.posted++;
    queueMicrotask(() => {
      if (this.terminated) return;
      const {response} = handlePaletteLutRequest(structuredClone(data));
      this.dispatchEvent(new MessageEvent('message', {data: response}));
    });
  }
  terminate(): void {
    this.terminated = true;
  }
}

function startFake() {
  const fake = new FakeWorker();
  const worker = createPaletteLutWorker({
    createWorker: () => fake as unknown as Worker,
  });
  return {fake, worker};
}

describe('REQ-PIX-021: palette LUT worker', () => {
  it('AC-PIX-021.5: the worker handler returns the Node builder bytes and transfers the buffer', () => {
    const {response, transfer} = handlePaletteLutRequest({
      type: 'build',
      id: 7,
      colors: [...PICO8],
      metric: 'oklab',
    });
    expect(response.type).toBe('built');
    if (response.type !== 'built') return;
    expect(response.id).toBe(7);
    expect(transfer).toEqual([response.lut.buffer]);
    expect(bytesEqual(response.lut, buildPaletteLut(PICO8, 'oklab'))).toBe(
      true,
    );
    // GPU test: M2-08 harness — build in a real browser module worker (both Chromium backends'
    // pages) and compare with PICO8_OKLAB_LUT_SHA256 from palette-lut.test.ts.
  });

  it('AC-PIX-021.2: the worker handler rejects malformed requests without throwing', () => {
    const bad: unknown[] = [
      null,
      42,
      {type: 'nope', id: 1, colors: ['#000000'], metric: 'oklab'},
      {type: 'build', id: 1.5, colors: ['#000000'], metric: 'oklab'},
      {type: 'build', id: 1, colors: [], metric: 'oklab'},
      {type: 'build', id: 1, colors: ['red'], metric: 'oklab'},
      {type: 'build', id: 1, colors: ['#000000'], metric: 'lab'},
      {
        type: 'build',
        id: 1,
        colors: Array(257).fill('#000000'),
        metric: 'srgb',
      },
    ];
    for (const data of bad) {
      const {response, transfer} = handlePaletteLutRequest(data);
      expect(response.type).toBe('error');
      expect(transfer).toEqual([]);
    }
  });

  it('AC-PIX-021.2: createPaletteLutWorker resolves builds in order with the Node bytes', async () => {
    const {fake, worker} = startFake();
    const [a, b] = await Promise.all([
      worker.build(PICO8, 'oklab'),
      worker.build(['#ffffff', '#102030'], 'srgb'),
    ]);
    expect(bytesEqual(a, buildPaletteLut(PICO8, 'oklab'))).toBe(true);
    expect(bytesEqual(b, buildPaletteLut(['#ffffff', '#102030'], 'srgb'))).toBe(
      true,
    );
    expect(fake.posted).toBe(2);
    worker.dispose();
  });

  it('AC-PIX-021.2: a rejected request rejects its promise; dispose rejects pending builds', async () => {
    const {fake, worker} = startFake();
    await expect(worker.build(['bad'], 'oklab')).rejects.toThrow(/colors/);
    const pending = worker.build(PICO8, 'oklab');
    worker.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(fake.terminated).toBe(true);
    await expect(worker.build(PICO8, 'oklab')).rejects.toThrow(/disposed/);
    worker.dispose(); // idempotent
  });

  it('AC-PIX-021.2: a worker error event rejects pending builds', async () => {
    const fake = new FakeWorker();
    fake.postMessage = () => {
      queueMicrotask(() => fake.dispatchEvent(new Event('error')));
    };
    const worker = createPaletteLutWorker({
      createWorker: () => fake as unknown as Worker,
    });
    await expect(worker.build(PICO8, 'oklab')).rejects.toThrow(/failed/);
    worker.dispose();
  });

  it('AC-PIX-021.2: the handler rejects sparse color arrays and survives build errors', () => {
    const sparse = new Array<string>(3);
    sparse[0] = '#000000';
    sparse[2] = '#ffffff';
    const {response} = handlePaletteLutRequest({
      type: 'build',
      id: 4,
      colors: sparse,
      metric: 'oklab',
    });
    expect(response).toMatchObject({type: 'error', id: 4});
    const hostile = {
      type: 'build',
      id: 5,
      metric: 'oklab',
      get colors(): unknown {
        throw new Error('getter boom');
      },
    };
    expect(handlePaletteLutRequest(hostile).response.type).toBe('error');
  });

  it('AC-GEN-016.1: invalid replies are ignored and the request stays pending until a valid reply or timeout', async () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const fake = new FakeWorker();
      let sent = 0;
      fake.postMessage = (data: unknown) => {
        sent = (data as {id: number}).id;
      };
      const worker = createPaletteLutWorker({
        createWorker: () => fake as unknown as Worker,
        timeoutMs: 1000,
      });
      let settled = false;
      const p = worker.build(PICO8, 'oklab').then(
        lut => {
          settled = true;
          return lut;
        },
        (e: unknown) => {
          settled = true;
          throw e;
        },
      );
      const send = (data: unknown) =>
        fake.dispatchEvent(new MessageEvent('message', {data}));
      send({type: 'nope', id: sent});
      send({
        type: 'built',
        id: sent + 99,
        lut: new Uint8Array(PALETTE_LUT_BYTES),
      });
      send({
        type: 'built',
        id: sent,
        lut: new Uint8Array(PALETTE_LUT_BYTES - 1),
      });
      send({
        type: 'built',
        id: sent,
        lut: new Uint16Array(PALETTE_LUT_BYTES / 2),
      });
      send({type: 'built', id: String(sent), lut: null});
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(debug).toHaveBeenCalledTimes(5);
      const good = buildPaletteLut(PICO8, 'oklab');
      send({type: 'built', id: sent, lut: good});
      expect(bytesEqual(await p, good)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      worker.dispose();
    } finally {
      debug.mockRestore();
      vi.useRealTimers();
    }
  });

  it('AC-GEN-016.3: error or messageerror fails all pending requests with no unhandled rejection', async () => {
    for (const kind of ['error', 'messageerror']) {
      const fake = new FakeWorker();
      fake.postMessage = () => {};
      const worker = createPaletteLutWorker({
        createWorker: () => fake as unknown as Worker,
      });
      const a = worker.build(PICO8, 'oklab');
      const b = worker.build(PICO8, 'srgb');
      fake.dispatchEvent(new Event(kind));
      await expect(Promise.allSettled([a, b])).resolves.toEqual([
        expect.objectContaining({status: 'rejected'}),
        expect.objectContaining({status: 'rejected'}),
      ]);
      worker.dispose();
    }
  });

  it('AC-GEN-016.2: a request with no response times out (default 5000 ms)', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeWorker();
      fake.postMessage = () => {};
      const worker = createPaletteLutWorker({
        createWorker: () => fake as unknown as Worker,
        timeoutMs: undefined,
      });
      const p = worker.build(PICO8, 'oklab');
      const assertion = expect(p).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
      worker.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-GEN-016.3: a messageerror event rejects pending builds and clears their timers', async () => {
    const fake = new FakeWorker();
    fake.postMessage = () => {
      queueMicrotask(() => fake.dispatchEvent(new Event('messageerror')));
    };
    const worker = createPaletteLutWorker({
      createWorker: () => fake as unknown as Worker,
    });
    await expect(worker.build(PICO8, 'oklab')).rejects.toThrow(/deserialized/);
    worker.dispose();
  });

  it('AC-PIX-021.2: a throwing postMessage rejects the request', async () => {
    const fake = new FakeWorker();
    fake.postMessage = () => {
      throw new Error('DataCloneError');
    };
    const worker = createPaletteLutWorker({
      createWorker: () => fake as unknown as Worker,
    });
    await expect(worker.build(PICO8, 'oklab')).rejects.toThrow(/DataClone/);
    worker.dispose();
  });
});
