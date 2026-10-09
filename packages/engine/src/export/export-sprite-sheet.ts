/**
 * The sprite sheet exporter (spec 005): pure functions over `RenderedFrame[]`, no three.js and
 * no DOM, so it runs in Node, in tests and in the export worker. Output is deterministic
 * (REQ-EXP-018): no clock, no randomness, sorted files.
 */
import type {ExportSettings} from '@csg/parts-schema';
import type {EngineError, RenderedFrame, Result} from '../contracts';
import {buildCreditsTxt, licenseWarnings} from './credits';
import {ExportError, exportFailure} from './errors';
import {cellOrigin, sheetSize} from './layout';
import type {LayoutGroup, PlacedCell, SheetGrid} from './layout';
import {buildAsepriteJson, buildManifestJson} from './metadata';
import type {SheetFrame, SheetTag} from './metadata';
import {
  exportDirectionLabels,
  frameName,
  isMirroredLabel,
  sanitizeBaseName,
  scaleSuffix,
} from './naming';
import {measureGroups, planFromGroups} from './plan-core';
import {encodePng} from './png';
import {checkExportSettings} from './settings-check';
import type {
  ExportContext,
  ExportFile,
  ExportProgress,
  ExportWarning,
  SpriteExportManifest,
  SpriteSheetExport,
} from './types';
import {writeZip} from './zip';

/** Options of {@link exportSpriteSheet}. */
export interface ExportSpriteSheetOptions {
  /** Abort to stop; the promise rejects with an `EXP_CANCELLED` {@link ExportError}. */
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: ExportProgress) => void;
}

const encoder = new TextEncoder();

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Copies `src` (w x h) into `dst` at (`x0`, `y0`), replicating every pixel into an `s` x `s`
 * block (REQ-EXP-002, 009).
 */
function blit(
  dst: Uint8Array,
  dstW: number,
  x0: number,
  y0: number,
  src: Uint8ClampedArray,
  w: number,
  h: number,
  s: number,
): void {
  if (s === 1) {
    for (let y = 0; y < h; y++) {
      dst.set(
        src.subarray(y * w * 4, (y + 1) * w * 4),
        ((y0 + y) * dstW + x0) * 4,
      );
    }
    return;
  }
  const row = new Uint8Array(w * s * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let k = 0; k < s; k++) {
        const o = (x * s + k) * 4;
        row[o] = src[i] ?? 0;
        row[o + 1] = src[i + 1] ?? 0;
        row[o + 2] = src[i + 2] ?? 0;
        row[o + 3] = src[i + 3] ?? 0;
      }
    }
    for (let r = 0; r < s; r++) {
      dst.set(row, ((y0 + y * s + r) * dstW + x0) * 4);
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new ExportError('EXP_CANCELLED', 'Export cancelled');
  }
}

function isTransparent(pixels: Uint8ClampedArray): boolean {
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) return false;
  return true;
}

/**
 * Builds every file of an export: sheets or per-frame PNGs for each scale, Aseprite JSON,
 * manifest and `CREDITS.txt`, then the ZIP (REQ-EXP-001..006, 009..013, 016..018, 020..022, 025).
 * Frames may arrive in any order; they are sorted clip, direction, frame (REQ-EXP-001).
 *
 * @param frames Rendered frames at 1x; `RenderedFrame.clipId` carries the animation label.
 * @param settings Export settings (validated again here).
 * @param context Render settings, credits, build info.
 * @param options Abort signal and `encode`/`package` progress.
 * @returns The files, warnings and ZIP, or a failed result (`EXP_INVALID_SETTINGS`,
 *   `EXP_FRAME_SIZE_MISMATCH`, `EXP_DUPLICATE_TAG`, `EXP_TOO_LARGE`).
 * @throws ExportError `EXP_CANCELLED` when `options.signal` aborts.
 */
export async function exportSpriteSheet(
  frames: readonly RenderedFrame[],
  settings: ExportSettings,
  context: ExportContext,
  options: ExportSpriteSheetOptions = {},
): Promise<Result<SpriteSheetExport, EngineError>> {
  const {signal, onProgress} = options;
  const valid = checkExportSettings(settings);
  if (!valid.ok) return valid;
  const exp = valid.value;
  const render = context.render;
  const dirLabels = exportDirectionLabels(
    render.directions,
    render.singleFacing,
  );
  if (dirLabels === null) {
    return exportFailure(
      'EXP_INVALID_SETTINGS',
      'directions must be 1, 2, 4 or 8',
    );
  }
  const clipIndex = new Map<string, number>();
  for (const [i, a] of render.animations.entries()) {
    if (clipIndex.has(a.label)) {
      return exportFailure(
        'EXP_DUPLICATE_TAG',
        `Duplicate animation label "${a.label}"`,
        {
          label: a.label,
        },
      );
    }
    clipIndex.set(a.label, i);
  }
  const first = frames[0];
  if (first === undefined) {
    return exportFailure(
      'EXP_INVALID_SETTINGS',
      'There are no frames to export',
    );
  }
  const cellW = first.width;
  const cellH = first.height;
  for (const f of frames) {
    if (f.width !== cellW || f.height !== cellH) {
      return exportFailure(
        'EXP_FRAME_SIZE_MISMATCH',
        `Frame ${f.clipId}/${f.direction}/${f.frame} is ${f.width}x${f.height}, expected ${cellW}x${cellH}`,
      );
    }
    if (
      f.pixels.length !== cellW * cellH * 4 ||
      !clipIndex.has(f.clipId) ||
      !Number.isInteger(f.direction) ||
      f.direction < 0 ||
      f.direction >= dirLabels.length
    ) {
      return exportFailure(
        'EXP_INVALID_SETTINGS',
        `Frame ${f.clipId}/${f.direction}/${f.frame} does not match the render settings`,
      );
    }
  }

  // REQ-EXP-001: clip, then direction, then frame.
  const sorted = frames
    .map(f => ({f, clip: clipIndex.get(f.clipId) ?? 0}))
    .sort(
      (a, b) =>
        a.clip - b.clip ||
        a.f.direction - b.f.direction ||
        a.f.frame - b.f.frame,
    );
  const groups: LayoutGroup[] = [];
  /** Sorted index of the first frame of each group. */
  const groupStart: number[] = [];
  for (const [i, {f, clip}] of sorted.entries()) {
    const last = groups[groups.length - 1];
    if (
      last !== undefined &&
      last.clip === clip &&
      last.direction === f.direction
    ) {
      const prev = sorted[i - 1];
      if (prev !== undefined && prev.f.frame === f.frame) {
        return exportFailure(
          'EXP_DUPLICATE_TAG',
          `Two frames are named ${frameName(f.clipId, dirLabels[f.direction] ?? '', f.frame)}`,
        );
      }
      groups[groups.length - 1] = {...last, count: last.count + 1};
    } else {
      groups.push({clip, direction: f.direction, count: 1});
      groupStart.push(i);
    }
  }

  const plan = planFromGroups(groups, exp, cellW, cellH, sorted.length);
  if (!plan.ok) return plan;
  const {grids, metrics} = measureGroups(groups, exp, cellW, cellH);

  const base = sanitizeBaseName(exp.baseName ?? context.characterName);
  const strip = exp.layout === 'strip-per-animation';
  const frameOf = (g: number, k: number): RenderedFrame => {
    const entry = sorted[(groupStart[g] ?? 0) + k];
    if (entry === undefined)
      throw new Error('export: frame index out of range');
    return entry.f;
  };
  const labelOf = (clip: number): string =>
    render.animations[clip]?.label ?? '';
  const sheetFile = (scale: number, grid: SheetGrid): string =>
    strip
      ? `${base}_${labelOf(grid.clip ?? 0)}${scaleSuffix(scale)}.png`
      : `${base}${scaleSuffix(scale)}.png`;

  const encodeTotal =
    exp.layout === 'frames-zip'
      ? exp.scales.length * sorted.length
      : exp.scales.length * grids.length;
  let encoded = 0;
  const reportEncode = () =>
    onProgress?.({phase: 'encode', done: encoded, total: encodeTotal});
  reportEncode();

  const files: ExportFile[] = [];
  const png = (name: string, bytes: Uint8Array) =>
    files.push({name, mime: 'image/png', bytes});
  const baseScale = exp.scales[0] ?? 1;
  const manifestSheets: SpriteExportManifest['sheets'] = [];
  /** Scale-1 rect and sheet of every sorted frame, for the manifest. */
  const placement = new Map<
    RenderedFrame,
    {sheet: string; rect: {x: number; y: number; w: number; h: number}}
  >();

  for (const scale of exp.scales) {
    if (exp.layout === 'frames-zip') {
      for (const {f} of sorted) {
        throwIfAborted(signal);
        const buf = new Uint8Array(cellW * scale * cellH * scale * 4);
        blit(buf, cellW * scale, 0, 0, f.pixels, cellW, cellH, scale);
        const name = `${base}${scaleSuffix(scale)}/${f.clipId}/${dirLabels[f.direction] ?? ''}/${String(f.frame).padStart(3, '0')}.png`;
        png(name, encodePng(buf, cellW * scale, cellH * scale));
        if (scale === baseScale) {
          placement.set(f, {
            sheet: name,
            rect: {x: 0, y: 0, w: cellW, h: cellH},
          });
        }
        encoded++;
        reportEncode();
        await Promise.resolve();
      }
      continue;
    }
    for (const grid of grids) {
      throwIfAborted(signal);
      const {width, height} = sheetSize(metrics, grid, scale);
      const buf = new Uint8Array(width * height * 4);
      const name = sheetFile(scale, grid);
      const sheetFrames: SheetFrame[] = [];
      const tags: SheetTag[] = [];
      // Frames of the JSON in group order (tag-contiguous), not in layout order.
      const byGroup = new Map<number, PlacedCell[]>();
      for (const cell of grid.cells) {
        const list = byGroup.get(cell.group) ?? [];
        list.push(cell);
        byGroup.set(cell.group, list);
      }
      for (const [g, cells] of [...byGroup.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        const group = groups[g];
        if (group === undefined) continue;
        const anim = render.animations[group.clip];
        const dir = dirLabels[group.direction] ?? '';
        const from = sheetFrames.length;
        for (const cell of cells) {
          const f = frameOf(g, cell.k);
          const o = cellOrigin(metrics, cell.col, cell.row);
          blit(
            buf,
            width,
            o.x * scale,
            o.y * scale,
            f.pixels,
            cellW,
            cellH,
            scale,
          );
          sheetFrames.push({
            label: f.clipId,
            direction: dir,
            frame: f.frame,
            durationMs: f.durationMs,
            rect: {
              x: o.x * scale,
              y: o.y * scale,
              w: cellW * scale,
              h: cellH * scale,
            },
          });
          if (scale === baseScale) {
            placement.set(f, {
              sheet: name,
              rect: {x: o.x, y: o.y, w: cellW, h: cellH},
            });
          }
        }
        tags.push({
          label: anim?.label ?? '',
          direction: dir,
          from,
          to: sheetFrames.length - 1,
          playback:
            anim?.pingPong === true && anim.bakePingPong !== true
              ? 'pingpong'
              : 'forward',
        });
      }
      png(name, encodePng(buf, width, height));
      manifestSheets.push({file: name, scale, width, height});
      if (exp.metadata === 'aseprite-json') {
        files.push({
          name: name.replace(/\.png$/, '.json'),
          mime: 'application/json',
          bytes: encoder.encode(
            buildAsepriteJson({
              frames: sheetFrames,
              tags,
              image: name,
              size: {width, height},
              scale,
              cell: {width: cellW, height: cellH},
              appVersion: context.build.appVersion,
            }),
          ),
        });
      }
      encoded++;
      reportEncode();
      await Promise.resolve();
    }
  }

  // Warnings: licences, then size, then empty frames (fixed order).
  const warnings: ExportWarning[] = [
    ...licenseWarnings(context.credits),
    ...plan.value.warnings,
  ];
  if (sorted.every(({f}) => isTransparent(f.pixels))) {
    warnings.push({
      code: 'EXP_EMPTY_FRAMES',
      message: 'Every frame is fully transparent.',
    });
  }

  throwIfAborted(signal);
  onProgress?.({phase: 'package', done: 0, total: 1});
  if (exp.metadata !== 'none') {
    const clips: SpriteExportManifest['clips'] = [];
    for (const [i, a] of render.animations.entries()) {
      const g = groups.findIndex(x => x.clip === i);
      const count = g < 0 ? 0 : (groups[g]?.count ?? 0);
      if (count === 0) continue;
      clips.push({
        label: a.label,
        clipId: a.clipId,
        fps: a.fps,
        frameCount: count,
        loop: a.loop,
        direction:
          a.pingPong === true && a.bakePingPong !== true
            ? 'pingpong'
            : 'forward',
      });
    }
    const manifest: SpriteExportManifest = {
      format: 'sprite-export-manifest',
      version: 1,
      source: {
        projectSha256: context.projectSha256,
        appVersion: context.build.appVersion,
        threeVersion: context.build.threeVersion,
        backend: context.build.backend,
      },
      cell: {width: cellW, height: cellH},
      pivotPx: [context.pivotPx[0], context.pivotPx[1]],
      directions: [...dirLabels],
      scales: [...exp.scales],
      sheets: manifestSheets,
      clips,
      frames: sorted.map(({f}) => {
        const dir = dirLabels[f.direction] ?? '';
        const at = placement.get(f);
        return {
          name: frameName(f.clipId, dir, f.frame),
          label: f.clipId,
          direction: dir,
          frame: f.frame,
          durationMs: Math.round(f.durationMs),
          mirrored: isMirroredLabel(dir, render.mirrorWest),
          sheet: at?.sheet ?? '',
          rect: at?.rect ?? {x: 0, y: 0, w: cellW, h: cellH},
        };
      }),
      warnings,
    };
    files.push({
      name: `${base}.manifest.json`,
      mime: 'application/json',
      bytes: encoder.encode(buildManifestJson(manifest)),
    });
  }
  files.push({
    name: 'CREDITS.txt',
    mime: 'text/plain; charset=utf-8',
    bytes: encoder.encode(
      buildCreditsTxt(context, base, context.build.appVersion, warnings),
    ),
  });
  files.sort((a, b) => compareNames(a.name, b.name));
  const zip = writeZip(files);
  onProgress?.({phase: 'package', done: 1, total: 1});
  throwIfAborted(signal);
  return {ok: true, value: {files, warnings, zipName: `${base}.zip`, zip}};
}
