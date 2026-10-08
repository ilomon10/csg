import {createDefaultCharacterSpec} from '@csg/parts-schema';
import type {CharacterSpec, ClipRef} from '@csg/parts-schema';

/** Ref of the clip the preview starts with (spec 004, bundled UAL pack). */
export const DEFAULT_CLIP = 'builtin:quaternius-ual/idle' as ClipRef;

/** The M1 preview clips (REQ-ANM-001), in menu order. */
export const PREVIEW_CLIPS = [
  {ref: DEFAULT_CLIP, label: 'Idle'},
  {ref: 'builtin:quaternius-ual/walk' as ClipRef, label: 'Walk'},
] as const;

const OUTFITS = 'builtin:quaternius-outfits';

/**
 * The default character (REQ-CMP-036): the male superhero body with simple parted hair,
 * regular eyebrows and the male ranger outfit. The part refs match the M1-14 pack configs.
 *
 * @returns A fresh spec.
 */
export function createPreviewCharacter(): CharacterSpec {
  const base = createDefaultCharacterSpec();
  return {
    ...base,
    parts: {
      hair: {ref: 'builtin:quaternius-ubc/hair-simple-parted'},
      eyebrows: {ref: 'builtin:quaternius-ubc/eyebrows-regular'},
      torso: {ref: `${OUTFITS}/male-ranger-torso`},
      arms: {ref: `${OUTFITS}/male-ranger-arms`},
      legs: {ref: `${OUTFITS}/male-ranger-legs`},
      feet: {ref: `${OUTFITS}/male-ranger-boots`},
    },
  };
}
