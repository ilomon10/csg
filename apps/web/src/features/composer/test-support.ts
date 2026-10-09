import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  createDefaultCharacterSpec,
  createProjectDocument,
} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import slotRegistry from '../../../../../packages/parts-schema/data/slots.json';
import {loadCatalog, type Catalog} from '../../shared/catalog';
import {
  createDocumentStore,
  createDraftTarget,
  projectCharacterTarget,
  type DraftTarget,
} from '../../shared/document';

const PACKS = resolve(import.meta.dirname, '../../../../../assets/packs');
const PACK_IDS = ['quaternius-ubc', 'quaternius-outfits', 'quaternius-ual'];

/** Loads the committed packs with their presets (test-only; reads the repo files). */
export async function loadTestCatalog(
  overrides: Record<string, string> = {},
  supportedCombos?: Parameters<typeof loadCatalog>[2]['supportedCombos'],
): Promise<Catalog> {
  const result = await loadCatalog(
    async url => {
      const hit = overrides[url];
      if (hit !== undefined) return hit;
      return readFile(resolve(PACKS, url.replace(/^\/packs\//, '')), 'utf8');
    },
    PACK_IDS,
    {slotRegistry, ...(supportedCombos ? {supportedCombos} : {})},
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** A draft target over the default character, with the catalog's command port. */
export function draftFor(
  catalog: Catalog,
  overrides: Partial<CharacterSpec> = {},
): DraftTarget {
  return createDraftTarget(
    {...createDefaultCharacterSpec(), ...overrides},
    () => catalog,
  );
}

/** A project-bound target over a fresh store, with an injectable clock for coalescing (REQ-UX-023). */
export function projectFor(
  catalog: Catalog,
  options: {now?: () => number; spec?: CharacterSpec} = {},
) {
  const store = createDocumentStore(options.now ? {now: options.now} : {});
  store.open(
    'test',
    createProjectDocument(options.spec ?? createDefaultCharacterSpec()),
  );
  return {store, target: projectCharacterTarget(store, () => catalog)};
}

/**
 * Overrides that make the packs provide `presets/styles/<style>.json` (AC-CMP-045.3): the real
 * preset index plus one extra style file.
 */
export async function extraStyleOverrides(
  style: string,
): Promise<Record<string, string>> {
  const base = '/packs/quaternius-ubc/presets';
  const index = JSON.parse(
    await readFile(resolve(PACKS, 'quaternius-ubc/presets/index.json'), 'utf8'),
  ) as {files: Array<{kind: string; path: string}>};
  index.files.push({kind: 'style', path: `presets/styles/${style}.json`});
  return {
    [`${base}/index.json`]: JSON.stringify(index),
    [`${base}/styles/${style}.json`]: JSON.stringify({
      format: 'sprite-style',
      version: 1,
      style,
      excludedClips: [],
    }),
  };
}
