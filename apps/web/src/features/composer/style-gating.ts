import type {CharacterSpecies, CharacterStyle} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';

/**
 * The single gating rule of REQ-CMP-045 / REQ-UX-092: a style or species option is enabled
 * only when its pair with the other current value is in `catalog.availableCombos`, the result of
 * `availableStyleCombos` (engine support AND content in the loaded packs). Nothing else decides.
 */
export function isPairAvailable(
  catalog: Pick<Catalog, 'availableCombos'>,
  style: CharacterStyle,
  species: CharacterSpecies,
): boolean {
  return catalog.availableCombos.some(
    ([s, sp]) => s === style && sp === species,
  );
}
