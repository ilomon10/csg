/**
 * Console rendering of an `assets:check` report. Pure.
 */
import {countIssues} from './types.js';
import type {CheckReport} from './types.js';

/** Renders the report as text, one line per finding, deterministic order. */
export function formatCheckReport(report: CheckReport): string {
  const lines: string[] = [];
  if (report.packs.length === 0) {
    lines.push(
      'assets:check: no built packs under assets/packs yet (run pnpm assets:build); nothing to verify.',
    );
  }
  const order = {error: 0, warn: 1, info: 2} as const;
  const sorted = [...report.issues].sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      (a.packId ?? '').localeCompare(b.packId ?? '') ||
      a.code.localeCompare(b.code) ||
      (a.id ?? '').localeCompare(b.id ?? '') ||
      a.message.localeCompare(b.message),
  );
  for (const i of sorted) {
    lines.push(`${i.severity.toUpperCase().padEnd(5)} ${i.code} ${i.message}`);
  }
  const n = countIssues(report.issues);
  lines.push(
    `assets:check: ${report.packs.length} pack(s), ${n.errors} error(s), ${n.warnings} warning(s), ${(report.totalGlbBytes / 1024 / 1024).toFixed(2)} MB of GLB.`,
  );
  return lines.join('\n');
}
