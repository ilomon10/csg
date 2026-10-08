import {describe, expect, it} from 'vitest';
import {
  buildTrace,
  checkSpecs,
  collectDefinedIds,
  parseRegistry,
  removedIds,
  renderTrace,
} from './spec-ids';

const REGISTRY = new Set(['GEN', 'PIX']);

const GOOD = `
**REQ-PIX-001 [P1]** THE SYSTEM SHALL render.

- **AC-PIX-001.1** Given a, When b, Then c.
- **AC-PIX-001.2** Given a, When b, Then d.
`;

const check = (content: string) =>
  checkSpecs([{name: 'specs/003-x.md', content}], REGISTRY);

describe('parseRegistry', () => {
  it('GEN smoke: reads prefixes from the registry table only', () => {
    const md = [
      '| Term | Def |',
      '| ZZZ | not a prefix |',
      '## Area-prefix registry',
      '| Prefix | Area |',
      '|---|---|',
      '| GEN | General |',
      '| PIX | Pixel |',
      '## Glossary',
      '| ABC | nope |',
    ].join('\n');
    expect([...parseRegistry(md)]).toEqual(['GEN', 'PIX']);
  });
});

describe('checkSpecs', () => {
  it('GEN smoke: accepts a well-formed spec', () => {
    const r = check(GOOD);
    expect(r.errors).toEqual([]);
    expect(r.reqs.size).toBe(1);
    expect(r.acs.size).toBe(2);
  });

  it('GEN smoke: rejects unregistered prefixes', () => {
    const r = check('**REQ-ZZZ-001 [P1]** x\n- **AC-ZZZ-001.1** y');
    expect(r.errors.some(e => e.includes('not in the registry'))).toBe(true);
  });

  it('GEN smoke: rejects malformed IDs', () => {
    const r = check('**REQ-PIX-01 [P1]** x');
    expect(r.errors.some(e => e.includes('malformed'))).toBe(true);
  });

  it('GEN smoke: rejects duplicate REQ IDs', () => {
    const r = check(`${GOOD}\n**REQ-PIX-001 [P2]** again`);
    expect(r.errors.some(e => e.includes('duplicate REQ-PIX-001'))).toBe(true);
  });

  it('GEN smoke: rejects a REQ without ACs', () => {
    const r = check('**REQ-PIX-002 [P1]** x');
    expect(r.errors.some(e => e.includes('has no acceptance criteria'))).toBe(
      true,
    );
  });

  it('GEN smoke: rejects an AC whose REQ does not exist', () => {
    const r = check(`${GOOD}\n- **AC-PIX-009.1** orphan`);
    expect(
      r.errors.some(e => e.includes('REQ-PIX-009, which is not defined')),
    ).toBe(true);
  });

  it('GEN smoke: ignores deprecated IDs and fenced examples', () => {
    const r = check(
      `${GOOD}\n~~**REQ-PIX-004**~~ (deprecated)\n\`\`\`\n**REQ-XXX-001** example\n\`\`\``,
    );
    expect(r.errors).toEqual([]);
  });
});

describe('trace', () => {
  it('GEN smoke: maps ACs to citing test files and summarizes coverage', () => {
    const spec = check(GOOD);
    const rows = buildTrace(spec, [
      {name: 'a.test.ts', content: "it('AC-PIX-001.1: renders', () => {})"},
    ]);
    expect(rows[0]?.acs[0]?.tests).toEqual(['a.test.ts']);
    expect(rows[0]?.acs[1]?.tests).toEqual([]);
    const md = renderTrace(rows);
    expect(md).toContain('1 (50.0%)');
    expect(md).toContain('| REQ-PIX-001 | AC-PIX-001.2 | **none** |');
  });
});

describe('removedIds', () => {
  const ids = (md: string) =>
    collectDefinedIds([{name: 'specs/003-x.md', content: md}]);

  it('GEN smoke: reports an ID that disappeared', () => {
    const removed = removedIds(ids(GOOD), ids('**REQ-PIX-001 [P1]** x'));
    expect(removed.map(r => r.id)).toEqual(['AC-PIX-001.1', 'AC-PIX-001.2']);
  });

  it('GEN smoke: struck-through IDs count as present', () => {
    const now = [
      '~~**REQ-PIX-001 [P1]**~~ (deprecated)',
      '- ~~AC-PIX-001.1~~ (deprecated)',
      '- **~~AC-PIX-001.2~~**',
    ].join('\n');
    expect(removedIds(ids(GOOD), ids(now))).toEqual([]);
  });

  it('GEN smoke: new IDs and fenced examples are ignored', () => {
    const now = GOOD + '\n```\n**REQ-PIX-009**\n```\n**REQ-PIX-002 [P2]** y';
    expect(removedIds(ids(GOOD), ids(now))).toEqual([]);
    expect(ids(now).has('REQ-PIX-009')).toBe(false);
  });
});
