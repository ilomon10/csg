/**
 * Shared types of `assets:check` (spec 011 REQ-AST-020). Pure data: no I/O.
 */

/** One finding of the check. Errors fail the command; warnings and infos do not. */
export interface CheckIssue {
  severity: 'error' | 'warn' | 'info';
  /** Stable `AST_*` code (spec 011 error list). */
  code: string;
  /** Pack the finding belongs to, when it has one. */
  packId?: string;
  /** Part or clip id the finding belongs to, when it has one. */
  id?: string;
  message: string;
}

/** Result of a whole `assets:check` run. */
export interface CheckReport {
  /** Pack ids that were checked, sorted. */
  packs: string[];
  issues: CheckIssue[];
  /** Total bytes of built `.glb` files across packs (informational, AC-AST-016.2). */
  totalGlbBytes: number;
}

/** Counts issues by severity. */
export function countIssues(issues: readonly CheckIssue[]): {
  errors: number;
  warnings: number;
  infos: number;
} {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const i of issues) {
    if (i.severity === 'error') errors++;
    else if (i.severity === 'warn') warnings++;
    else infos++;
  }
  return {errors, warnings, infos};
}
