/** Deterministic part IDs (REQ-PIX-014), independent of load order. */

/** Highest usable part ID; 0 is background and 255 is reserved (exact in fp16). */
export const MAX_PART_ID = 254;

/** The slice of the slot registry needed to assign IDs. */
export interface PartIdRegistry {
  readonly slots: ReadonlyArray<{readonly id: string; readonly order: number}>;
}

/** Part ID of the body slot. */
export const BODY_PART_ID = 1;

/**
 * Part ID of a slot: 1 for `body`, then 2.. by ascending registry `order`
 * (ties by id), skipping the body. Never depends on load order or on
 * alphabetical slot keys.
 *
 * @param slot Slot ID.
 * @param registry Slot registry.
 * @returns An integer in `1..MAX_PART_ID`.
 * @throws Error when the slot is unknown or the registry is too large.
 */
export function partIdFor(slot: string, registry: PartIdRegistry): number {
  if (slot === 'body') return BODY_PART_ID;
  const sorted = registry.slots
    .filter(s => s.id !== 'body')
    .sort(
      (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const index = sorted.findIndex(s => s.id === slot);
  if (index < 0) throw new Error(`partIdFor: unknown slot "${slot}"`);
  const id = BODY_PART_ID + 1 + index;
  if (id > MAX_PART_ID)
    throw new Error(`partIdFor: slot "${slot}" exceeds ${MAX_PART_ID}`);
  return id;
}
