/**
 * Part-to-character compatibility (spec 001 REQ-CMP-008, REQ-CMP-037, REQ-CMP-048).
 */
import type {CompatibilityCheck} from '../contracts/registry';

/**
 * Compatibility of a part with a body and character (REQ-CMP-008, REQ-CMP-048), checked in
 * this order, the first failing rule giving the reason:
 * (a) a skinned part's `rig` must equal the body's rig, else reason `rig`;
 * (b) a non-empty `bodies` must contain the body's part ID, else reason `body`;
 * (c) a non-empty `bodyTypes` must contain the body's `bodyType`, else reason `body-type`;
 * (d) a non-empty `styles` must contain the character's `style`, else reason `style`;
 * (e) a non-empty `species` must contain the character's `species`, else reason `species`.
 * Rules (d) and (e) apply only when `character` is given; parts that declare neither field
 * (every M3 bundled part) are unaffected by them.
 *
 * Skeleton groups are deliberately not compared: a bind-pose difference does not affect
 * compatibility, because every mesh is rebound with its own inverse bind matrices
 * (REQ-CMP-008 M1 note, REQ-CMP-037). Static props are rig-agnostic. Pure; three-free (it is
 * re-exported by `@csg/engine/catalog`).
 */
export const checkCompatibility: CompatibilityCheck = (
  part,
  body,
  character,
) => {
  if (part.kind === 'skinned' && part.rig !== body.rig) {
    return {ok: false, reason: 'rig'};
  }
  const bodies = part.bodies ?? [];
  if (bodies.length > 0 && !bodies.includes(body.id)) {
    return {ok: false, reason: 'body'};
  }
  const bodyTypes = part.bodyTypes ?? [];
  if (
    bodyTypes.length > 0 &&
    (body.bodyType === undefined || !bodyTypes.includes(body.bodyType))
  ) {
    return {ok: false, reason: 'body-type'};
  }
  if (character === undefined) return {ok: true};
  const styles = part.styles ?? [];
  if (styles.length > 0 && !styles.includes(character.style)) {
    return {ok: false, reason: 'style'};
  }
  const species = part.species ?? [];
  if (species.length > 0 && !species.includes(character.species)) {
    return {ok: false, reason: 'species'};
  }
  return {ok: true};
};
