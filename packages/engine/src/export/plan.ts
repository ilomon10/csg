/** Export planning with full settings validation (REQ-EXP-025). Main thread only: uses Zod. */
import {parseExportSettings} from '@csg/parts-schema';
import type {ExportSettings, RenderSettings} from '@csg/parts-schema';
import type {EngineError, Result} from '../contracts';
import {exportFailure} from './errors';
import type {LayoutGroup} from './layout';
import {exportDirectionLabels} from './naming';
import {emittedFrameCount, planFromGroups} from './plan-core';
import type {ExportPlan} from './plan-core';
import {unsupportedSetting} from './settings-check';

/** Validates settings; returns them parsed or the `EXP_INVALID_SETTINGS` failure. */
export function validateExportSettings(
  exp: unknown,
): Result<ExportSettings, EngineError> {
  const parsed = parseExportSettings(exp);
  if (!parsed.ok) {
    return exportFailure(
      'EXP_INVALID_SETTINGS',
      `Invalid export settings: ${parsed.issues.map(i => `${i.path}: ${i.message}`).join('; ')}`,
      {issues: parsed.issues},
    );
  }
  const un = unsupportedSetting(parsed.value);
  if (un !== null) {
    return exportFailure('EXP_INVALID_SETTINGS', `${un} is not supported yet`);
  }
  return parsed;
}

/**
 * Checks settings and limits before rendering (REQ-EXP-025, AC-EXP-025.1/.2). The layout is
 * derived from `render.animations` and `render.directions`; `frameCount` is the planned frame
 * total (`PreparedFrames.jobs.length`).
 *
 * @param render Render settings of the export.
 * @param exp Export settings.
 * @param frameCount Planned number of frames.
 * @returns The plan, `EXP_INVALID_SETTINGS`, `EXP_DUPLICATE_TAG` or `EXP_TOO_LARGE`.
 */
export function planExport(
  render: RenderSettings,
  exp: ExportSettings,
  frameCount: number,
): Result<ExportPlan, EngineError> {
  const settings = validateExportSettings(exp);
  if (!settings.ok) return settings;
  const labels = exportDirectionLabels(render.directions, render.singleFacing);
  if (labels === null) {
    return exportFailure(
      'EXP_INVALID_SETTINGS',
      'directions must be 1, 2, 4 or 8',
    );
  }
  const seen = new Set<string>();
  for (const a of render.animations) {
    if (seen.has(a.label)) {
      return exportFailure(
        'EXP_DUPLICATE_TAG',
        `Duplicate animation label "${a.label}"`,
        {
          label: a.label,
        },
      );
    }
    seen.add(a.label);
  }
  const groups: LayoutGroup[] = [];
  render.animations.forEach((a, clip) => {
    labels.forEach((_, direction) => {
      groups.push({clip, direction, count: emittedFrameCount(a)});
    });
  });
  return planFromGroups(
    groups,
    settings.value,
    render.resolution.width,
    render.resolution.height,
    frameCount,
  );
}
