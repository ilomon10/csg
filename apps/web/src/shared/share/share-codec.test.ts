import {describe, expect, it} from 'vitest';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import {deflateRawSync} from 'node:zlib';
import {decodeShareFragment, encodeShareFragment} from './share-codec';

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

describe('share codec', () => {
  it('AC-CMP-025.1: encode then decode gives a deep-equal spec', async () => {
    const spec = createDefaultCharacterSpec();
    const fragment = await encodeShareFragment(spec);
    expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = await decodeShareFragment(fragment);
    expect(decoded.ok && decoded.value).toEqual(spec);
  });

  it('AC-CMP-025.2: a typical character fits in 2,000 characters', async () => {
    expect(
      (await encodeShareFragment(createDefaultCharacterSpec())).length,
    ).toBeLessThanOrEqual(2000);
  });

  it('AC-CMP-034.1: 70,000 characters are rejected naming the limit, before decoding', async () => {
    const res = await decodeShareFragment('A'.repeat(70_000));
    expect(!res.ok && res.error.code).toBe('CMP_SPEC_INVALID');
    expect(!res.ok && res.error.message).toContain('65,536');
  });

  it('AC-CMP-034.2: a decompression bomb aborts past 1 MB', async () => {
    const bomb = deflateRawSync(Buffer.alloc(40 * 1024 * 1024, 0x20));
    expect(b64url(bomb).length).toBeLessThan(65_536);
    const before = process.memoryUsage().heapUsed;
    const res = await decodeShareFragment(b64url(bomb));
    expect(!res.ok && res.error.code).toBe('CMP_SPEC_INVALID');
    expect(!res.ok && res.error.message).toContain('1,048,576');
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(
      50 * 1024 * 1024,
    );
  });

  it('AC-CMP-034.3: an older version migrates; an unknown format names the path', async () => {
    const v2 = createDefaultCharacterSpec() as unknown as Record<
      string,
      unknown
    >;
    const {style: _s, species: _sp, ...rest} = v2;
    const v1 = {...rest, version: 1};
    const old = await decodeShareFragment(
      b64url(deflateRawSync(JSON.stringify(v1))),
    );
    expect(old.ok && old.value.version).toBe(2);
    expect(old.ok && old.value.style).toBe('realistic');
    const bad = await decodeShareFragment(
      b64url(deflateRawSync(JSON.stringify({...v2, format: 'other'}))),
    );
    expect(!bad.ok && bad.error.code).toBe('CMP_SPEC_INVALID');
    expect(!bad.ok && bad.error.path).toBe('format');
  });

  it('AC-CMP-034.4: valid base64url that is not deflate data fails cleanly', async () => {
    const res = await decodeShareFragment(
      b64url(new TextEncoder().encode('not deflate data at all')),
    );
    expect(!res.ok && res.error.code).toBe('CMP_SPEC_INVALID');
  });

  it('AC-GEN-011.1: a fragment with a nested __proto__ key is rejected', async () => {
    const spec = JSON.stringify(createDefaultCharacterSpec()).replace(
      '"morphs"',
      '"x":{"y":{"z":{"__proto__":{"polluted":1}}}},"morphs"',
    );
    const res = await decodeShareFragment(b64url(deflateRawSync(spec)));
    expect(res.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
