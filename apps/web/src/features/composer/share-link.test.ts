import {createDefaultCharacterSpec} from '@csg/parts-schema';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {decodeShareFragment} from '../../shared/share';
import {
  buildShareUrl,
  clearShareFragment,
  readShareFragment,
  userPartSlots,
  withoutUserParts,
} from './share-link';

const LOCATION = {origin: 'https://editor.example', pathname: '/'};

afterEach(() => vi.restoreAllMocks());

describe('share link', () => {
  it('AC-CMP-025.1: the link decodes to a spec deep-equal to the original', async () => {
    const spec = createDefaultCharacterSpec();
    const url = await buildShareUrl(spec, LOCATION);
    const payload = readShareFragment(new URL(url).hash);
    expect(payload).not.toBeNull();
    const decoded = await decodeShareFragment(payload ?? '');
    expect(decoded.ok && decoded.value).toEqual(spec);
  });

  it('AC-CMP-025.2: a typical character fits in 2,000 characters', async () => {
    const url = await buildShareUrl(createDefaultCharacterSpec(), LOCATION);
    expect(url.slice(url.indexOf('#')).length).toBeLessThanOrEqual(2000);
  });

  it('AC-CMP-025.3: building a link makes no network request', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network')));
    vi.stubGlobal('fetch', fetchSpy);
    await buildShareUrl(createDefaultCharacterSpec(), LOCATION);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('AC-CMP-026.1: user parts are listed and removed from the shared spec', async () => {
    const base = createDefaultCharacterSpec();
    const spec = {
      ...base,
      parts: {...base.parts, headwear: {ref: 'user:hat-1' as never}},
    };
    expect(userPartSlots(spec)).toEqual([
      {slot: 'headwear', ref: 'user:hat-1'},
    ]);
    const url = await buildShareUrl(withoutUserParts(spec), LOCATION);
    const decoded = await decodeShareFragment(
      readShareFragment(new URL(url).hash) ?? '',
    );
    expect(JSON.stringify(decoded)).not.toContain('user:');
  });

  it('AC-CMP-035.3: only a #c= payload is read from the hash', () => {
    expect(readShareFragment('#c=abc_-')).toBe('abc_-');
    expect(readShareFragment('#other')).toBeNull();
    expect(readShareFragment('')).toBeNull();
  });
});

describe('clearShareFragment (jsdom-free stub)', () => {
  it('AC-CMP-035.3: replaces the URL without the fragment and adds no history entry', () => {
    const calls: unknown[][] = [];
    clearShareFragment({
      history: {
        state: 's',
        replaceState: (...args: unknown[]) => calls.push(args),
      } as unknown as History,
      location: {pathname: '/edit', search: '?a=1', hash: '#c=x'} as Location,
    });
    expect(calls).toEqual([['s', '', '/edit?a=1']]);
  });
});
