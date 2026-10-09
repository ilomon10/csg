import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {checkDefaultSkeletonGroup} from './default-group.js';
import {BUDGETS, checkDefaultSetSize, checkPartBudgets} from './budgets.js';
import {checkIds, parseRetiredIds} from './ids.js';
import {checkLicenses} from './licenses.js';
import {formatCheckReport} from './report.js';
import {runAssetCheck} from './run.js';
import type {CheckOptions} from './run.js';
import {
  makeGlb,
  rewriteManifest,
  sha256Hex,
  writeTestPack,
} from './check-fixtures.js';
import {countIssues} from './types.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-check-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

const opts = (repo: Omit<CheckOptions, 'licenseFile'>): CheckOptions => repo;
const codes = (r: Awaited<ReturnType<typeof runAssetCheck>>, sev = 'error') =>
  r.issues.filter(i => i.severity === sev).map(i => i.code);

describe('assets:check graceful and clean', () => {
  it('AC-AST-020.1: no built packs passes with a note', async () => {
    const report = await runAssetCheck({
      packsDir: join(root, 'none'),
      configsDir: join(root, 'cfg'),
      rigsDir: join(root, 'rigs'),
    });
    expect(countIssues(report.issues).errors).toBe(0);
    expect(formatCheckReport(report)).toContain('no built packs');
  });

  it('AC-AST-020.1: a clean pack with parts and clips has no errors', async () => {
    const {repo} = await writeTestPack(
      root,
      'p1',
      [
        {id: 'body', slot: 'body', glb: {region: 3}},
        {id: 'shirt', glb: {triangles: 4}},
      ],
      ['idle'],
    );
    const report = await runAssetCheck(opts(repo));
    expect(codes(report)).toEqual([]);
    expect(report.packs).toEqual(['p1']);
  });
});

describe('AC-AST-013.2 manifest staleness', () => {
  it('hand-edited manifest fails with AST_MANIFEST_STALE and points to pack.config.json', async () => {
    const {repo, manifest} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    (manifest['parts'] as Array<Record<string, unknown>>)[0]!['name'] =
      'Edited by hand';
    rewriteManifest(root, 'p1', manifest);
    const report = await runAssetCheck(opts(repo));
    const stale = report.issues.find(i => i.code === 'AST_MANIFEST_STALE');
    expect(stale?.severity).toBe('error');
    expect(stale?.message).toContain('pack.config.json');
  });

  it('embedded rig copy that differs from the canonical rig is stale', async () => {
    const {repo, manifest} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    (manifest['rigs'] as Array<Record<string, unknown>>)[0]!['lengthAxis'] =
      'x';
    rewriteManifest(root, 'p1', manifest);
    const report = await runAssetCheck(opts(repo));
    expect(codes(report)).toContain('AST_MANIFEST_STALE');
  });

  it('a hash that differs from the file fails with AST_HASH_MISMATCH', async () => {
    const {repo, manifest} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    (manifest['parts'] as Array<Record<string, unknown>>)[0]!['sha256'] =
      sha256Hex(new Uint8Array([1]));
    rewriteManifest(root, 'p1', manifest);
    expect(codes(await runAssetCheck(opts(repo)))).toContain(
      'AST_HASH_MISMATCH',
    );
  });
});

describe('AC-AST-016.1 budgets', () => {
  it('10,001 triangles fail with AST_BUDGET_TRIANGLES naming the part and limit', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'big', glb: {triangles: 10_001}},
    ]);
    const report = await runAssetCheck(opts(repo));
    const issue = report.issues.find(i => i.code === 'AST_BUDGET_TRIANGLES');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('big');
    expect(issue?.message).toContain('10000');
  });

  it('limits per kind: body 20000, skinned 10000, static 5000, 4 textures', () => {
    const s = {packId: 'p', id: 'x'};
    const stats = {triangles: 5001, textures: 4, maxInfluences: 4};
    expect(
      checkPartBudgets({...s, kind: 'static', slot: 'weapon'}, stats).map(
        i => i.code,
      ),
    ).toEqual(['AST_BUDGET_TRIANGLES']);
    expect(
      checkPartBudgets({...s, kind: 'skinned', slot: 'top'}, stats),
    ).toEqual([]);
    expect(
      checkPartBudgets(
        {...s, kind: 'skinned', slot: 'body'},
        {...stats, triangles: 20_001},
      ).length,
    ).toBe(1);
    expect(
      checkPartBudgets(
        {...s, kind: 'skinned', slot: 'top'},
        {...stats, textures: 5},
      )[0]?.code,
    ).toBe('AST_BUDGET_TEXTURES');
  });

  it('AC-AST-016.2: default set size over 15 MB fails', () => {
    expect(
      checkDefaultSetSize(new Map([['a', BUDGETS.defaultSetBytes]])),
    ).toEqual([]);
    expect(
      checkDefaultSetSize(
        new Map([
          ['a', BUDGETS.defaultSetBytes],
          ['b', 1],
        ]),
      )[0]?.code,
    ).toBe('AST_BUDGET_SIZE');
  });
});

describe('influences (AC-AST-027.2)', () => {
  it('a built GLB with 5 influences is an AST_BUDGET_INFLUENCES error', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'hairy', glb: {influences: 5}},
    ]);
    const report = await runAssetCheck(opts(repo));
    expect(codes(report)).toContain('AST_BUDGET_INFLUENCES');
  });

  it('4 influences report no AST_BUDGET_INFLUENCES', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'ok', glb: {influences: 4}},
    ]);
    expect(codes(await runAssetCheck(opts(repo)))).not.toContain(
      'AST_BUDGET_INFLUENCES',
    );
  });
});

describe('AC-AST-026.1 skeleton groups in check', () => {
  it('a part in fixture-b is a warning naming the group and pelvis, not an error', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'shirt', glb: {group: 'fixture-b'}},
    ]);
    const report = await runAssetCheck(opts(repo));
    expect(codes(report)).toEqual([]);
    const warn = report.issues.find(i => i.code === 'AST_BIND_POSE_DIFFERS');
    expect(warn?.severity).toBe('warn');
    expect(warn?.message).toContain('fixture-b');
    expect(warn?.message).toContain('pelvis');
  });

  it('a renamed joint is a structural AST_RIG_MISMATCH error', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'shirt', glb: {renameJoint: ['hand_r', 'Hand_R']}},
    ]);
    expect(codes(await runAssetCheck(opts(repo)))).toContain(
      'AST_RIG_MISMATCH',
    );
  });

  it('a skeletonGroup that the rig does not declare is reported', async () => {
    const {repo, manifest} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    (manifest['parts'] as Array<Record<string, unknown>>)[0]!['skeletonGroup'] =
      'nope';
    rewriteManifest(root, 'p1', manifest);
    expect(codes(await runAssetCheck(opts(repo)))).toContain(
      'AST_RIG_MISMATCH',
    );
  });
});

describe('AC-AST-017 licenses', () => {
  it('AC-AST-017.1: license CC-BY-SA-4.0 fails with AST_LICENSE_NOT_ALLOWED', async () => {
    const {repo, config} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    (config['license'] as Record<string, unknown>)['license'] = 'CC-BY-SA-4.0';
    writeFileSync(
      join(repo.configsDir, 'p1', 'pack.config.json'),
      JSON.stringify(config),
    );
    expect(codes(await runAssetCheck(opts(repo)))).toContain(
      'AST_LICENSE_NOT_ALLOWED',
    );
  });

  it('AC-AST-017.2: a part override without author names the part and author', () => {
    const issues = checkLicenses(
      {
        license: {license: 'CC0-1.0', author: 'a', sourceUrl: 'https://x.y'},
        parts: [
          {
            id: 'shirt-1',
            license: {license: 'CC0-1.0', sourceUrl: 'https://x.y'},
          },
        ],
      },
      'p1',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.id).toBe('shirt-1');
    expect(issues[0]?.message).toContain('author');
  });

  it('CC-BY-4.0 is accepted', () => {
    expect(
      checkLicenses(
        {
          license: {
            license: 'CC-BY-4.0',
            author: 'a',
            sourceUrl: 'https://x.y',
          },
        },
        'p',
      ),
    ).toEqual([]);
  });
});

describe('AC-AST-019 retired ids', () => {
  it('AC-AST-019.1: a part removed from the config but not retired fails with AST_ID_REMOVED', async () => {
    const {repo, config} = await writeTestPack(root, 'p1', [
      {id: 'shirt'},
      {id: 'pants'},
    ]);
    config['parts'] = (config['parts'] as Array<{id: string}>).filter(
      p => p.id !== 'pants',
    );
    writeFileSync(
      join(repo.configsDir, 'p1', 'pack.config.json'),
      JSON.stringify(config),
    );
    const report = await runAssetCheck(opts(repo));
    const issue = report.issues.find(i => i.code === 'AST_ID_REMOVED');
    expect(issue?.id).toBe('pants');
  });

  it('AC-AST-019.1: removal visible only in the git baseline is caught, retiring fixes it', () => {
    const base = {
      packId: 'p',
      kind: 'part' as const,
      configIds: ['a'],
      manifestIds: ['a'],
      previousIds: ['a', 'b'],
    };
    expect(checkIds({...base, retired: new Set()})[0]?.code).toBe(
      'AST_ID_REMOVED',
    );
    expect(checkIds({...base, retired: new Set(['b'])})).toEqual([]);
  });

  it('AC-AST-019.2: a new part whose id is retired fails with AST_ID_REUSED', async () => {
    const {repo} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    writeFileSync(
      join(repo.packsDir, 'p1', 'retired-ids.json'),
      JSON.stringify({
        format: 'sprite-retired-ids',
        version: 1,
        ids: ['shirt'],
      }),
    );
    expect(codes(await runAssetCheck(opts(repo)))).toContain('AST_ID_REUSED');
  });

  it('parses the emit retired-ids.json format and rejects junk', () => {
    const ok = parseRetiredIds({
      format: 'sprite-retired-ids',
      version: 1,
      ids: ['a'],
    });
    expect(ok.ok && ok.value.parts.has('a') && ok.value.clips.has('a')).toBe(
      true,
    );
    expect(parseRetiredIds(['a']).ok).toBe(false);
    expect(parseRetiredIds({parts: ['a']}).ok).toBe(false);
    expect(
      parseRetiredIds({format: 'sprite-retired-ids', version: 1, ids: 'a'}).ok,
    ).toBe(false);
    expect(parseRetiredIds(7).ok).toBe(false);
  });
});

describe('AC-AST-020.2 orphans and files', () => {
  it('an unreferenced .glb fails with AST_ORPHAN_FILE', async () => {
    const {repo} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    writeFileSync(join(repo.packsDir, 'p1', 'unused.glb'), await makeGlb());
    const report = await runAssetCheck(opts(repo));
    const issue = report.issues.find(i => i.code === 'AST_ORPHAN_FILE');
    expect(issue?.message).toContain('unused.glb');
  });

  it('a missing GLB is AST_FILE_MISSING and a non-GLB is AST_SOURCE_FORMAT', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'shirt'},
      {id: 'pants'},
    ]);
    writeFileSync(
      join(repo.packsDir, 'p1', 'parts/pants.glb'),
      'not a glb at all',
    );
    rmSync(join(repo.packsDir, 'p1', 'parts/shirt.glb'));
    const c = codes(await runAssetCheck(opts(repo)));
    expect(c).toContain('AST_FILE_MISSING');
    expect(c).toContain('AST_SOURCE_FORMAT');
  });

  it('a missing thumbnail is only a warning', async () => {
    const {repo} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    rmSync(join(repo.packsDir, 'p1', 'thumbnails/shirt.webp'));
    const report = await runAssetCheck(opts(repo));
    expect(codes(report)).toEqual([]);
    expect(codes(report, 'warn')).toContain('AST_THUMBNAIL_MISSING');
  });

  it('a symlink in a pack is never followed', async () => {
    const {repo} = await writeTestPack(root, 'p1', [{id: 'shirt'}]);
    symlinkSync('/etc/passwd', join(repo.packsDir, 'p1', 'link.glb'));
    expect(codes(await runAssetCheck(opts(repo)))).toContain('AST_ORPHAN_FILE');
  });

  it('a pack folder without manifest.json fails', async () => {
    mkdirSync(join(root, 'assets/packs/p2'), {recursive: true});
    writeFileSync(join(root, 'assets/packs/p2/a.glb'), 'x');
    const report = await runAssetCheck({
      packsDir: join(root, 'assets/packs'),
      configsDir: join(root, 'c'),
      rigsDir: join(root, 'r'),
    });
    expect(codes(report)).toContain('AST_MANIFEST_INVALID');
  });
});

describe('AC-AST-025.3 _REGION', () => {
  it('a body with _REGION 11 fails with AST_REGION_INVALID naming the part and count', async () => {
    const {repo} = await writeTestPack(root, 'p1', [
      {id: 'body', slot: 'body', glb: {region: 11, triangles: 2}},
    ]);
    const issue = (await runAssetCheck(opts(repo))).issues.find(
      i => i.code === 'AST_REGION_INVALID',
    );
    expect(issue?.message).toContain('body');
    expect(issue?.message).toContain('6 vertices');
  });
});

describe('AC-AST-005.3 default skeleton group', () => {
  const declared = new Map([
    ['g-a', 'a.glb'],
    ['g-b', 'b.glb'],
  ]);
  it('undeclared group names defaultSkeletonGroup', () => {
    expect(checkDefaultSkeletonGroup(undefined, declared, 'a.glb')).toContain(
      'defaultSkeletonGroup',
    );
    expect(checkDefaultSkeletonGroup('g-z', declared, 'a.glb')).toContain(
      'defaultSkeletonGroup',
    );
  });
  it('group whose representative is not the reference file fails', () => {
    expect(checkDefaultSkeletonGroup('g-b', declared, 'a.glb')).toContain(
      'defaultSkeletonGroup',
    );
  });
  it('the reference group is accepted', () => {
    expect(checkDefaultSkeletonGroup('g-a', declared, 'a.glb')).toBeNull();
  });
});
