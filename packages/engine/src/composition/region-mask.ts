/**
 * Body region hides (spec 001 REQ-CMP-011, REQ-CMP-012; spec 011 REQ-AST-025,
 * REQ-AST-028). Hidden regions form a bit mask (bit `i` = `BODY_REGIONS[i]`)
 * held in one uniform; the fragment stage discards fragments whose Float32
 * `regionId` vertex attribute names a hidden region. Changing hides updates the
 * uniform only: no recompile, no geometry rebuild, deterministic.
 */
import {attribute, exp2, floor, mod, uniform} from 'three/tsl';
import type {Node, UniformNode} from 'three/webgpu';
import {BODY_REGIONS} from '@csg/parts-schema';
import type {BodyRegion, SlotId} from '@csg/parts-schema';
import type {RegionMask, RegionMaskOf} from '../contracts/composition';

/**
 * Name of the Float32 vertex attribute the shaders read (REQ-AST-028). The
 * loader converts the file's `_REGION` (three: `_region`) to it.
 */
export const REGION_ID_ATTRIBUTE = 'regionId';

/** The slot whose part REQ-CMP-012 hides when some part hides `hair`. */
export const HAIR_SLOT: SlotId = 'hair';

/**
 * Hide mask of a set of regions: bit `i` set for `BODY_REGIONS[i]`
 * (REQ-AST-025). Duplicates are ignored.
 *
 * @param hidden - Regions to hide.
 * @returns The mask, for example `1088` for `['hands', 'feet']`.
 * @throws Error for a value that is not a body region (programmer error).
 */
export const regionMaskOf: RegionMaskOf = hidden => {
  let mask = 0;
  for (const region of hidden) {
    const index = BODY_REGIONS.indexOf(region);
    if (index < 0) throw new Error(`regionMaskOf: unknown region "${region}"`);
    mask |= 1 << index;
  }
  return mask;
};

/**
 * Whether a region index is hidden by a mask; the CPU twin of the shader test
 * in {@link regionVisibleNode} (same float formula, same rounding).
 *
 * @param mask - Hide mask from {@link regionMaskOf}.
 * @param regionId - Region index as stored in `regionId`.
 * @returns `true` when bit `round(regionId)` of `mask` is set.
 */
export function isRegionHidden(mask: number, regionId: number): boolean {
  const r = Math.floor(regionId + 0.5);
  return Math.floor(mask / 2 ** r) % 2 >= 0.5;
}

/** A part equipped in a slot, as seen by {@link computeHides}. */
export interface EquippedPartHides {
  /** Slot the part is equipped in. */
  readonly slot: SlotId;
  /** The part's manifest entry (only `hides` is read). */
  readonly entry: {readonly hides: readonly BodyRegion[]};
}

/** Result of {@link computeHides}. */
export interface HideState {
  /** Union of all `hides`, in `BODY_REGIONS` order (REQ-CMP-011). */
  readonly regions: readonly BodyRegion[];
  /** Bit mask of {@link HideState.regions}. */
  readonly mask: number;
  /**
   * Slots whose part is not drawn (kept in the `CharacterSpec`): `hair` when
   * any part in another slot hides `hair` (REQ-CMP-012).
   */
  readonly hiddenSlots: readonly SlotId[];
}

/**
 * Hide state of a set of equipped parts: the union of their `hides`
 * (REQ-CMP-011) and the slots not drawn because of a `hair` hide
 * (REQ-CMP-012). Order-independent and deterministic.
 *
 * @param equipped - Every equipped part, the body included.
 * @returns Regions, mask and hidden slots.
 */
export function computeHides(equipped: Iterable<EquippedPartHides>): HideState {
  const set = new Set<BodyRegion>();
  let hideHairSlot = false;
  for (const part of equipped) {
    for (const region of part.entry.hides) {
      set.add(region);
      // A hair part never hides itself.
      if (region === 'hair' && part.slot !== HAIR_SLOT) hideHairSlot = true;
    }
  }
  const regions = BODY_REGIONS.filter(region => set.has(region));
  return {
    regions,
    mask: regionMaskOf(regions),
    hiddenSlots: hideHairSlot ? [HAIR_SLOT] : [],
  };
}

/**
 * Creates the region mask uniform shared by every body material of a
 * character. Update it with {@link setRegionMask}; no recompile.
 *
 * @param initial - Initial mask (default `0`: everything drawn).
 * @returns A uniform node that is also a {@link RegionMask}.
 */
export function createRegionMask(initial = 0): UniformNode<'float', number> {
  return uniform(initial);
}

/**
 * Sets the hidden regions of a mask uniform in place (REQ-CMP-011: hidden on
 * equip, drawn again on unequip).
 *
 * @param mask - Mask from {@link createRegionMask}.
 * @param hidden - Regions to hide now.
 */
export function setRegionMask(
  mask: RegionMask,
  hidden: readonly BodyRegion[],
): void {
  mask.value = regionMaskOf(hidden);
}

/**
 * TSL condition that is true when the fragment's region is drawn: bit
 * `round(regionId)` of the mask is 0. Float arithmetic only (exact for masks
 * below 2^24), so it compiles identically for WGSL and GLSL ES 3.0. Use as a
 * node material's `maskNode` (fragments are discarded when it is false).
 *
 * @param mask - The mask uniform node.
 * @returns A boolean node.
 */
export function regionVisibleNode(mask: UniformNode<'float', number>): Node {
  const region = floor(
    attribute<'float'>(REGION_ID_ATTRIBUTE, 'float').add(0.5),
  );
  const bit = mod(floor(mask.div(exp2(region))), 2);
  return bit.lessThan(0.5);
}
