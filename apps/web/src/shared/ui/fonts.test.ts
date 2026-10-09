import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const FONTS_DIR = resolve(import.meta.dirname, 'fonts');
const PACKAGES_DIR = resolve(
  import.meta.dirname,
  '../../../node_modules/@fontsource',
);
const sha256 = (file: string) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

describe('vendored fonts (ASSETS_LICENSE.md provenance)', () => {
  const files = readdirSync(FONTS_DIR).filter(name => name.endsWith('.woff2'));

  it('the three families are vendored', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const name of files) {
    it(`vendored ${name} matches the pinned @fontsource package byte for byte`, () => {
      const family = /^(.+)-latin-\d+-normal\.woff2$/.exec(name)?.[1];
      expect(family).toBeDefined();
      const source = resolve(PACKAGES_DIR, family ?? '', 'files', name);
      expect(existsSync(source)).toBe(true);
      expect(sha256(resolve(FONTS_DIR, name))).toBe(sha256(source));
    });
  }
});
