import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {rewriteManifest, writeTestPack} from './check-fixtures.js';
import {
  createDefaultCharacterSpec,
  rigDefinitionSchema,
} from '@csg/parts-schema';
import {readBuiltSoleSources} from '../build/sole-io.js';
import {
  characterGroupOf,
  fitsBody,
  measureGroupSole,
  readSoleMesh,
} from '../build/sole.js';
import type {SoleMesh} from '../build/sole.js';
import {runAssetCheck} from './run.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assets-sole-'));
});
afterEach(() => rmSync(root, {recursive: true, force: true}));

const BODY = {id: 'body', slot: 'body', glb: {region: 10, yOffset: 0.98}};

async function staleMessages(
  stored: number | undefined,
  edit?: (repo: Awaited<ReturnType<typeof writeTestPack>>) => void,
): Promise<string[]> {
  const pack = await writeTestPack(root, 'p1', [BODY], [], stored);
  edit?.(pack);
  const report = await runAssetCheck(pack.repo);
  return report.issues
    .filter(i => i.code === 'AST_SOLE_OFFSET_STALE')
    .map(i => i.message);
}

describe('AST_SOLE_OFFSET_STALE (REQ-AST-032)', () => {
  it('AC-AST-032.1: a hand-edited value fails naming the group, stored and recomputed value; one step off passes', async () => {
    const [message] = await staleMessages(0.0243);
    expect(message).toContain('fixture-a');
    expect(message).toContain('0.0243');
    expect(message).toContain('0.02');
  });

  it('AC-AST-032.1: a value one step (0.0001 m) away passes', async () => {
    expect(await staleMessages(0.0201)).toEqual([]);
    expect(await staleMessages(0.02)).toEqual([]);
  });

  it('AC-AST-032.2: a missing value for a group with a body fails', async () => {
    const [message] = await staleMessages(undefined);
    expect(message).toContain('fixture-a');
    expect(message).toContain('none');
  });

  it('AC-AST-032.2: a value on a group without a body fails', async () => {
    const messages = await staleMessages(0.02, ({repo}) => {
      const rigFile = join(repo.rigsDir, 'test-rig.json');
      const rig = JSON.parse(readFileSync(rigFile, 'utf8')) as {
        skeletonGroups: Array<{id: string; soleOffsetM?: number}>;
      };
      const b = rig.skeletonGroups.find(g => g.id === 'fixture-b');
      if (b) b.soleOffsetM = 0.01;
      writeFileSync(rigFile, JSON.stringify(rig));
      const manifestPath = join(repo.packsDir, 'p1', 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        rigs: unknown[];
      };
      manifest.rigs = [rig];
      rewriteManifest(root, 'p1', manifest);
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('fixture-b');
  });
});

describe('bundled sole offsets (REQ-AST-030)', () => {
  it('AC-AST-030.4: male and female are 0.010 to 0.040 m, groups without a body have none', () => {
    const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
    const rig = JSON.parse(
      readFileSync(
        join(repoRoot, 'packages/parts-schema/rigs/quaternius-ue5-65.json'),
        'utf8',
      ),
    ) as {skeletonGroups: Array<{id: string; soleOffsetM?: number}>};
    const value = (id: string) =>
      rig.skeletonGroups.find(g => g.id === id)?.soleOffsetM;
    for (const id of ['male', 'female']) {
      expect(value(id)).toBeGreaterThanOrEqual(0.01);
      expect(value(id)).toBeLessThanOrEqual(0.04);
    }
    expect(value('superhero-m')).toBeUndefined();
    expect(value('ual')).toBeUndefined();
  });
});

describe('bundled grounding (REQ-ANA-008)', () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');

  it('AC-ANA-008.6: at default anatomy the lowest body or feet vertex of the default male and female characters is at y = 0 (±1e-3) and no feet part is below -1e-3', async () => {
    const rig = rigDefinitionSchema.parse(
      JSON.parse(
        readFileSync(
          join(repoRoot, 'packages/parts-schema/rigs/quaternius-ue5-65.json'),
          'utf8',
        ),
      ),
    );
    const sources = await readBuiltSoleSources(
      join(repoRoot, 'assets/packs'),
      rig.id,
      new Set(),
    );
    const defaultBody = createDefaultCharacterSpec().body.ref;
    expect(defaultBody).toContain('superhero-m');
    for (const [bodyId, groupId] of [
      ['superhero-m', 'male'],
      ['superhero-f', 'female'],
    ] as const) {
      const body = sources.find(s => s.entry.id === bodyId);
      expect(body, bodyId).toBeDefined();
      if (body === undefined) continue;
      expect(characterGroupOf(body.entry, rig)).toBe(groupId);
      const bodyMesh = await readSoleMesh(bodyId, body.bytes);
      const feetSources = sources.filter(
        s =>
          s.entry.slot === 'feet' &&
          s.entry.kind === 'skinned' &&
          fitsBody(s.entry, body.entry),
      );
      expect(feetSources.length).toBeGreaterThan(0);
      const feetMeshes: SoleMesh[] = [];
      for (const f of feetSources) {
        const m = await readSoleMesh(f.entry.id, f.bytes);
        if (m !== null) feetMeshes.push(m);
      }
      const sole = measureGroupSole(
        rig,
        groupId,
        bodyMesh === null ? [] : [bodyMesh],
        feetMeshes,
      );
      const stored = rig.skeletonGroups.find(
        g => g.id === groupId,
      )?.soleOffsetM;
      expect(stored).toBeDefined();
      // Ground offset at default anatomy (height = feet = 1): -jointMinY + soleOffsetM.
      const offset = -sole.jointMinY + (stored ?? 0);
      const lowest = Math.min(
        sole.bodySoleY ?? Infinity,
        sole.partSoleY ?? Infinity,
      );
      expect(Math.abs(lowest + offset)).toBeLessThan(1e-3);
      for (const f of feetMeshes) {
        const one = measureGroupSole(rig, groupId, [], [f]);
        expect(
          (one.partSoleY ?? Infinity) + offset,
          `${groupId} ${f.id}`,
        ).toBeGreaterThan(-1e-3);
      }
    }
  });
});
