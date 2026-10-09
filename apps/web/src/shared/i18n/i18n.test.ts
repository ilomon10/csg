import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import slots from '../../../../../packages/parts-schema/data/slots.json';
import {t} from './i18n';
import {MESSAGES} from './messages';

const PRESETS = resolve(
  import.meta.dirname,
  '../../../../../assets/packs/quaternius-ubc/presets',
);

const readJson = (dir: string) =>
  readdirSync(resolve(PRESETS, dir))
    .sort()
    .map(
      file =>
        JSON.parse(readFileSync(resolve(PRESETS, dir, file), 'utf8')) as Record<
          string,
          unknown
        >,
    );

describe('i18n', () => {
  it('AC-UX-027.1: save states resolve to their texts', () => {
    expect(t('save.failed')).toBe('Save failed — Retry');
    expect(t('save.unsaved')).toBe('Unsaved changes');
  });

  it('AC-UX-062.1: every swatch of the shipped swatch sets has a spoken name', () => {
    const keys = readJson('swatches').flatMap(set =>
      (set['swatches'] as Array<{nameKey: string}>).map(s => s.nameKey),
    );
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys)
      expect(Object.hasOwn(MESSAGES, key), key).toBe(true);
    expect(MESSAGES['ux.swatch.hair.auburn']).toBe('Auburn');
  });

  it('AC-UX-063.1: the six body shapes have names', () => {
    const labels = readJson('body-shapes').map(s => s['label'] as string);
    expect(labels.sort()).toEqual(
      ['average', 'slim', 'athletic', 'stocky', 'tall', 'petite']
        .map(id => `ux.shape.${id}`)
        .sort(),
    );
    for (const key of labels)
      expect(Object.hasOwn(MESSAGES, key), key).toBe(true);
  });

  it('AC-UX-060.1: the seven Easy categories have tab labels', () => {
    const keys = readJson('categories').map(c => c['labelKey'] as string);
    expect(keys).toHaveLength(7);
    for (const key of keys)
      expect(Object.hasOwn(MESSAGES, key), key).toBe(true);
  });

  it('AC-UX-061.1: every slot of the registry has a label', () => {
    for (const slot of slots.slots) {
      expect(Object.hasOwn(MESSAGES, slot.label), slot.label).toBe(true);
    }
  });

  it('AC-UX-033.1: every literal key passed to t() exists in the message table', () => {
    const SRC = resolve(import.meta.dirname, '../..');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [p] : [];
      });
    const missing: string[] = [];
    let used = 0;
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?<![.\w])t\(\s*'([^']+)'/g)) {
        used += 1;
        const key = m[1] ?? '';
        if (!Object.hasOwn(MESSAGES, key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(used).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });
});
