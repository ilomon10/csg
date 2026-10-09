import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import slotRegistry from '../../../../../../packages/parts-schema/data/slots.json';
import {loadCatalog} from '../../../shared/catalog';
import type {Catalog} from '../../../shared/catalog';

const PACKS = resolve(import.meta.dirname, '../../../../../../assets/packs');

/** Loads the committed packs (test-only). `supportedCombos` narrows the gating input. */
export async function loadWizardCatalog(
  supportedCombos?: Parameters<typeof loadCatalog>[2]['supportedCombos'],
  overrides: Record<string, string> = {},
): Promise<Catalog> {
  const result = await loadCatalog(
    async url =>
      overrides[url] ??
      readFile(resolve(PACKS, url.replace(/^\/packs\//, '')), 'utf8'),
    ['quaternius-ubc', 'quaternius-outfits', 'quaternius-ual'],
    {slotRegistry, ...(supportedCombos ? {supportedCombos} : {})},
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
