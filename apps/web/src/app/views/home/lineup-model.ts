import type {CameraPreset} from '@csg/parts-schema';
import type {CharacterPreset} from '@csg/parts-schema';
import type {ProjectListMeta} from '../../../shared/persistence';

/** Side of a home frame in px (`HOME_RENDER_PROFILE.resolution`). */
export const SPRITE_PX = 64;

/** One character of the lineup and the avatar strip (REQ-UX-072). */
export interface HomeItem {
  /** The project ID, or `preset:<presetId>` (project IDs never contain a colon). */
  readonly id: string;
  readonly kind: 'saved' | 'preset';
  readonly name: string;
  /** Epoch ms of the last edit; `null` for presets. */
  readonly editedAt: number | null;
  readonly pinned: boolean;
  /** Camera of a preset (REQ-UX-078); absent means `side`. */
  readonly camera?: Exclude<CameraPreset, 'custom'>;
  /** Local thumbnail of a preset, shown until its frames are rendered (REQ-UX-081). */
  readonly thumbnailUrl?: string;
}

/** The ID prefix of preset entries. */
export const PRESET_PREFIX = 'preset:';

/**
 * Orders the lineup (REQ-UX-072): pinned saved characters (most recently edited first), the
 * other saved characters (most recently edited first), then the presets in pack order.
 */
export function orderLineup(
  saved: readonly ProjectListMeta[],
  presets: ReadonlyArray<CharacterPreset & {readonly thumbnailUrl?: string}>,
): HomeItem[] {
  const byEdit = (a: ProjectListMeta, b: ProjectListMeta): number =>
    b.lastEditedAt - a.lastEditedAt ||
    a.name.localeCompare(b.name) ||
    a.projectId.localeCompare(b.projectId);
  const toItem = (m: ProjectListMeta): HomeItem => ({
    id: m.projectId,
    kind: 'saved',
    name: m.name,
    editedAt: m.lastEditedAt,
    pinned: m.pinned,
  });
  return [
    ...saved
      .filter(m => m.pinned)
      .sort(byEdit)
      .map(toItem),
    ...saved
      .filter(m => !m.pinned)
      .sort(byEdit)
      .map(toItem),
    ...presets.map((p): HomeItem => ({
      id: `${PRESET_PREFIX}${p.id}`,
      kind: 'preset',
      name: p.name,
      editedAt: null,
      pinned: false,
      ...(p.camera === undefined ? {} : {camera: p.camera}),
      ...(p.thumbnailUrl === undefined ? {} : {thumbnailUrl: p.thumbnailUrl}),
    })),
  ];
}

/** Largest integer scale with 64 x s at most 50 % of the lineup height, at least 2 (REQ-UX-073). */
export function lineupScale(heightPx: number): number {
  return Math.max(2, Math.floor((heightPx * 0.5) / SPRITE_PX));
}

/** Scale of every character but the selected one (REQ-UX-073). */
export function neighbourScale(selectedScale: number): number {
  return Math.max(1, selectedScale - 1);
}

/** Distance between two slot centres; constant, so the row slides as one rigid strip. */
export function slotWidth(selectedScale: number): number {
  return SPRITE_PX * neighbourScale(selectedScale) + 56;
}

/** `translateX` of the row that centres slot `index` in a stage `stageWidth` wide. */
export function rowOffset(
  stageWidth: number,
  slot: number,
  index: number,
): number {
  return Math.round(stageWidth / 2 - (index + 0.5) * slot);
}

/** Sprite opacity by distance from the selection (REQ-UX-073). */
export function spriteOpacity(distance: number): number {
  const d = Math.abs(distance);
  return d === 0 ? 1 : d === 1 ? 0.7 : 0.45;
}

/** Slots worth drawing: the visible ones plus one on each side (REQ-UX-080, no off-screen work). */
export function visibleRange(
  stageWidth: number,
  slot: number,
  selected: number,
  count: number,
): readonly [number, number] {
  const half = Math.ceil(stageWidth / 2 / slot) + 1;
  return [Math.max(0, selected - half), Math.min(count - 1, selected + half)];
}

/**
 * A uniformly distributed index below `count` from a source of uniform 32-bit integers, by
 * rejection sampling (no modulo bias, REQ-UX-077).
 */
export function pickUniform(count: number, random: () => number): number {
  if (count <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / count) * count;
  for (let guard = 0; guard < 64; guard++) {
    const v = random() >>> 0;
    if (v < limit) return v % count;
  }
  return 0;
}

/** Uniform 32-bit integers from `crypto.getRandomValues` (REQ-UX-077). */
export function cryptoUint32(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}
