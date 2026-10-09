/**
 * Main-thread validation of an export request with the parts-schema Zod schemas. The export
 * worker carries no Zod (REQ-GEN-015), so the host parses and normalizes here and the worker
 * only re-checks the structure of what it receives (REQ-GEN-016). Not imported by the worker.
 */
import {assetLicenseSchema, parseRenderSettings} from '@csg/parts-schema';
import type {EngineError, Result} from '../contracts';
import {exportFailure} from './errors';
import {validateExportSettings} from './plan';
import type {ExportContext} from './types';
import type {ExportSettings} from '@csg/parts-schema';

/** Settings and context after Zod normalization, ready to post to the worker. */
export interface PreparedExportRequest {
  readonly settings: ExportSettings;
  readonly context: ExportContext;
}

/**
 * Parses `settings`, `context.render` and every credit license with the Zod schemas.
 *
 * @param settings Untrusted export settings.
 * @param context The export context; its render settings and licenses are re-parsed.
 * @returns The normalized pair, or `EXP_INVALID_SETTINGS`.
 */
export function prepareExportRequest(
  settings: unknown,
  context: ExportContext,
): Result<PreparedExportRequest, EngineError> {
  const valid = validateExportSettings(settings);
  if (!valid.ok) return valid;
  const render = parseRenderSettings(context.render);
  if (!render.ok) {
    return exportFailure(
      'EXP_INVALID_SETTINGS',
      `Invalid render settings: ${render.issues.map(i => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  const credits: Array<ExportContext['credits'][number]> = [];
  for (const [i, c] of context.credits.entries()) {
    const license = assetLicenseSchema.safeParse(c.license);
    if (!license.success) {
      return exportFailure(
        'EXP_INVALID_SETTINGS',
        `Credit ${i} has an invalid license`,
      );
    }
    credits.push({ref: c.ref, kind: c.kind, license: license.data});
  }
  return {
    ok: true,
    value: {
      settings: valid.value,
      context: {...context, render: render.value, credits},
    },
  };
}
