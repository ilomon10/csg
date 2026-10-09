/**
 * License checks on raw (unvalidated) JSON so the failure names the stable
 * code instead of a generic schema issue (spec 011 REQ-AST-017). Pure.
 */
import {BUNDLED_LICENSE_IDS} from '@csg/parts-schema';
import {safeName} from '../rig-verify.js';
import type {CheckIssue} from './types.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Checks one license record (`license`, `author`, `sourceUrl`).
 *
 * @param owner label used in messages (pack id or part/clip id).
 */
export function checkLicenseRecord(
  record: unknown,
  owner: string,
  packId: string,
  id?: string,
): CheckIssue[] {
  const where = {packId, ...(id === undefined ? {} : {id})};
  const name = safeName(owner);
  if (!isRecord(record)) {
    return [
      {
        severity: 'error',
        code: 'AST_LICENSE_MISSING',
        ...where,
        message: `${name}: license record is missing (needs license, author, sourceUrl).`,
      },
    ];
  }
  const issues: CheckIssue[] = [];
  const license = record['license'];
  if (
    typeof license !== 'string' ||
    !(BUNDLED_LICENSE_IDS as readonly string[]).includes(license)
  ) {
    issues.push({
      severity: 'error',
      code: 'AST_LICENSE_NOT_ALLOWED',
      ...where,
      message: `${name}: license ${typeof license === 'string' ? safeName(license) : 'undefined'} is not allowed for bundled assets (only ${BUNDLED_LICENSE_IDS.join(' or ')}).`,
    });
  }
  for (const field of ['author', 'sourceUrl'] as const) {
    const v = record[field];
    if (typeof v !== 'string' || v.length === 0) {
      issues.push({
        severity: 'error',
        code: 'AST_LICENSE_MISSING',
        ...where,
        message: `${name}: license record lacks ${field}.`,
      });
    }
  }
  return issues;
}

/**
 * Checks the pack license and every part or clip override of a raw manifest
 * or pack config (AC-AST-017.1, AC-AST-017.2).
 */
export function checkLicenses(raw: unknown, packId: string): CheckIssue[] {
  if (!isRecord(raw)) return [];
  const issues = checkLicenseRecord(raw['license'], packId, packId);
  for (const list of ['parts', 'clips'] as const) {
    const entries = raw[list];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry) || entry['license'] === undefined) continue;
      const id = typeof entry['id'] === 'string' ? entry['id'] : '?';
      issues.push(...checkLicenseRecord(entry['license'], id, packId, id));
    }
  }
  return issues;
}
