import {describe, expect, it} from 'vitest';
import {crc32, encodePng} from './png';
import {hex, parsePng, readZip} from './test-helpers';
import {writeZip} from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('encodePng (spec 005 REQ-EXP-018)', () => {
  it('AC-EXP-018.3: crc32 matches the standard check value', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });

  it('AC-EXP-018.2: only IHDR, IDAT and IEND, RGBA color type 6', () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4).fill(7), 4, 4);
    const parsed = parsePng(png);
    expect(parsed.chunks).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(parsed.colorType).toBe(6);
  });

  it('AC-EXP-002.1: pixels round-trip exactly', () => {
    const rgba = Uint8ClampedArray.from({length: 3 * 2 * 4}, (_, i) => i * 9);
    const parsed = parsePng(encodePng(rgba, 3, 2));
    expect([...parsed.rgba]).toEqual([...rgba]);
  });

  it('AC-EXP-018.3: golden bytes of a 2x1 image', () => {
    const png = encodePng(Uint8Array.from([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1);
    expect(hex(png)).toBe(GOLDEN_PNG_2X1);
  });

  it('AC-EXP-018.1: the same input gives identical bytes twice', () => {
    const rgba = Uint8Array.from(
      {length: 64 * 64 * 4},
      (_, i) => (i * 13) & 255,
    );
    expect(encodePng(rgba, 64, 64)).toEqual(encodePng(rgba, 64, 64));
  });

  it('rejects a wrong buffer length', () => {
    expect(() => encodePng(new Uint8Array(3), 1, 1)).toThrow();
  });
});

describe('writeZip (spec 005 REQ-EXP-018)', () => {
  const files = [
    {name: 'b/two.txt', bytes: bytes('two two two two')},
    {name: 'CREDITS.txt', bytes: bytes('credits')},
    {name: 'a.png', bytes: Uint8Array.from([1, 2, 3])},
  ];

  it('AC-EXP-018.1: sorted entries, DOS time 1980-01-01, no extra fields', () => {
    const zip = writeZip(files);
    const view = new DataView(zip.buffer);
    // First local header: signature, DOS time 0, DOS date 0x0021, extra length 0.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(10, true)).toBe(0);
    expect(view.getUint16(12, true)).toBe(0x0021);
    expect(view.getUint16(28, true)).toBe(0);
    expect(Object.keys(readZip(zip))).toEqual([
      'CREDITS.txt',
      'a.png',
      'b/two.txt',
    ]);
  });

  it('AC-EXP-018.1: input order does not change the bytes', () => {
    expect(writeZip(files)).toEqual(writeZip([...files].reverse()));
  });

  it('round-trips contents', () => {
    const out = readZip(writeZip(files));
    expect(new TextDecoder().decode(out['b/two.txt'])).toBe('two two two two');
    expect([...(out['a.png'] ?? [])]).toEqual([1, 2, 3]);
  });

  it('rejects unsafe or duplicate names', () => {
    for (const name of ['../x', '/x', 'a\\b', 'a//b', '']) {
      expect(() => writeZip([{name, bytes: bytes('x')}])).toThrow();
    }
    expect(() =>
      writeZip([
        {name: 'x', bytes: bytes('1')},
        {name: 'x', bytes: bytes('2')},
      ]),
    ).toThrow();
  });
});

const GOLDEN_PNG_2X1 =
  '89504e470d0a1a0a0000000d4948445200000002000000010806000000f4227f8a0000000e49444154789c63f8cf00420c0c000cfc01ff247a7d260000000049454e44ae426082';
