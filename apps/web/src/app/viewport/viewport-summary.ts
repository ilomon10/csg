import {DIRECTION_ORDER} from '@csg/parts-schema';
import type {ClipRef} from '@csg/parts-schema';

/** Spoken names of the eight facings, by `DIRECTION_ORDER` label. */
const FACING_NAMES: Readonly<Record<string, string>> = {
  e: 'east',
  ne: 'north-east',
  n: 'north',
  nw: 'north-west',
  w: 'west',
  sw: 'south-west',
  s: 'south',
  se: 'south-east',
};

/** The announcement for a facing, for example "Facing south-west" (REQ-UX-058). */
export function facingAnnouncement(directionIndex: number): string {
  const label = DIRECTION_ORDER[directionIndex] ?? 's';
  return `Facing ${FACING_NAMES[label] ?? label}`;
}

/** The short clip name of a `ClipRef` (`builtin:pack/walk` is `walk`). */
export function clipName(ref: ClipRef): string {
  const tail = ref.slice(
    Math.max(ref.lastIndexOf('/'), ref.lastIndexOf(':')) + 1,
  );
  return tail === '' ? ref : tail;
}

/** Inputs of {@link buildViewportSummary}. */
export interface ViewportSummaryInput {
  /** Character name; rendered as text. */
  readonly label: string;
  readonly partCount: number;
  readonly clip: ClipRef;
  /** 1-based, or `null` while the frame is unknown. */
  readonly frame: number | null;
  readonly frameCount: number | null;
  /** Index into `DIRECTION_ORDER`. */
  readonly direction: number;
  readonly sizePx: number | null;
  readonly mode: 'pixel' | '3d';
}

/**
 * The live text summary of the viewport (REQ-UX-039), for example
 * "Knight: 8 parts, walk, frame 3 of 8, direction 2 of 8, 64 px, Pixel view".
 */
export function buildViewportSummary(input: ViewportSummaryInput): string {
  const parts = [
    `${input.partCount} ${input.partCount === 1 ? 'part' : 'parts'}`,
    clipName(input.clip),
  ];
  if (input.frame !== null && input.frameCount !== null) {
    parts.push(`frame ${input.frame} of ${input.frameCount}`);
  }
  parts.push(`direction ${input.direction + 1} of ${DIRECTION_ORDER.length}`);
  if (input.sizePx !== null) parts.push(`${input.sizePx} px`);
  parts.push(input.mode === 'pixel' ? 'Pixel view' : '3D view');
  return `${input.label}: ${parts.join(', ')}`;
}

/**
 * The 1-based frame of a clip at `timeSec` when it is shown as `frameCount` stepped export
 * frames (REQ-ANM-018), or `null` without a duration.
 */
export function frameAt(
  timeSec: number,
  durationSec: number,
  frameCount: number,
): number | null {
  if (!(durationSec > 0) || frameCount < 1) return null;
  const t = ((timeSec % durationSec) + durationSec) % durationSec;
  return Math.min(frameCount, Math.floor((t / durationSec) * frameCount) + 1);
}
