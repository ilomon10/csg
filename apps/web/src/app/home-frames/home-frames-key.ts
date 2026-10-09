import {canonicalCharacterJson} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import {HOME_RENDER_PROFILE} from './home-profile';

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The cache key of a character's home frames (REQ-UX-080): lowercase hex SHA-256 of the
 * canonical `CharacterSpec` JSON, the profile version and the sorted `packId@version` list,
 * each followed by a newline. Any change to the character, the profile or a pack gives a new
 * key, so stale frames are never shown for an edited character.
 *
 * @param spec The character.
 * @param packVersions `packId@<hash>` per loaded pack (catalog `packVersions`).
 */
export async function homeFramesKey(
  spec: CharacterSpec,
  packVersions: readonly string[],
): Promise<string> {
  const text = `${canonicalCharacterJson(spec, 0)}\n${HOME_RENDER_PROFILE.version}\n${[
    ...packVersions,
  ]
    .sort()
    .join('\n')}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return hex(digest);
}
