/**
 * `AST_SOLE_OFFSET_STALE` (spec 011 REQ-AST-032): recomputes `soleOffsetM` of every skeleton
 * group from the built packs and compares it with the committed rig JSON.
 */
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseJson, rigDefinitionSchema} from '@csg/parts-schema';
import {
  computeSoleOffsets,
  formatMetres,
  soleDiffers,
  SoleRangeError,
} from '../build/sole.js';
import {readBuiltSoleSources} from '../build/sole-io.js';
import type {CheckIssue} from './types.js';

/** Checks the stored sole offsets of the rigs in `rigIds` against the built packs in `packsDir`. */
export async function checkSoleOffsets(args: {
  packsDir: string;
  rigsDir: string;
  rigIds: Iterable<string>;
}): Promise<CheckIssue[]> {
  const issues: CheckIssue[] = [];
  for (const rigId of [...new Set(args.rigIds)].sort()) {
    const file = join(args.rigsDir, `${rigId}.json`);
    if (!existsSync(file)) continue; // AST_RIG_MISSING is reported by the pack check.
    const json = parseJson(await readFile(file, 'utf8'));
    const rig = json.ok ? rigDefinitionSchema.safeParse(json.value) : null;
    if (rig === null || !rig.success) continue; // AST_RIG_INVALID is reported elsewhere.
    const sources = await readBuiltSoleSources(args.packsDir, rigId, new Set());
    let offsets: Map<string, number>;
    try {
      offsets = (await computeSoleOffsets(rig.data, sources)).offsets;
    } catch (e) {
      if (!(e instanceof SoleRangeError)) throw e;
      issues.push({
        severity: 'error',
        code: 'AST_SOLE_OFFSET_RANGE',
        message: `rig ${rigId}: ${e.message}`,
      });
      continue;
    }
    for (const group of rig.data.skeletonGroups) {
      const stored = group.soleOffsetM;
      const computed = offsets.get(group.id);
      if (!soleDiffers(stored, computed)) continue;
      issues.push({
        severity: 'error',
        code: 'AST_SOLE_OFFSET_STALE',
        message: `rig ${rigId}, group ${group.id}: stored soleOffsetM ${stored === undefined ? 'none' : formatMetres(stored)} but the built packs give ${computed === undefined ? 'none' : formatMetres(computed)}. Run pnpm assets:build; do not edit the rig JSON by hand.`,
      });
    }
  }
  return issues;
}
