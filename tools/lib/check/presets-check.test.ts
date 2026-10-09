import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {SLOT_REGISTRY} from '@csg/parts-schema';
import type {PartEntry} from '@csg/parts-schema';
import {writeTestPack} from './check-fixtures.js';
import {checkPresetReferences} from './presets.js';
import type {PackPresets} from './presets.js';
import {runAssetCheck} from './run.js';
import type {CheckIssue} from './types.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const shipped = (rel: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(REPO, 'tools/packs/quaternius-ubc/presets', rel), 'utf8'),
  ) as Record<string, unknown>;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'presets-check-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

function write(file: string, json: unknown): void {
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

/** A built fixture pack `p1` with an authored and a built copy of `anatomy/x.json`. */
async function builtPackWithPreset() {
  const {repo} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
  const x = {...shipped('anatomy/realistic.json'), id: 'x'};
  write(join(repo.configsDir, 'p1/presets/anatomy/x.json'), x);
  const built = join(repo.packsDir, 'p1/presets');
  write(join(built, 'anatomy/x.json'), x);
  write(join(built, 'index.json'), {
    format: 'sprite-preset-index',
    version: 1,
    files: [{kind: 'anatomy-preset', path: 'presets/anatomy/x.json'}],
  });
  return {repo, built, x};
}

const codes = (issues: readonly CheckIssue[], code: string) =>
  issues.filter(i => i.code === code);

describe('built preset checks (REQ-AST-037)', () => {
  it('AC-AST-037.1: an index entry whose kind does not match its folder fails with AST_PRESET_INVALID naming the path and the kind', async () => {
    const {repo, built} = await builtPackWithPreset();
    write(join(built, 'index.json'), {
      format: 'sprite-preset-index',
      version: 1,
      files: [{kind: 'look', path: 'presets/anatomy/x.json'}],
    });
    const report = await runAssetCheck(repo);
    const [issue] = codes(report.issues, 'AST_PRESET_INVALID');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('presets/anatomy/x.json');
    expect(issue?.message).toContain('look');
  });

  it('AC-AST-037.2: a hand-edited built preset fails with AST_MANIFEST_STALE and the fix; the unedited pack reports no AST_ORPHAN_FILE under presets/', async () => {
    const {repo, built, x} = await builtPackWithPreset();
    const clean = await runAssetCheck(repo);
    expect(codes(clean.issues, 'AST_MANIFEST_STALE')).toEqual([]);
    expect(codes(clean.issues, 'AST_ORPHAN_FILE')).toEqual([]);
    write(join(built, 'anatomy/x.json'), {...x, label: 'Edited by hand'});
    const edited = await runAssetCheck(repo);
    const [stale] = codes(edited.issues, 'AST_MANIFEST_STALE');
    expect(stale?.packId).toBe('p1');
    expect(stale?.message).toContain('tools/packs/p1/presets');
    expect(stale?.message).toContain('pnpm assets:build');
  });
});

describe('preset references of Easy categories and characters (REQ-AST-038)', () => {
  const parts = new Map<string, PartEntry>();
  const check = (files: PackPresets['files']): CheckIssue[] => {
    const issues: CheckIssue[] = [];
    checkPresetReferences([{packId: 'p', files, parts: []}], parts, i =>
      issues.push(i),
    );
    return issues;
  };

  it('AC-AST-038.2: a category listing a slot that is not in the slot registry fails with AST_PRESET_REF naming the category and the slot', () => {
    expect(SLOT_REGISTRY.slots.some(s => s.id === 'not-a-slot')).toBe(false);
    const issues = check([
      {
        kind: 'easy-category',
        path: 'presets/categories/hair.json',
        json: {
          ...shipped('categories/hair.json'),
          slots: ['hair', 'not-a-slot'],
        },
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('AST_PRESET_REF');
    expect(issues[0]?.message).toContain('hair');
    expect(issues[0]?.message).toContain('not-a-slot');
  });
});
