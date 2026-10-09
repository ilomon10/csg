import type {CharacterSpec} from '@csg/parts-schema';
import type {Catalog, CatalogPart} from '../../shared/catalog';
import {MESSAGES, t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';

/** Resolves a data-file message key (`labelKey`, `nameKey`); unknown keys fall back to `fallback`. */
export function messageOr(key: string, fallback: string): string {
  return Object.hasOwn(MESSAGES, key) ? t(key as MessageKey) : fallback;
}

/** Display name of a slot from the registry's label key (`slot.<id>`). */
export function slotLabel(catalog: Catalog, slotId: string): string {
  const def = catalog.slots.slots.find(slot => slot.id === slotId);
  return messageOr(def?.label ?? `slot.${slotId}`, slotId);
}

/** Display name of an Easy category (`ux.easy.<id>`). */
export function categoryLabel(label: string, id: string): string {
  return messageOr(label, id);
}

/**
 * Why `part` does not fit `spec`, as text (REQ-CMP-009): "Fits Superhero bodies only" for a
 * body restriction that names bodies, otherwise a generic reason. Returns null when it fits.
 */
export function incompatibleReason(
  catalog: Catalog,
  part: CatalogPart,
  spec: CharacterSpec,
): string | null {
  const verdict = catalog.compatible(part, spec);
  if (verdict.ok) return null;
  if (verdict.reason === 'body' && (part.bodies?.length ?? 0) > 0) {
    const names = (part.bodies ?? []).map(
      id =>
        catalog.parts.find(p => p.slot === 'body' && p.id === id)?.name ?? id,
    );
    return t('composer.part.fitsBodies', {bodies: names.join(', ')});
  }
  const key = `composer.part.reason.${verdict.reason}`;
  return messageOr(key, t('composer.part.reason.body'));
}

/** The pack-relative id of an asset ref (`builtin:pack/cape-99` becomes `cape-99`). */
export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf('/') + 1);
}
