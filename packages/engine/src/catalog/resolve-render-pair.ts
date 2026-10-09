import type {
  CharacterSpec,
  CharacterSpecies,
  CharacterStyle,
} from '@csg/parts-schema';

/** The pair the preview and export actually render, and whether it differs from the stored one. */
export interface RenderPair {
  style: CharacterStyle;
  species: CharacterSpecies;
  /** True when the stored pair is unavailable and a fallback is used (REQ-CMP-043). */
  fallback: boolean;
}

/**
 * Picks the (style, species) pair to render (REQ-CMP-043). A stored pair in `available` is used
 * as is. Otherwise a style that no available pair uses becomes `realistic`, a species that no
 * available pair uses becomes `human`; if that pair is still unavailable the result is
 * `realistic`/`human`. The stored values are never changed. Pure.
 *
 * @param spec The character (only `style` and `species` are read).
 * @param available Pairs the build supports and the loaded packs provide (`availableStyleCombos`).
 */
export function resolveRenderPair(
  spec: Pick<CharacterSpec, 'style' | 'species'>,
  available: ReadonlyArray<readonly [CharacterStyle, CharacterSpecies]>,
): RenderPair {
  const has = (style: CharacterStyle, species: CharacterSpecies): boolean =>
    available.some(([s, p]) => s === style && p === species);
  if (has(spec.style, spec.species)) {
    return {style: spec.style, species: spec.species, fallback: false};
  }
  const style = available.some(([s]) => s === spec.style)
    ? spec.style
    : 'realistic';
  const species = available.some(([, p]) => p === spec.species)
    ? spec.species
    : 'human';
  const pair = has(style, species)
    ? {style, species}
    : {style: 'realistic' as const, species: 'human' as const};
  return {...pair, fallback: true};
}
