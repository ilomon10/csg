/**
 * Messages between the host and the export worker, and their validation (REQ-GEN-016: every
 * `postMessage` payload is untrusted data). No DOM, no network.
 */
import type {AssetLicense} from '@csg/parts-schema';
import type {RenderedFrame} from '../contracts';
import {EXPORT_LIMITS} from './types';
import type {
  ExportAnimation,
  ExportContext,
  ExportProgress,
  ExportRenderInfo,
  ExportWarning,
} from './types';
import {EXPORT_DIRECTION_ORDER} from './naming';

/** Largest cell edge a worker request may carry; the editor caps cells at 128 px. */
export const EXPORT_MAX_CELL_PX = 1024;

/** Request: export these frames. */
export interface ExportWorkerRequest {
  readonly type: 'export';
  readonly id: number;
  readonly frames: RenderedFrame[];
  readonly settings: unknown;
  readonly context: ExportContext;
}

/** Result payload of a finished export (`files` carries sizes only; the bytes are the ZIP). */
export interface ExportWorkerResult {
  readonly zipName: string;
  readonly zip: Uint8Array;
  readonly files: ReadonlyArray<{
    readonly name: string;
    readonly mime: string;
    readonly size: number;
  }>;
  readonly warnings: ExportWarning[];
}

/** Replies of the worker. */
export type ExportWorkerReply =
  | ({readonly type: 'progress'; readonly id: number} & ExportProgress)
  | ({readonly type: 'done'; readonly id: number} & ExportWorkerResult)
  | {
      readonly type: 'error';
      readonly id: number;
      readonly code: string;
      readonly message: string;
    };

type Parsed<T> =
  {ok: true; value: T} | {ok: false; id: number; message: string};

const WARNING_CODES: ReadonlySet<string> = new Set([
  'LICENSE_UNKNOWN',
  'LICENSE_NON_COMMERCIAL',
  'LICENSE_SHARE_ALIKE',
  'EXP_LARGE_TEXTURE',
  'EXP_GIF_TOO_MANY_COLORS',
  'EXP_EMPTY_FRAMES',
  'PIX_FRAMING_CLIPPED',
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function readId(data: unknown): number {
  return isObject(data) && isInt(data.id, 0, Number.MAX_SAFE_INTEGER)
    ? data.id
    : -1;
}

function str(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function optStr(v: unknown, max: number): boolean {
  return v === undefined || str(v, max);
}

function optBool(v: unknown): boolean {
  return v === undefined || typeof v === 'boolean';
}

function readAnimation(a: unknown): ExportAnimation | null {
  if (
    !isObject(a) ||
    !str(a.label, 64) ||
    !str(a.clipId, 200) ||
    !isInt(a.frameCount, 0, 1_000_000) ||
    typeof a.fps !== 'number' ||
    !Number.isFinite(a.fps) ||
    typeof a.loop !== 'boolean' ||
    !optBool(a.pingPong) ||
    !optBool(a.bakePingPong)
  ) {
    return null;
  }
  return {
    label: a.label,
    clipId: a.clipId,
    frameCount: a.frameCount,
    fps: a.fps,
    loop: a.loop,
    ...(a.pingPong === undefined ? {} : {pingPong: a.pingPong as boolean}),
    ...(a.bakePingPong === undefined
      ? {}
      : {bakePingPong: a.bakePingPong as boolean}),
  };
}

function readRender(r: unknown): ExportRenderInfo | null {
  if (!isObject(r)) return null;
  const res = r.resolution;
  if (
    !isObject(res) ||
    !isInt(res.width, 1, EXPORT_MAX_CELL_PX) ||
    !isInt(res.height, 1, EXPORT_MAX_CELL_PX) ||
    !isInt(r.directions, 1, 8) ||
    typeof r.mirrorWest !== 'boolean' ||
    !Array.isArray(r.animations) ||
    r.animations.length > 1024 ||
    (r.singleFacing !== undefined &&
      !(EXPORT_DIRECTION_ORDER as readonly unknown[]).includes(r.singleFacing))
  ) {
    return null;
  }
  const animations: ExportAnimation[] = [];
  for (let i = 0; i < r.animations.length; i++) {
    const a = readAnimation(r.animations[i]);
    if (a === null) return null;
    animations.push(a);
  }
  return {
    resolution: {width: res.width, height: res.height},
    directions: r.directions,
    ...(r.singleFacing === undefined
      ? {}
      : {singleFacing: r.singleFacing as ExportRenderInfo['singleFacing']}),
    mirrorWest: r.mirrorWest,
    animations,
  };
}

function readLicense(l: unknown): AssetLicense | null {
  if (
    !isObject(l) ||
    !str(l.license, 40) ||
    l.license === '' ||
    !str(l.author, 200) ||
    l.author === '' ||
    !(
      l.commercialUse === 'yes' ||
      l.commercialUse === 'no' ||
      l.commercialUse === 'unknown'
    ) ||
    typeof l.attributionRequired !== 'boolean' ||
    !optStr(l.title, 200) ||
    !optStr(l.sourceUrl, 2048) ||
    !optStr(l.notes, 2000)
  ) {
    return null;
  }
  return {
    license: l.license as AssetLicense['license'],
    author: l.author,
    commercialUse: l.commercialUse,
    attributionRequired: l.attributionRequired,
    ...(l.title === undefined ? {} : {title: l.title as string}),
    ...(l.sourceUrl === undefined ? {} : {sourceUrl: l.sourceUrl as string}),
    ...(l.notes === undefined ? {} : {notes: l.notes as string}),
  };
}

/**
 * Validates an export request (untrusted) with hand-written checks only (the worker bundle has no
 * Zod, REQ-GEN-015). Frames are copied field by field; `settings` pass through for
 * `checkExportSettings`; the context is checked here because it carries licences and build
 * strings that end up in files. The host normalizes both with Zod first (`prepareExportRequest`).
 *
 * @param data The message data.
 * @returns The typed request, or a reason with the id when one could be read.
 */
export function readExportRequest(data: unknown): Parsed<ExportWorkerRequest> {
  const id = readId(data);
  const bad = (message: string): Parsed<ExportWorkerRequest> => ({
    ok: false,
    id,
    message,
  });
  if (!isObject(data) || data.type !== 'export' || id < 0) {
    return bad('malformed request');
  }
  const rawFrames = data.frames;
  if (!Array.isArray(rawFrames) || rawFrames.length < 1) {
    return bad('frames must be a non-empty array');
  }
  if (rawFrames.length > EXPORT_LIMITS.maxFrames) {
    return bad(`more than ${EXPORT_LIMITS.maxFrames} frames`);
  }
  const frames: RenderedFrame[] = [];
  let bytes = 0;
  // Index loop: `map` skips holes in sparse arrays.
  for (let i = 0; i < rawFrames.length; i++) {
    const f: unknown = rawFrames[i];
    if (
      !isObject(f) ||
      typeof f.clipId !== 'string' ||
      f.clipId.length > 64 ||
      !isInt(f.direction, 0, 7) ||
      !isInt(f.frame, 0, 1_000_000) ||
      !isInt(f.sourceFrame, 0, 1_000_000) ||
      typeof f.timeSec !== 'number' ||
      !Number.isFinite(f.timeSec) ||
      typeof f.durationMs !== 'number' ||
      !Number.isFinite(f.durationMs) ||
      !isInt(f.width, 1, EXPORT_MAX_CELL_PX) ||
      !isInt(f.height, 1, EXPORT_MAX_CELL_PX) ||
      !(f.pixels instanceof Uint8ClampedArray) ||
      f.pixels.length !== f.width * f.height * 4
    ) {
      return bad(`frame ${i} is malformed`);
    }
    bytes += f.pixels.length;
    if (bytes > EXPORT_LIMITS.maxBytes) return bad('frames are too large');
    frames.push({
      clipId: f.clipId,
      direction: f.direction,
      frame: f.frame,
      sourceFrame: f.sourceFrame,
      timeSec: f.timeSec,
      durationMs: f.durationMs,
      width: f.width,
      height: f.height,
      pixels: f.pixels,
    });
  }
  const ctx = data.context;
  if (!isObject(ctx)) return bad('context must be an object');
  const render = readRender(ctx.render);
  if (render === null) return bad('context.render is invalid');
  if (
    typeof ctx.projectSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(ctx.projectSha256)
  ) {
    return bad('context.projectSha256 must be 64 hex characters');
  }
  if (typeof ctx.characterName !== 'string' || ctx.characterName.length > 200) {
    return bad('context.characterName is invalid');
  }
  const build = ctx.build;
  if (
    !isObject(build) ||
    typeof build.appVersion !== 'string' ||
    build.appVersion.length > 64 ||
    typeof build.threeVersion !== 'string' ||
    build.threeVersion.length > 64 ||
    (build.backend !== 'webgpu' && build.backend !== 'webgl2')
  ) {
    return bad('context.build is invalid');
  }
  const pivot = ctx.pivotPx;
  if (
    !Array.isArray(pivot) ||
    pivot.length !== 2 ||
    typeof pivot[0] !== 'number' ||
    typeof pivot[1] !== 'number' ||
    !Number.isFinite(pivot[0]) ||
    !Number.isFinite(pivot[1])
  ) {
    return bad('context.pivotPx is invalid');
  }
  const rawCredits = ctx.credits;
  if (!Array.isArray(rawCredits) || rawCredits.length > 4096) {
    return bad('context.credits is invalid');
  }
  const credits: Array<ExportContext['credits'][number]> = [];
  for (let i = 0; i < rawCredits.length; i++) {
    const c: unknown = rawCredits[i];
    const license = isObject(c) ? readLicense(c.license) : null;
    if (
      !isObject(c) ||
      typeof c.ref !== 'string' ||
      c.ref.length > 200 ||
      !['body', 'part', 'clip', 'decal', 'palette'].includes(String(c.kind)) ||
      license === null
    ) {
      return bad(`credit ${i} is malformed`);
    }
    credits.push({
      ref: c.ref,
      kind: c.kind as ExportContext['credits'][number]['kind'],
      license,
    });
  }
  return {
    ok: true,
    value: {
      type: 'export',
      id,
      frames,
      settings: data.settings,
      context: {
        render,
        projectSha256: ctx.projectSha256,
        characterName: ctx.characterName,
        credits,
        build: {
          appVersion: build.appVersion,
          threeVersion: build.threeVersion,
          backend: build.backend,
        },
        pivotPx: [pivot[0], pivot[1]],
      },
    },
  };
}

function readWarnings(v: unknown): ExportWarning[] | null {
  if (!Array.isArray(v) || v.length > 64) return null;
  const out: ExportWarning[] = [];
  for (let i = 0; i < v.length; i++) {
    const w: unknown = v[i];
    if (
      !isObject(w) ||
      typeof w.code !== 'string' ||
      !WARNING_CODES.has(w.code)
    ) {
      return null;
    }
    const assets = w.assets;
    if (
      assets !== undefined &&
      (!Array.isArray(assets) ||
        assets.length > 4096 ||
        assets.some(a => typeof a !== 'string'))
    ) {
      return null;
    }
    if (w.message !== undefined && typeof w.message !== 'string') return null;
    out.push({
      code: w.code as ExportWarning['code'],
      ...(assets === undefined ? {} : {assets: assets as string[]}),
      ...(w.message === undefined ? {} : {message: w.message}),
    });
  }
  return out;
}

/**
 * Validates a worker reply (untrusted). Returns `null` for anything that is not a well-formed
 * `progress`, `done` or `error` message with an integer `id`.
 *
 * @param data The message data.
 * @returns The typed reply or `null`.
 */
export function readExportReply(data: unknown): ExportWorkerReply | null {
  if (!isObject(data) || !isInt(data.id, 0, Number.MAX_SAFE_INTEGER))
    return null;
  const id = data.id;
  if (data.type === 'progress') {
    const phase = data.phase;
    if (
      (phase !== 'render' && phase !== 'encode' && phase !== 'package') ||
      !isInt(data.done, 0, Number.MAX_SAFE_INTEGER) ||
      !isInt(data.total, 0, Number.MAX_SAFE_INTEGER)
    ) {
      return null;
    }
    return {type: 'progress', id, phase, done: data.done, total: data.total};
  }
  if (data.type === 'error') {
    return {
      type: 'error',
      id,
      code:
        typeof data.code === 'string'
          ? data.code.slice(0, 40)
          : 'EXP_WORKER_FAILED',
      message:
        typeof data.message === 'string'
          ? data.message.slice(0, 300)
          : 'export worker: error',
    };
  }
  if (data.type === 'done') {
    const warnings = readWarnings(data.warnings);
    const rawFiles = data.files;
    if (
      typeof data.zipName !== 'string' ||
      data.zipName.length > 80 ||
      !(data.zip instanceof Uint8Array) ||
      warnings === null ||
      !Array.isArray(rawFiles) ||
      rawFiles.length > 100_000
    ) {
      return null;
    }
    const files: Array<{name: string; mime: string; size: number}> = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const f: unknown = rawFiles[i];
      if (
        !isObject(f) ||
        typeof f.name !== 'string' ||
        typeof f.mime !== 'string' ||
        !isInt(f.size, 0, Number.MAX_SAFE_INTEGER)
      ) {
        return null;
      }
      files.push({name: f.name, mime: f.mime, size: f.size});
    }
    return {
      type: 'done',
      id,
      zipName: data.zipName,
      zip: data.zip,
      files,
      warnings,
    };
  }
  return null;
}
