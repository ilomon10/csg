import {describe, expect, it} from 'vitest';
import {CHARACTER_FORMAT_VERSION, hexColorSchema} from './index';

describe('parts-schema', () => {
  it('GEN smoke: accepts a valid hex color and rejects garbage', () => {
    expect(hexColorSchema.safeParse('#a0c4ff').success).toBe(true);
    expect(hexColorSchema.safeParse('blue').success).toBe(false);
    expect(CHARACTER_FORMAT_VERSION).toBe(2);
  });
});

describe('zod config', () => {
  it('AC-GEN-010.2: importing the package turns Zod JIT off before module-load parses', async () => {
    const {z} = await import('zod');
    expect(z.config().jitless).toBe(true);
  });
});
