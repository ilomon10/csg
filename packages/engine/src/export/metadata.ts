/** Aseprite JSON and manifest builders (REQ-EXP-010, 011). Pure; fixed key order. */
import {frameName, tagName} from './naming';
import type {SpriteExportManifest} from './types';

/** JSON text: UTF-8, 2-space indentation, LF, trailing newline (REQ-EXP-018). */
export function toJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** A frame placed on one sheet, in sheet-local order. */
export interface SheetFrame {
  readonly label: string;
  readonly direction: string;
  readonly frame: number;
  readonly durationMs: number;
  /** Rect at the sheet's own scale. */
  readonly rect: {x: number; y: number; w: number; h: number};
}

/** One tag range (REQ-EXP-010). */
export interface SheetTag {
  readonly label: string;
  readonly direction: string;
  readonly from: number;
  readonly to: number;
  readonly playback: 'forward' | 'pingpong';
}

/** Inputs of one Aseprite JSON document. */
export interface AsepriteInput {
  readonly frames: readonly SheetFrame[];
  readonly tags: readonly SheetTag[];
  readonly image: string;
  readonly size: {readonly width: number; readonly height: number};
  readonly scale: number;
  readonly cell: {readonly width: number; readonly height: number};
  readonly appVersion: string;
}

/**
 * Builds the array-form Aseprite JSON of one sheet (`frames` array, `frameTags`).
 *
 * @param input Frames in tag-contiguous order, tags indexing into them.
 * @returns The JSON text.
 */
export function buildAsepriteJson(input: AsepriteInput): string {
  const cw = input.cell.width * input.scale;
  const ch = input.cell.height * input.scale;
  return toJsonText({
    frames: input.frames.map(f => ({
      filename: frameName(f.label, f.direction, f.frame),
      frame: {x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h},
      rotated: false,
      trimmed: false,
      spriteSourceSize: {x: 0, y: 0, w: cw, h: ch},
      sourceSize: {w: cw, h: ch},
      duration: Math.round(f.durationMs),
    })),
    meta: {
      app: 'Character Sprite Generator',
      version: input.appVersion,
      image: input.image,
      format: 'RGBA8888',
      size: {w: input.size.width, h: input.size.height},
      scale: String(input.scale),
      frameTags: input.tags.map(t => ({
        name: tagName(t.label, t.direction),
        from: t.from,
        to: t.to,
        direction: t.playback,
      })),
      layers: [],
      slices: [],
    },
  });
}

/**
 * Builds the manifest text (REQ-EXP-011). The object is built in the contract's key order.
 *
 * @param manifest The manifest.
 * @returns The JSON text.
 */
export function buildManifestJson(manifest: SpriteExportManifest): string {
  return toJsonText(manifest);
}
