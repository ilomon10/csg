/** Export planning and limits (REQ-EXP-025). Pure and Zod-free: the export worker imports it. */
import type {ExportSettings} from '@csg/parts-schema';
import type {EngineError, Result} from '../contracts';
import {exportFailure} from './errors';
import {layoutSheets, sheetSize} from './layout';
import type {LayoutGroup, SheetGrid, SheetMetrics} from './layout';
import {EXPORT_LIMITS} from './types';
import type {ExportWarning} from './types';

/** One planned sheet at one scale. */
export interface PlannedSheet {
  /** Animation index for strip sheets, else `null`. */
  readonly clip: number | null;
  readonly width: number;
  readonly height: number;
}

/** What an export will produce, known before rendering. */
export interface ExportPlan {
  readonly cell: {readonly width: number; readonly height: number};
  readonly frameCount: number;
  /** Per selected scale; empty `sheets` for `frames-zip`. */
  readonly scales: ReadonlyArray<{
    readonly scale: number;
    readonly sheets: PlannedSheet[];
  }>;
  /** Uncompressed RGBA bytes over every image file. */
  readonly totalBytes: number;
  /** `EXP_LARGE_TEXTURE` when a sheet exceeds 4096 px. */
  readonly warnings: ExportWarning[];
}

/** Frames a selection emits after ping-pong baking (spec 004 REQ-ANM-010). */
export function emittedFrameCount(a: {
  frameCount: number;
  pingPong?: boolean | undefined;
  bakePingPong?: boolean | undefined;
}): number {
  return a.pingPong === true && a.bakePingPong === true
    ? a.frameCount + Math.max(0, a.frameCount - 2)
    : a.frameCount;
}

/** Result of measuring groups against the settings. */
interface Measured {
  readonly grids: SheetGrid[];
  readonly metrics: SheetMetrics;
}

/** The sheet metrics of a settings object and cell size. */
export function sheetMetrics(
  exp: ExportSettings,
  cellW: number,
  cellH: number,
): SheetMetrics {
  return {
    cellW,
    cellH,
    paddingPx: exp.paddingPx,
    marginPx: exp.marginPx,
    powerOfTwo: exp.powerOfTwo,
  };
}

/** Lays groups out for the sheet layouts; `frames-zip` has no sheets. */
export function measureGroups(
  groups: readonly LayoutGroup[],
  exp: ExportSettings,
  cellW: number,
  cellH: number,
): Measured {
  const grids =
    exp.layout === 'frames-zip'
      ? []
      : layoutSheets(groups, {
          layout: exp.layout,
          rowOrder: exp.rowOrder,
          maxColumns: exp.maxColumns,
        });
  return {grids, metrics: sheetMetrics(exp, cellW, cellH)};
}

/**
 * Applies the REQ-EXP-025 limits to a layout. Shared by {@link planExport} and the exporter, so
 * both refuse the same inputs.
 *
 * @returns The plan, or `EXP_TOO_LARGE`.
 */
export function planFromGroups(
  groups: readonly LayoutGroup[],
  exp: ExportSettings,
  cellW: number,
  cellH: number,
  frameCount: number,
): Result<ExportPlan, EngineError> {
  const {grids, metrics} = measureGroups(groups, exp, cellW, cellH);
  const tooLarge = (what: string, limit: number, value: number) =>
    exportFailure(
      'EXP_TOO_LARGE',
      `Export too large: ${what} is ${value}, the limit is ${limit}. Try fewer scales, a smaller maxColumns, strip-per-animation or fewer directions.`,
      {limit: what, max: limit, value},
    );
  if (frameCount > EXPORT_LIMITS.maxFrames) {
    return tooLarge('frame count', EXPORT_LIMITS.maxFrames, frameCount);
  }
  let totalBytes = 0;
  let largest = 0;
  const scales = [];
  for (const scale of exp.scales) {
    const sheets: PlannedSheet[] = [];
    for (const grid of grids) {
      const {width, height} = sheetSize(metrics, grid, scale);
      if (
        width > EXPORT_LIMITS.maxSheetPx ||
        height > EXPORT_LIMITS.maxSheetPx
      ) {
        return tooLarge(
          'sheet size in px',
          EXPORT_LIMITS.maxSheetPx,
          Math.max(width, height),
        );
      }
      largest = Math.max(largest, width, height);
      totalBytes += width * height * 4;
      sheets.push({clip: grid.clip, width, height});
    }
    if (exp.layout === 'frames-zip') {
      totalBytes += frameCount * cellW * scale * cellH * scale * 4;
    }
    scales.push({scale, sheets});
  }
  if (totalBytes > EXPORT_LIMITS.maxBytes) {
    return tooLarge(
      'uncompressed RGBA bytes',
      EXPORT_LIMITS.maxBytes,
      totalBytes,
    );
  }
  const warnings: ExportWarning[] =
    largest > EXPORT_LIMITS.largeTexturePx
      ? [
          {
            code: 'EXP_LARGE_TEXTURE',
            message: `A sheet is ${largest} px wide or tall; some mobile GPUs and engines cap textures at ${EXPORT_LIMITS.largeTexturePx} px.`,
          },
        ]
      : [];
  return {
    ok: true,
    value: {
      cell: {width: cellW, height: cellH},
      frameCount,
      scales,
      totalBytes,
      warnings,
    },
  };
}
