import {PALETTE_PRESETS} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {buildPaletteLut, createPaletteLutWorker} from './palette-lut';
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
});
