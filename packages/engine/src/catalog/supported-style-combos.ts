import type {CharacterSpecies, CharacterStyle} from '@csg/parts-schema';

/**
 * The (style, species) pairs this build renders (REQ-CMP-043, REQ-CMP-045; spec 013
 * REQ-STY-029 says when a pair is added). M3: `realistic`/`human` and `chibi`/`human`. A pair
 * is only offered when it is also available in the loaded packs (`availableStyleCombos`).
 */
export const SUPPORTED_STYLE_COMBOS: ReadonlyArray<
  readonly [CharacterStyle, CharacterSpecies]
> = [
  ['realistic', 'human'],
  ['chibi', 'human'],
];
