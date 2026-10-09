import 'fake-indexeddb/auto';
import {
  createDefaultCharacterSpec,
  createProjectDocument,
} from '@csg/parts-schema';
import type {ProjectDocument} from '@csg/parts-schema';
import {IDBFactory} from 'fake-indexeddb';
import {openCsgDatabase} from './database';
import type {CsgDatabase} from './database';

/** A valid project document for tests. */
export function sampleDoc(name = 'Test hero'): ProjectDocument {
  const character = {...createDefaultCharacterSpec(), name};
  return createProjectDocument(character);
}

/** A fresh in-memory IndexedDB with the `csg` schema. */
export async function freshDatabase(): Promise<CsgDatabase> {
  const opened = await openCsgDatabase(new IDBFactory());
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}
