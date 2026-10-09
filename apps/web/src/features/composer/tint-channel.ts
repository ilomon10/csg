import type {TintSlot} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';

/**
 * The first tint channel of a part (REQ-UX-062: the swatch row follows the most recently
 * selected part in the category). Null when the part has none or is unknown.
 */
export function firstTintChannel(
  catalog: Catalog,
  ref: string,
): TintSlot | null {
  const part = catalog.parts.find(p => p.ref === ref);
  return part?.tintSlots[0]?.slot ?? null;
}
