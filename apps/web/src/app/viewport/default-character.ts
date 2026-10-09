import {
  DEFAULT_CLIP_REFS,
  createDefaultCharacterSpec,
  createProjectDocument,
  defaultRenderSettings,
} from '@csg/parts-schema';
import type {
  AnimationSelection,
  CharacterSpec,
  ClipRef,
  ProjectDocument,
  RenderSettings,
} from '@csg/parts-schema';

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

/** Export defaults per default clip (manifest `defaultFrameCount`, `fit` fps, spec 004 REQ-ANM-009). */
const CLIP_DEFAULTS: Readonly<
  Record<string, {frameCount: number; fps: number}>
> = {idle: {frameCount: 12, fps: 5}, walk: {frameCount: 8, fps: 6}};

/**
 * Default render settings of the preview (spec 003: `three-quarter`, 64 px) with the
 * default character's clips selected, so the preview framing covers them (REQ-PIX-007).
 *
 * @param preset - Camera preset; defaults to `three-quarter`.
 * @returns Fresh settings.
 */
export function createPreviewSettings(
  preset: Parameters<typeof defaultRenderSettings>[0] = 'three-quarter',
): RenderSettings {
  const base = defaultRenderSettings(preset);
  const animations: AnimationSelection[] = PREVIEW_CLIPS.map(c => {
    const d = CLIP_DEFAULTS[c.ref.slice(c.ref.lastIndexOf('/') + 1)];
    return {
      clipId: c.ref,
      label: c.label.toLowerCase(),
      frameCount: d?.frameCount ?? 8,
      fps: d?.fps ?? 8,
      loop: true,
      timing: 'fit',
    };
  });
  return {...base, animations};
}

/** Ref of the bundled idle clip (spec 004). */
export const IDLE_CLIP: ClipRef =
  PREVIEW_CLIPS.find(c => c.label === 'Idle')?.ref ?? DEFAULT_CLIP;

/** Ref of the bundled walk clip (spec 004). */
export const WALK_CLIP: ClipRef =
  PREVIEW_CLIPS.find(c => c.label === 'Walk')?.ref ?? DEFAULT_CLIP;

/**
 * Creates the document of a brand-new project: the default clip selection
 * (`idle`, then `walk`; spec 001 default character, spec 004 REQ-ANM-004) is applied so
 * the first export is never empty.
 *
 * @param character - The character of the new project.
 * @param preset - Camera preset of the render defaults; defaults to `three-quarter`.
 * @returns A fresh document.
 */
export function createNewProjectDocument(
  character: CharacterSpec,
  preset: Parameters<typeof defaultRenderSettings>[0] = 'three-quarter',
): ProjectDocument {
  return createProjectDocument(character, createPreviewSettings(preset));
}
