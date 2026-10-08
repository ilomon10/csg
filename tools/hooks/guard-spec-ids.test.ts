import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {check, removedIds} from './guard-spec-ids.mjs';

describe('guard-spec-ids', () => {
  const before = '**REQ-PIX-001 [P1]** x\n- **AC-PIX-001.1** y\n';

  it('GEN smoke: allows edits that keep every ID', () => {
    expect(removedIds(before, before + '**REQ-PIX-002 [P1]** z')).toEqual([]);
  });

  it('GEN smoke: allows deprecating with strikethrough', () => {
    const after = '~~REQ-PIX-001~~ (deprecated)\n- ~~AC-PIX-001.1~~\n';
    expect(removedIds(before, after)).toEqual([]);
  });

  it('GEN smoke: blocks removing an ID', () => {
    expect(removedIds(before, '**REQ-PIX-001 [P1]** x\n')).toEqual([
      'AC-PIX-001.1',
    ]);
  });

  describe('check', () => {
    // A project dir with a space exercises the file:// URL and path handling.
    const root = mkdtempSync(join(tmpdir(), 'guard spec '));
    mkdirSync(join(root, 'specs'));
    writeFileSync(join(root, 'specs', 'a.md'), before);

    it('GEN smoke: MultiEdit that removes an ID is flagged (path with spaces)', () => {
      expect(
        check({
          cwd: root,
          tool_input: {
            file_path: 'specs/a.md',
            edits: [
              {old_string: 'x\n', new_string: 'x2\n'},
              {old_string: '- **AC-PIX-001.1** y\n', new_string: ''},
            ],
          },
        }),
      ).toEqual(['AC-PIX-001.1']);
    });

    it('GEN smoke: MultiEdit edits apply sequentially', () => {
      // The second edit removes text introduced by the first, so the ID survives.
      expect(
        check({
          cwd: root,
          tool_input: {
            file_path: join(root, 'specs', 'a.md'),
            edits: [
              {old_string: 'y\n', new_string: 'y TMP\n'},
              {old_string: ' TMP', new_string: ''},
            ],
          },
        }),
      ).toEqual([]);
    });
  });
});
