/** Shared fixtures of the exporter tests (Node, no GPU). */
import {defaultExportSettings, parseRenderSettings} from '@csg/parts-schema';
import type {
  AssetLicense,
  ExportSettings,
  RenderSettings,
} from '@csg/parts-schema';
import type {RenderedFrame} from '../contracts';
import type {ExportContext} from './types';

export interface ClipSpec {
  label: string;
  frames: number;
  fps?: number;
  loop?: boolean;
  pingPong?: boolean;
  bakePingPong?: boolean;
}

/** Render settings for `clips` at `size` px with `directions` directions. */
export function renderSettings(
  clips: readonly ClipSpec[],
  directions: 1 | 2 | 4 | 8,
  size = 32,
): RenderSettings {
  const parsed = parseRenderSettings({
    camera: {preset: directions === 2 ? 'side' : 'three-quarter'},
    resolution: {width: size, height: size},
    directions,
    animations: clips.map(c => ({
      clipId: `builtin:test-ual/${c.label.replace(/-\d+$/, '')}`,
      label: c.label,
      frameCount: c.frames,
      fps: c.fps ?? 12,
      loop: c.loop ?? true,
      ...(c.pingPong === undefined ? {} : {pingPong: c.pingPong}),
      ...(c.bakePingPong === undefined ? {} : {bakePingPong: c.bakePingPong}),
    })),
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

/** A deterministic opaque pixel pattern per frame identity. */
export function makeFrame(
  label: string,
  direction: number,
  frame: number,
  w: number,
  h: number,
  fps = 12,
): RenderedFrame {
  const pixels = new Uint8ClampedArray(w * h * 4);
  const seed = label.length * 31 + direction * 7 + frame * 3;
  for (let i = 0; i < w * h; i++) {
    pixels[i * 4] = (seed + i * 5) & 255;
    pixels[i * 4 + 1] = (seed * 3 + i) & 255;
    pixels[i * 4 + 2] = (i * 11) & 255;
    pixels[i * 4 + 3] = 255;
  }
  return {
    clipId: label,
    direction,
    frame,
    sourceFrame: frame,
    timeSec: frame / fps,
    durationMs: 1000 / fps,
    width: w,
    height: h,
    pixels,
  };
}

/** All frames of `clips` in canonical order. */
export function makeFrames(
  clips: readonly ClipSpec[],
  directions: number,
  w: number,
  h: number,
): RenderedFrame[] {
  const out: RenderedFrame[] = [];
  for (const c of clips) {
    const n =
      c.pingPong === true && c.bakePingPong === true
        ? c.frames + Math.max(0, c.frames - 2)
        : c.frames;
    for (let d = 0; d < directions; d++) {
      for (let f = 0; f < n; f++)
        out.push(makeFrame(c.label, d, f, w, h, c.fps));
    }
  }
  return out;
}

export const CC0: AssetLicense = {
  license: 'CC0-1.0',
  author: 'Quaternius',
  title: 'Regular Male',
  sourceUrl: 'https://quaternius.itch.io/universal-base-characters',
  commercialUse: 'yes',
  attributionRequired: false,
};

export const CC_BY: AssetLicense = {
  license: 'CC-BY-4.0',
  author: 'Jane Doe',
  title: 'Leather Hood',
  sourceUrl: 'https://example.org/hood',
  commercialUse: 'yes',
  attributionRequired: true,
};

/** Context with a CC0 body and a CC-BY part. */
export function makeContext(
  render: RenderSettings,
  credits?: ExportContext['credits'],
): ExportContext {
  return {
    render,
    projectSha256: 'a'.repeat(64),
    characterName: 'Sir Knight #2 (blue)',
    credits: credits ?? [
      {ref: 'user:6f1c', kind: 'part', license: CC_BY},
      {
        ref: 'builtin:quaternius-ubc/body-regular-m',
        kind: 'body',
        license: CC0,
      },
    ],
    build: {appVersion: '0.1.0', threeVersion: '0.186.1', backend: 'webgl2'},
    pivotPx: [16, 30],
  };
}

/** Default settings with overrides. */
export function settings(over: Partial<ExportSettings> = {}): ExportSettings {
  return {...defaultExportSettings(), ...over};
}
