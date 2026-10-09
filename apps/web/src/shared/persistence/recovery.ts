import {z} from 'zod';
import {findForbiddenKey} from '@csg/parts-schema';

/** localStorage key of the start-up recovery markers (REQ-UX-045, REQ-UX-049). */
export const RECOVERY_KEY = 'csg.recovery';

const MAX_RECOVERY_CHARS = 1024;

const recoverySchema = z
  .object({
    format: z.literal('sprite-recovery'),
    version: z.literal(1),
    restoreInProgress: z
      .object({projectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)})
      .strict()
      .optional(),
    offerSafeMode: z.boolean().optional(),
  })
  .strict();

/** Start-up recovery markers. */
export type RecoveryMarkers = z.infer<typeof recoverySchema>;

/** Markers with nothing set. */
export function emptyRecovery(): RecoveryMarkers {
  return {format: 'sprite-recovery', version: 1};
}

/** Reads the markers; anything missing, oversized or invalid yields empty markers. */
export function readRecovery(storage: Storage | null): RecoveryMarkers {
  try {
    const text = storage?.getItem(RECOVERY_KEY);
    if (
      text === null ||
      text === undefined ||
      text.length > MAX_RECOVERY_CHARS
    ) {
      return emptyRecovery();
    }
    const json: unknown = JSON.parse(text);
    if (findForbiddenKey(json) !== null) return emptyRecovery();
    const parsed = recoverySchema.safeParse(json);
    return parsed.success ? parsed.data : emptyRecovery();
  } catch {
    return emptyRecovery();
  }
}

/** Writes the markers; removes the key when none is set. Storage failures are ignored. */
export function writeRecovery(
  storage: Storage | null,
  markers: RecoveryMarkers,
): void {
  try {
    if (
      markers.restoreInProgress === undefined &&
      markers.offerSafeMode !== true
    ) {
      storage?.removeItem(RECOVERY_KEY);
    } else {
      storage?.setItem(RECOVERY_KEY, JSON.stringify(markers));
    }
  } catch {
    // Unavailable storage means no marker; the editor still starts.
  }
}
