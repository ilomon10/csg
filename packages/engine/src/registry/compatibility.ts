/**
 * Part-to-body compatibility (spec 001 REQ-CMP-008, REQ-CMP-037).
 */
import type {CompatibilityCheck} from '../contracts/registry';

/**
 * Compatibility of a part with a body (REQ-CMP-008), checked in this order:
 * (a) a skinned part's `rig` must equal the body's rig, else reason `rig`;
 * (b) a non-empty `bodies` must contain the body's part ID, else reason `body`;
 * (c) a non-empty `bodyTypes` must contain the body's `bodyType`, else reason `body-type`.
 *
 * Skeleton groups are deliberately not compared: a bind-pose difference does not affect
 * compatibility, because every mesh is rebound with its own inverse bind matrices
 * (REQ-CMP-008 M1 note, REQ-CMP-037). Static props are rig-agnostic.
 */
export const checkCompatibility: CompatibilityCheck = (part, body) => {
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
  return {ok: true};
};
