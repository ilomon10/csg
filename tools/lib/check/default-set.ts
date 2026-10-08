/**
 * The default character and its default clips (spec 001 REQ-CMP-036, spec 011 AC-AST-016.2).
 * Used to size the first-load transfer.
 */
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {LicensePack} from './licenses-md.js';

/** A bundled part or clip the default set needs. */
export interface DefaultSetRef {
  packId: string;
  kind: 'part' | 'clip';
  id: string;
}

/** Default `CharacterSpec` parts and default clips (M1-14 pack configs). */
export const DEFAULT_SET: readonly DefaultSetRef[] = [
  {packId: 'quaternius-ubc', kind: 'part', id: 'superhero-m'},
  {packId: 'quaternius-ubc', kind: 'part', id: 'hair-simple-parted'},
  {packId: 'quaternius-ubc', kind: 'part', id: 'eyebrows-regular'},
  {packId: 'quaternius-outfits', kind: 'part', id: 'male-ranger-torso'},
  {packId: 'quaternius-outfits', kind: 'part', id: 'male-ranger-arms'},
  {packId: 'quaternius-outfits', kind: 'part', id: 'male-ranger-legs'},
  {packId: 'quaternius-outfits', kind: 'part', id: 'male-ranger-boots'},
  {packId: 'quaternius-ual', kind: 'clip', id: 'idle'},
  {packId: 'quaternius-ual', kind: 'clip', id: 'walk'},
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
