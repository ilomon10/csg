/**
 * Orphan-file detection (spec 011 AC-AST-020.2). Pure.
 */
import type {CheckIssue} from './types.js';

/** Files that belong to a pack without being referenced by an entry. */
const ALWAYS_ALLOWED = new Set([
  'manifest.json',
  'clips.json',
  'retired-ids.json',
]);

/**
 * Reports every file of a pack directory that no manifest entry references.
 *
 * @param files paths relative to the pack dir, forward slashes.
 * @param referenced paths referenced by manifest entries (`file`, `thumbnail`).
 */
export function findOrphans(
  packId: string,
  files: readonly string[],
  referenced: ReadonlySet<string>,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const file of [...files].sort()) {
    if (ALWAYS_ALLOWED.has(file) || referenced.has(file)) continue;
    if (file.startsWith('presets/') && file.endsWith('.json')) continue;
    issues.push({
      severity: 'error',
      code: 'AST_ORPHAN_FILE',
      packId,
      message: `assets/packs/${packId}/${file} is not referenced by manifest.json or clips.json.`,
    });
  }
  return issues;
}
