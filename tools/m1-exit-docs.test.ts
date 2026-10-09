import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');

describe('M1 exit review records (REQ-AST-007)', () => {
  it('AC-AST-007.1: an ADR records the rig outcome and links assets/reports/rig-report.md; specs 001, 002 and 004 resolved their M1-gated questions', () => {
    const adr = read(
      'docs/adr/0008-shared-rig-skeleton-groups-runtime-retarget.md',
    );
    expect(adr).toContain('Status: Accepted');
    expect(adr).toContain('assets/reports/rig-report.md');
    expect(adr).toMatch(/Outcome:\s*\*\*mapped\*\*/);
    expect(existsSync(join(REPO, 'assets/reports/rig-report.md'))).toBe(true);
    for (const spec of [
      'specs/001-character-composer.md',
      'specs/002-anatomy.md',
      'specs/004-animation.md',
    ]) {
      const text = read(spec);
      // The M1 result is recorded in the spec itself, pointing at the decision.
      expect(text, spec).toMatch(/M1-33/);
      // No open [NEEDS CLARIFICATION] about the shared skeleton or the rig lists remains
      // outside strikethrough.
      const open = text
        .split('\n')
        .filter(
          l => l.includes('NEEDS CLARIFICATION') && l.includes('M1-gated'),
        )
        .filter(l => !l.trimStart().startsWith('- ~~'));
      expect(open, spec).toEqual([]);
    }
  });
});
