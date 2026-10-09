import {describe, expect, it} from 'vitest';
import {createWorkerUrlValidator} from './worker-url-policy';

const ORIGIN = 'https://editor.example';
const BASE = `${ORIGIN}/app/`;
const WORKER = `${ORIGIN}/app/assets/palette-lut.worker-AbC123.js`;
const validate = createWorkerUrlValidator({
  origin: ORIGIN,
  baseURI: BASE,
  allowlist: ['/app/assets/palette-lut.worker-AbC123.js'],
});

describe('csg-worker-url validation (REQ-GEN-014)', () => {
  it('AC-GEN-014.5: returns the allowlisted URL, absolute or relative to the base', () => {
    expect(validate(WORKER)).toBe(WORKER);
    expect(validate('/app/assets/palette-lut.worker-AbC123.js')).toBe(WORKER);
    expect(validate('assets/palette-lut.worker-AbC123.js')).toBe(WORKER);
  });

  it.each([
    ['same origin, not allowlisted', `${ORIGIN}/app/assets/other.js`],
    [
      'another project on the shared origin',
      `${ORIGIN}/other/assets/palette-lut.worker-AbC123.js`,
    ],
    ['blob:', `blob:${ORIGIN}/0b1c2d3e-0000-4000-8000-000000000000`],
    ['data:', 'data:text/javascript,postMessage(1)'],
    ['protocol-relative', '//evil.example/w.js'],
    ['userinfo host trick', 'https://editor.example@evil.example/w.js'],
    [
      'credentials on the right host',
      'https://u:p@editor.example/app/assets/palette-lut.worker-AbC123.js',
    ],
    ['fragment', `${WORKER}#x`],
    [
      'percent-encoded dot segments',
      `${ORIGIN}/app/assets/%2e%2e/assets/palette-lut.worker-AbC123.js`,
    ],
    [
      'upper-case encoded dots',
      `${ORIGIN}/app/x/%2E%2E/assets/palette-lut.worker-AbC123.js`,
    ],
    ['dot segment', `${ORIGIN}/app/x/../assets/palette-lut.worker-AbC123.js`],
    ['backslash', `${ORIGIN}\\app\\assets\\palette-lut.worker-AbC123.js`],
    ['http on an https origin', WORKER.replace('https:', 'http:')],
    ['query string appended', `${WORKER}?x=1`],
    ['empty', ''],
  ])('AC-GEN-014.2/.5: rejects %s with a TypeError', (_name, input) => {
    expect(() => validate(input)).toThrow(TypeError);
  });
});
