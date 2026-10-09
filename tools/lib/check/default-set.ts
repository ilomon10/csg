/**
 * The default character and its default clips (spec 001 REQ-CMP-036, spec 011 AC-AST-016.2).
 * Used to size the first-load transfer.
 */
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {DEFAULT_CHARACTER_DATA} from '@csg/parts-schema';
import type {LicensePack} from './licenses-md.js';

/** A bundled part or clip the default set needs. */
export interface DefaultSetRef {
  packId: string;
  kind: 'part' | 'clip';
  id: string;
}

/** Splits `builtin:<packId>/<id>` into its pack and entry IDs. */
function splitRef(ref: string): {packId: string; id: string} {
  const [packId = '', id = ''] = ref.slice('builtin:'.length).split('/');
  return {packId, id};
}

/** Default `CharacterSpec` parts and default clips, read from the shared default character data. */
export const DEFAULT_SET: readonly DefaultSetRef[] = [
  ...[
    DEFAULT_CHARACTER_DATA.character.body.ref,
    ...Object.values(DEFAULT_CHARACTER_DATA.character.parts).map(p => p.ref),
  ].map((ref): DefaultSetRef => ({...splitRef(ref), kind: 'part'})),
  ...DEFAULT_CHARACTER_DATA.clips.map((ref): DefaultSetRef => ({
    ...splitRef(ref),
    kind: 'clip',
  })),
];

/**
 * Sizes (bytes) of the default set's GLBs found in the built packs, keyed `packId/kind/id`.
 * Returns null when none of the default packs is built (nothing to measure, e.g. test packs).
 */
export async function measureDefaultSet(
  packsDir: string,
  packs: readonly LicensePack[],
): Promise<Map<string, number> | null> {
  const sizes = new Map<string, number>();
  let any = false;
  for (const ref of DEFAULT_SET) {
    const pack = packs.find(p => p.packId === ref.packId);
    if (!pack) continue;
    any = true;
    const entries = ref.kind === 'part' ? pack.parts : pack.clips;
    if (!entries.some(e => e.id === ref.id)) continue;
    try {
      const st = await stat(
        join(packsDir, ref.packId, `${ref.kind}s`, `${ref.id}.glb`),
      );
      sizes.set(`${ref.packId}/${ref.kind}/${ref.id}`, st.size);
    } catch {
      // A missing file is reported as AST_FILE_MISSING by the pack check.
    }
  }
  return any ? sizes : null;
}
