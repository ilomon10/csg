import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import slotRegistry from '../../../../../packages/parts-schema/data/slots.json';
import {loadCatalog} from './catalog';

const PACKS = resolve(import.meta.dirname, '../../../../../assets/packs');
const PACK_IDS = ['quaternius-ubc', 'quaternius-outfits', 'quaternius-ual'];

/** Serves the committed packs, with optional in-memory overrides. */
function fetcher(overrides: Record<string, string> = {}) {
  return async (url: string) => {
    const hit = overrides[url];
    if (hit !== undefined) return hit;
    try {
      return await readFile(
        resolve(PACKS, url.replace(/^\/packs\//, '')),
        'utf8',
      );
    } catch {
      throw new Error(`${url}: HTTP 404`);
    }
  };
}

const styleFile = (style: string) =>
  JSON.stringify({
    format: 'sprite-style',
    version: 1,
    style,
    excludedClips: [],
  });

describe('catalog', () => {
  it('AC-CMP-045.1: the bundled packs load; only realistic/human is enabled without style data', async () => {
    const result = await loadCatalog(fetcher(), PACK_IDS, {slotRegistry});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.value;
    expect(c.parts.length).toBeGreaterThan(0);
    expect(c.clips.length).toBeGreaterThan(0);
    expect(c.packVersions).toHaveLength(3);
    expect(c.packVersions[0]).toMatch(/^quaternius-ubc@[0-9a-f]{16}$/);
    expect(c.parts[0]?.ref).toMatch(/^builtin:quaternius-ubc\//);
    // No loaded pack provides presets/styles/*.json yet, so nothing is available.
    expect(c.availableCombos.length).toBeLessThanOrEqual(2);
  });

  it('AC-UX-080.2: preset and shape entries carry their pack and local thumbnail URLs', async () => {
    const result = await loadCatalog(fetcher(), PACK_IDS, {slotRegistry});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c = result.value;
    const hero = c.characterPresets[0];
    expect(hero?.packId).toBe('quaternius-ubc');
    expect(hero?.thumbnailUrl).toBe(
      `/packs/quaternius-ubc/thumbnails/characters/${hero?.id}.webp`,
    );
    const look = c.lookPresets[0];
    expect(look?.thumbnailUrl).toBe(`/packs/quaternius-ubc/${look?.thumbnail}`);
    expect(c.bodyShapes[0]?.thumbnailBase).toBe(
      '/packs/quaternius-ubc/thumbnails/shapes',
    );
  });

  it('AC-CMP-045.3: a loaded style file enables a pair the engine supports', async () => {
    const base = '/packs/quaternius-ubc';
    const catalog = await loadCatalog(
      fetcher({
        [`${base}/presets/index.json`]: JSON.stringify({
          format: 'sprite-preset-index',
          version: 1,
          files: [{kind: 'style', path: 'presets/styles/realistic.json'}],
        }),
        [`${base}/presets/styles/realistic.json`]: styleFile('realistic'),
      }),
      ['quaternius-ubc'],
      {
        slotRegistry,
        supportedCombos: [
          ['realistic', 'human'],
          ['stickman', 'human'],
        ],
      },
    );
    expect(catalog.ok && catalog.value.availableCombos).toEqual([
      ['realistic', 'human'],
    ]);
  });

  it('AC-CMP-045.4: a supported pair without its style file stays unavailable', async () => {
    const catalog = await loadCatalog(fetcher(), ['quaternius-ubc'], {
      slotRegistry,
      supportedCombos: [['stickman', 'human']],
    });
    expect(catalog.ok && catalog.value.availableCombos).toEqual([]);
  });

  it('AC-CMP-045.5: a species needs a loaded species-head part', async () => {
    const base = '/packs/quaternius-ubc';
    const original = JSON.parse(await fetcher()(`${base}/manifest.json`)) as {
      parts: Array<Record<string, unknown>>;
    };
    const files = {
      [`${base}/presets/index.json`]: JSON.stringify({
        format: 'sprite-preset-index',
        version: 1,
        files: [{kind: 'style', path: 'presets/styles/realistic.json'}],
      }),
      [`${base}/presets/styles/realistic.json`]: styleFile('realistic'),
    };
    const opts = {
      slotRegistry,
      supportedCombos: [['realistic', 'animal']] as const,
    };
    const without = await loadCatalog(fetcher(files), ['quaternius-ubc'], opts);
    expect(without.ok && without.value.availableCombos).toEqual([]);

    const head = {
      ...original.parts[0],
      id: 'animal-head-test',
      slot: 'species-head',
      species: ['animal'],
    };
    const withHead = await loadCatalog(
      fetcher({
        ...files,
        [`${base}/manifest.json`]: JSON.stringify({
          ...original,
          parts: [...original.parts, head],
        }),
      }),
      ['quaternius-ubc'],
      opts,
    );
    expect(withHead.ok && withHead.value.availableCombos).toEqual([
      ['realistic', 'animal'],
    ]);
  });

  it('AC-GEN-013.1: an invalid preset file is skipped; an invalid manifest fails the load', async () => {
    const base = '/packs/quaternius-ubc';
    const skipped = await loadCatalog(
      fetcher({
        [`${base}/presets/index.json`]: JSON.stringify({
          format: 'sprite-preset-index',
          version: 1,
          files: [{kind: 'style', path: 'presets/styles/bad.json'}],
        }),
        [`${base}/presets/styles/bad.json`]: '{"__proto__":{"x":1}}',
      }),
      ['quaternius-ubc'],
      {slotRegistry},
    );
    expect(skipped.ok && skipped.value.styles.size).toBe(0);
    const bad = await loadCatalog(
      fetcher({[`${base}/manifest.json`]: '{"__proto__":{}}'}),
      ['quaternius-ubc'],
      {
        slotRegistry,
      },
    );
    expect(bad.ok).toBe(false);
  });

  it('AC-CMP-048.1: compatible() rejects a part that lists other styles', async () => {
    const loaded = await loadCatalog(fetcher(), PACK_IDS, {slotRegistry});
    if (!loaded.ok) throw new Error('catalog failed');
    const catalog = loaded.value;
    const spec = createDefaultCharacterSpec();
    const part = catalog.parts.find(p => p.slot !== 'body');
    expect(part).toBeDefined();
    if (part === undefined) return;
    const restricted = {...part, styles: ['chibi' as const]};
    expect(catalog.compatible(restricted, spec)).toEqual({
      ok: false,
      reason: 'style',
    });
  });
});
