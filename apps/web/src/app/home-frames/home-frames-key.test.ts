import {createDefaultCharacterSpec} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import {homeFramesKey} from './home-frames-key';

const PACKS = ['b@0000000000000002', 'a@0000000000000001'];

describe('home frames key', () => {
  it('AC-UX-080.2: is a stable lowercase SHA-256 of the spec, profile and sorted packs', async () => {
    const spec = createDefaultCharacterSpec();
    const key = await homeFramesKey(spec, PACKS);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await homeFramesKey({...spec}, [...PACKS].reverse())).toBe(key);
  });

  it('AC-UX-080.2: changes with the character and with a pack version', async () => {
    const spec = createDefaultCharacterSpec();
    const key = await homeFramesKey(spec, PACKS);
    const hair = {...spec, tints: {...spec.tints, hair: '#123456'}};
    expect(await homeFramesKey(hair, PACKS)).not.toBe(key);
    expect(
      await homeFramesKey(spec, ['a@ffffffffffffffff', PACKS[0]!]),
    ).not.toBe(key);
  });
});
