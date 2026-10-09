/**
 * Vitest browser commands (run in Node) of the thumbnail renderer (spec 011 REQ-AST-015,
 * REQ-AST-039). The browser reads the plan written by `tools/thumbnails.ts` and hands back each
 * encoded WebP plus its RGBA source as PNG. Everything is written below
 * `test-results/thumbnails/`; `tools/thumbnails.ts` verifies the files and installs them into
 * `assets/packs`. Registered by `vitest.thumbnails.config.ts` only.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import type {BrowserCommand} from 'vitest/node';
import {encodePng} from '../png.ts';

/** Folder of the plan and the outputs, relative to the repo root (vitest cwd). */
export const THUMBNAIL_WORK_DIR = 'test-results/thumbnails';

const PACK_ID = /^[a-z0-9-]{1,64}$/;
const THUMB_PATH =
  /^thumbnails\/([a-z0-9-]{1,64}\/){0,2}[a-z0-9-]{1,64}\.webp$/;

/** Validates the pack ID and pack-relative path of an output (no traversal). */
export function assertThumbnailTarget(packId: string, path: string): void {
  if (!PACK_ID.test(packId)) throw new Error(`bad pack id ${packId}`);
  if (!THUMB_PATH.test(path)) throw new Error(`bad thumbnail path ${path}`);
}

const root = () => resolve(process.cwd(), THUMBNAIL_WORK_DIR);

/** Payload of `csgThumbnailOutput`. */
export interface ThumbnailOutputPayload {
  packId: string;
  path: string;
  /** Encoded WebP, base64. */
  webpBase64: string;
  /** The exact RGBA the WebP encodes (upscaled, transparent pixels zeroed), base64. */
  rgbaBase64: string;
  width: number;
  height: number;
}

const csgThumbnailJobs: BrowserCommand<[]> = () =>
  JSON.parse(readFileSync(join(root(), 'jobs.json'), 'utf8')) as unknown;

const csgThumbnailOutput: BrowserCommand<[ThumbnailOutputPayload]> = (
  _ctx,
  p,
) => {
  assertThumbnailTarget(p.packId, p.path);
  const webp = join(root(), 'out', p.packId, p.path);
  const png = join(root(), 'rgba', p.packId, `${p.path}.png`);
  mkdirSync(dirname(webp), {recursive: true});
  mkdirSync(dirname(png), {recursive: true});
  writeFileSync(webp, Buffer.from(p.webpBase64, 'base64'));
  writeFileSync(
    png,
    encodePng(
      new Uint8Array(Buffer.from(p.rgbaBase64, 'base64')),
      p.width,
      p.height,
    ),
  );
};

const csgThumbnailReport: BrowserCommand<[unknown]> = (_ctx, json) => {
  mkdirSync(root(), {recursive: true});
  writeFileSync(
    join(root(), 'render-report.json'),
    `${JSON.stringify(json, null, 2)}\n`,
  );
};

/** Commands to register under `test.browser.commands`. */
export const thumbnailCommands = {
  csgThumbnailJobs,
  csgThumbnailOutput,
  csgThumbnailReport,
};
