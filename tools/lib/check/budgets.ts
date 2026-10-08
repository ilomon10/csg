/**
 * Per-file budgets of built outputs (spec 011 REQ-AST-016). Pure.
 */
import type {CheckIssue} from './types.js';

/** Budget limits of REQ-AST-016. */
export const BUDGETS = {
  bodyTriangles: 20_000,
  skinnedTriangles: 10_000,
  staticTriangles: 5_000,
  textures: 4,
  influences: 4,
  /** Default character plus its default clips, transfer size. */
  defaultSetBytes: 15 * 1024 * 1024,
} as const;

/** Measured statistics of one built GLB. */
export interface MeasuredStats {
  triangles: number;
  textures: number;
  /** Largest number of non-zero joint influences on any vertex; 0 for static files. */
  maxInfluences: number;
}

/** Identity of the part being checked. */
export interface BudgetSubject {
  packId: string;
  id: string;
  kind: 'skinned' | 'static';
  slot: string;
}

/** Triangle limit that applies to a part. */
export function triangleLimit(subject: Pick<BudgetSubject, 'kind' | 'slot'>) {
  if (subject.kind === 'static') return BUDGETS.staticTriangles;
  return subject.slot === 'body'
    ? BUDGETS.bodyTriangles
    : BUDGETS.skinnedTriangles;
}

/**
 * Checks triangles, textures and influences of one built part
 * (AC-AST-016.1, AC-AST-027.2).
 */
export function checkPartBudgets(
  subject: BudgetSubject,
  stats: MeasuredStats,
): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const base = {
    severity: 'error',
    packId: subject.packId,
    id: subject.id,
  } as const;
  const limit = triangleLimit(subject);
  if (stats.triangles > limit) {
    issues.push({
      ...base,
      code: 'AST_BUDGET_TRIANGLES',
      message: `${subject.id}: ${stats.triangles} triangles exceed the limit of ${limit} for ${subject.kind === 'static' ? 'static props' : subject.slot === 'body' ? 'bodies' : 'skinned parts'}.`,
    });
  }
  if (stats.textures > BUDGETS.textures) {
    issues.push({
      ...base,
      code: 'AST_BUDGET_TEXTURES',
      message: `${subject.id}: ${stats.textures} textures exceed the limit of ${BUDGETS.textures}.`,
    });
  }
  if (stats.maxInfluences > BUDGETS.influences) {
    issues.push({
      ...base,
      code: 'AST_BUDGET_INFLUENCES',
      message: `${subject.id}: vertices have up to ${stats.maxInfluences} joint influences (limit ${BUDGETS.influences}).`,
    });
  }
  return issues;
}

/** Checks the size of the default character plus its default clips (AC-AST-016.2). */
export function checkDefaultSetSize(
  sizes: ReadonlyMap<string, number>,
  limit: number = BUDGETS.defaultSetBytes,
): CheckIssue[] {
  let total = 0;
  for (const bytes of sizes.values()) total += bytes;
  if (total <= limit) return [];
  return [
    {
      severity: 'error',
      code: 'AST_BUDGET_SIZE',
      message: `Default character and clips total ${total} bytes, over the ${limit} byte budget.`,
    },
  ];
}
