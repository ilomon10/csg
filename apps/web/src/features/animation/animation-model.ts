import type {MessageKey} from '../../shared/i18n';
import type {
  AnimationSelection,
  CharacterStyle,
  ClipCategory,
  ClipRef,
} from '@csg/parts-schema';
import type {DocCommand} from '../../shared/document';

/** Most clips one export can hold (REQ-ANM-004). */
export const MAX_ANIMATIONS = 32;

/** The clip fields the panel reads. The catalog's `CatalogClip` satisfies it. */
export interface PanelClip {
  readonly ref: string;
  readonly id: string;
  readonly name: string;
  readonly category: ClipCategory;
  readonly durationSec: number;
  readonly loop: boolean;
  readonly defaultFrameCount: number;
  readonly rig: string;
  readonly tags: readonly string[];
}

/** The slice of the shared catalog the animation panel reads. `Catalog` satisfies it. */
export interface AnimationCatalog {
  readonly clips: readonly PanelClip[];
  readonly styles: ReadonlyMap<
    CharacterStyle,
    {readonly excludedClips: ReadonlyArray<{readonly clip: string}>}
  >;
}

/** The pack-relative id of a clip ref (`builtin:pack/walk` becomes `walk`). */
export function clipRefName(ref: string): string {
  return ref.slice(Math.max(ref.lastIndexOf('/'), ref.lastIndexOf('#')) + 1);
}

/** Display name of a selection's clip: the catalog name, else the ref's id. */
export function clipDisplayName(
  catalog: AnimationCatalog,
  ref: string,
): string {
  return catalog.clips.find(c => c.ref === ref)?.name ?? clipRefName(ref);
}

/** Clips the style hides from the picker (REQ-ANA-025). */
export function excludedRefs(
  catalog: AnimationCatalog,
  style: CharacterStyle,
): ReadonlySet<string> {
  return new Set(
    (catalog.styles.get(style)?.excludedClips ?? []).map(e => e.clip),
  );
}

/** `fit` timing default: `round(N / D)` clamped to 1-60 (REQ-ANM-009). */
export function defaultFps(frameCount: number, durationSec: number): number {
  return Math.min(60, Math.max(1, Math.round(frameCount / durationSec)));
}

/** Length of the sampled span: the range, else the whole clip. */
export function sampledDuration(
  selection: AnimationSelection,
  durationSec: number,
): number {
  return selection.range
    ? selection.range.endSec - selection.range.startSec
    : durationSec;
}

/** Playback speed relative to the source clip, `fps * D / N` (REQ-ANM-009). */
export function playbackSpeed(
  selection: AnimationSelection,
  durationSec: number,
): number {
  return (
    (selection.fps * sampledDuration(selection, durationSec)) /
    selection.frameCount
  );
}

/** A label that is unique in `list`: `walk`, then `walk-2`, `walk-3` (REQ-ANM-006). */
export function uniqueLabel(
  base: string,
  list: readonly AnimationSelection[],
): string {
  const taken = new Set(list.map(s => s.label));
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40);
  const root = clean === '' ? 'clip' : clean;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A selection with the manifest defaults (REQ-ANM-004, REQ-ANM-009). */
export function newSelection(
  clip: PanelClip,
  list: readonly AnimationSelection[],
): AnimationSelection {
  const frameCount = Math.min(64, Math.max(1, clip.defaultFrameCount));
  return {
    clipId: clip.ref as ClipRef,
    label: uniqueLabel(clip.id, list),
    frameCount,
    fps: defaultFps(frameCount, clip.durationSec),
    loop: clip.loop,
    timing: 'fit',
  };
}

/** Wraps a change of `RenderSettings.animations` as one undoable command. */
export function animationsCommand(
  label: string,
  update: (
    list: readonly AnimationSelection[],
  ) => readonly AnimationSelection[] | null,
  coalesceKey?: string,
): DocCommand {
  return {
    label,
    feature: 'animation',
    ...(coalesceKey ? {coalesceKey} : {}),
    apply(doc) {
      const current = doc.render.animations;
      const next = update(current);
      if (!next || next === current) return null;
      return {...doc, render: {...doc.render, animations: [...next]}};
    },
  };
}

/** Appends a clip unless the list is full (AC-ANM-004.2). */
export function addAnimation(clip: PanelClip): DocCommand {
  return animationsCommand(`Add ${clip.name}`, list =>
    list.length >= MAX_ANIMATIONS ? null : [...list, newSelection(clip, list)],
  );
}

/** Removes the entry at `index`. */
export function removeAnimation(index: number, name: string): DocCommand {
  return animationsCommand(`Remove ${name}`, list =>
    index < 0 || index >= list.length
      ? null
      : list.filter((_, i) => i !== index),
  );
}

/** Moves an entry by `delta` positions: one undo step (AC-ANM-004.3). */
export function moveAnimation(
  index: number,
  delta: -1 | 1,
  name: string,
): DocCommand {
  return animationsCommand(`Move ${name}`, list => {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) {
      return null;
    }
    const next = [...list];
    const [item] = next.splice(index, 1);
    if (!item) return null;
    next.splice(to, 0, item);
    return next;
  });
}

/** Replaces fields of one entry. `undefined` values delete the key. */
export function patchAnimation(
  index: number,
  patch: {[K in keyof AnimationSelection]?: AnimationSelection[K] | undefined},
  name: string,
): DocCommand {
  const keys = Object.keys(patch).join(',');
  return animationsCommand(
    `Change ${name}`,
    list => {
      const current = list[index];
      if (!current) return null;
      const merged: Record<string, unknown> = {...current};
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }
      const next = merged as unknown as AnimationSelection;
      if (JSON.stringify(next) === JSON.stringify(current)) return null;
      return list.map((entry, i) => (i === index ? next : entry));
    },
    `animation:${index}:${keys}`,
  );
}

/** A parsed field: the value, or the message key of the error (the previous value is kept). */
export type Parsed<T> =
  | {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly error: MessageKey};

function parseInt01(
  text: string,
  max: number,
  error: MessageKey,
): Parsed<number> {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max
    ? {ok: true, value: n}
    : {ok: false, error};
}

/** Frames: integer 1-64 (REQ-ANM-005, AC-ANM-005.1). */
export function parseFrames(text: string): Parsed<number> {
  return parseInt01(text, 64, 'animation.error.frames');
}

/** FPS: integer 1-60 (REQ-ANM-005). */
export function parseFps(text: string): Parsed<number> {
  return parseInt01(text, 60, 'animation.error.fps');
}

/**
 * Range inside `[0, durationSec]` with `start < end` (REQ-ANM-005, AC-ANM-005.2). A blank start
 * means 0 and a blank end the clip end; both blank clears the range.
 */
export function parseRange(
  startText: string,
  endText: string,
  durationSec: number,
): Parsed<{startSec: number; endSec: number} | undefined> {
  if (startText.trim() === '' && endText.trim() === '') {
    return {ok: true, value: undefined};
  }
  const startSec = startText.trim() === '' ? 0 : Number(startText);
  const endSec = endText.trim() === '' ? durationSec : Number(endText);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    return {ok: false, error: 'animation.error.range'};
  }
  if (startSec < 0 || endSec > durationSec) {
    return {ok: false, error: 'animation.error.rangeBounds'};
  }
  if (startSec >= endSec) return {ok: false, error: 'animation.error.range'};
  return {ok: true, value: {startSec, endSec}};
}

/** Label: `[a-z0-9-]{1,48}`. */
export const LABEL_PATTERN = /^[a-z0-9-]{1,48}$/;
