import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  createDefaultCharacterSpec,
  createProjectDocument,
} from '@csg/parts-schema';
import slotRegistry from '../../../../../packages/parts-schema/data/slots.json';
import {loadCatalog} from '../../shared/catalog';
import type {Catalog} from '../../shared/catalog';
import {createDocumentStore} from '../../shared/document';

const PACKS = resolve(import.meta.dirname, '../../../../../assets/packs');

/** Loads the committed packs (look presets included) for component tests. */
export async function loadTestCatalog(): Promise<Catalog> {
  const result = await loadCatalog(
    async url =>
      readFile(resolve(PACKS, url.replace(/^\/packs\//, '')), 'utf8'),
    ['quaternius-ubc', 'quaternius-outfits', 'quaternius-ual'],
    {slotRegistry},
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** An open default project. */
export function openProject() {
  const store = createDocumentStore();
  store.open('p1', createProjectDocument(createDefaultCharacterSpec()));
  return store;
}
