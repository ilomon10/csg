import {z} from 'zod';
import {findForbiddenKey} from '@csg/parts-schema';

/** localStorage key of the unclean-shutdown marker (REQ-UX-045). Private to the shell. */
export const SESSION_KEY = 'csg.session';

const schema = z
  .object({
    format: z.literal('sprite-session'),
    version: z.literal(1),
    projectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  })
  .strict();

/**
 * The marker is set when a project gets changes newer than its last explicit save and cleared
 * on an explicit save or a clean page exit. A marker found at start means the previous session
 * ended unclean (crash, kill) with changes that only the autosave holds.
 */
export interface SessionMarker {
  /** Project of the previous unclean session, if any. */
  read(): string | null;
  set(projectId: string): void;
  clear(): void;
}

/** Creates the marker over `storage` (`null` when unavailable). */
export function createSessionMarker(storage: Storage | null): SessionMarker {
  return {
    read() {
      try {
        const text = storage?.getItem(SESSION_KEY);
        if (text === null || text === undefined || text.length > 512)
          return null;
        const json: unknown = JSON.parse(text);
        if (findForbiddenKey(json) !== null) return null;
        const parsed = schema.safeParse(json);
        return parsed.success ? parsed.data.projectId : null;
      } catch {
        return null;
      }
    },
    set(projectId) {
      try {
        storage?.setItem(
          SESSION_KEY,
          JSON.stringify({format: 'sprite-session', version: 1, projectId}),
        );
      } catch {
        // Without storage there is nothing to restore from anyway.
      }
    },
    clear() {
      try {
        storage?.removeItem(SESSION_KEY);
      } catch {
        // Ignored.
      }
    },
  };
}
