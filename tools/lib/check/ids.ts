/**
 * ID stability (spec 011 REQ-AST-019). Pure.
 */
import {safeName} from '../rig-verify.js';
import type {CheckIssue} from './types.js';

/** Retired ids of one pack. */
export interface RetiredIds {
  parts: ReadonlySet<string>;
  clips: ReadonlySet<string>;
}

/**
 * Parses `retired-ids.json`, the format `emitPack` writes:
 * `{format: 'sprite-retired-ids', version: 1, ids: string[]}`. The ids apply to parts and
 * clips alike (one id namespace per pack).
 *
 * @returns the retired ids, or an error message.
 */
export function parseRetiredIds(
  json: unknown,
): {ok: true; value: RetiredIds} | {ok: false; message: string} {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return {
      ok: false,
      message:
        'must be {"format":"sprite-retired-ids","version":1,"ids":[...]}',
    };
  }
  const rec = json as Record<string, unknown>;
  if (rec['format'] !== 'sprite-retired-ids' || rec['version'] !== 1) {
    return {
      ok: false,
      message: 'format must be "sprite-retired-ids" with version 1',
    };
  }
  const ids = rec['ids'];
  if (!Array.isArray(ids) || !ids.every(x => typeof x === 'string')) {
    return {ok: false, message: '"ids" must be an array of strings'};
  }
  return {
    ok: true,
    value: {parts: new Set(ids as string[]), clips: new Set(ids as string[])},
  };
}

/** Input of {@link checkIds}. */
export interface IdCheckInput {
  packId: string;
  kind: 'part' | 'clip';
  /** Ids in `pack.config.json`. */
  configIds: readonly string[];
  /** Ids in the built manifest on disk. */
  manifestIds: readonly string[];
  /** Ids of the last committed manifest (git baseline), when known. */
  previousIds: readonly string[];
  retired: ReadonlySet<string>;
}

/**
 * An id that left the config must be retired (`AST_ID_REMOVED`, AC-AST-019.1);
 * a retired id must not be in the config or manifest (`AST_ID_REUSED`,
 * AC-AST-019.2).
 */
export function checkIds(input: IdCheckInput): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const config = new Set(input.configIds);
  const label = input.kind === 'part' ? 'part' : 'clip';
  for (const id of [...config].sort()) {
    if (input.retired.has(id)) {
      issues.push({
        severity: 'error',
        code: 'AST_ID_REUSED',
        packId: input.packId,
        id,
        message: `${label} id ${safeName(id)} is listed in retired-ids.json and must never be reused.`,
      });
    }
  }
  const known = new Set([...input.manifestIds, ...input.previousIds]);
  for (const id of [...known].sort()) {
    if (config.has(id) || input.retired.has(id)) continue;
    issues.push({
      severity: 'error',
      code: 'AST_ID_REMOVED',
      packId: input.packId,
      id,
      message: `${label} id ${safeName(id)} was removed from pack.config.json but is not listed in assets/packs/${input.packId}/retired-ids.json.`,
    });
  }
  return issues;
}
