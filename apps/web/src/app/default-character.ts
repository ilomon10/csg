import {DEFAULT_CLIP_REFS, createDefaultCharacterSpec} from '@csg/parts-schema';
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';

/** Ref of the clip the preview starts with (spec 004, bundled UAL pack). */
export const DEFAULT_CLIP: ClipRef = DEFAULT_CLIP_REFS[0] as ClipRef;

/** The M1 preview clips (REQ-ANM-001), in menu order, from the default character data. */
export const PREVIEW_CLIPS: readonly {ref: ClipRef; label: string}[] =
  DEFAULT_CLIP_REFS.map(ref => {
    const id = ref.slice(ref.lastIndexOf('/') + 1);
    return {ref, label: id.charAt(0).toUpperCase() + id.slice(1)};
  });

/**
 * The default character (REQ-CMP-036), read from the shared data file in `@csg/parts-schema`.
 *
 * @returns A fresh spec.
 */
export function createPreviewCharacter(): CharacterSpec {
  return createDefaultCharacterSpec();
}
