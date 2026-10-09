import {NodeIO} from '@gltf-transform/core';
import {describe, expect, it} from 'vitest';
import {BODY_REGIONS} from '@csg/parts-schema';
import {buildSkinnedPart, bodyBoxes} from '../../fixtures/fixture-models.js';
import {
  GROUP_A,
  buildRigDefinition,
  restPoseOf,
} from '../../fixtures/fixture-rig.js';
import {
  applySoleOffsets,
  carrySoleOffsets,
  computeSoleOffsets,
  quantizeSole,
  SoleRangeError,
} from './sole.js';
import type {SoleSource} from './sole.js';

const rig = buildRigDefinition('y');
const rest = restPoseOf(GROUP_A);

async function glb(
  boxes: ReturnType<typeof bodyBoxes>,
  region: boolean,
): Promise<Uint8Array> {
  const doc = buildSkinnedPart({
    name: 'p',
    materialName: 'M',
    color: [1, 1, 1, 1],
    group: GROUP_A,
    boxes,
    withRegion: region,
  });
  return new NodeIO().writeBinary(doc);
}

const FEET = ['foot_l', 'foot_r'];
const entry = (id: string, slot: string): SoleSource['entry'] => ({
  id,
  slot,
  kind: 'skinned',
  rig: rig.id,
  skeletonGroup: GROUP_A,
  ...(slot === 'body' ? {characterSkeletonGroup: GROUP_A} : {}),
});

async function body(pad: number): Promise<SoleSource> {
  return {
    packId: 'p',
    entry: entry('body', 'body'),
    bytes: await glb(bodyBoxes(rest, pad), true),
  };
}
async function feet(pad: number): Promise<SoleSource> {
  return {
    packId: 'p',
    entry: entry('boots', 'feet'),
    bytes: await glb(bodyBoxes(rest, pad, FEET), false),
  };
}

describe('sole offset measurement (REQ-AST-030 to REQ-AST-033)', () => {
  it('AC-AST-030.1: the lowest of body sole and feet part sole wins, groups without a body get none', async () => {
    const out = await computeSoleOffsets(rig, [
      await body(0.02),
      await feet(0.0251),
    ]);
    expect(out.offsets.get(GROUP_A)).toBe(0.0251);
    expect(out.offsets.has('fixture-b')).toBe(false);
  });

  it('AC-AST-030.2: without the feet part the body sole is used, rounded to 0.0001', async () => {
    const a = await computeSoleOffsets(rig, [await body(0.02)]);
    expect(a.offsets.get(GROUP_A)).toBe(0.02);
    const b = await computeSoleOffsets(rig, [await body(0.01237)]);
    expect(b.offsets.get(GROUP_A)).toBe(0.0124);
  });

  it('AC-AST-030.2: quantizeSole rounds halves away from zero', () => {
    expect(quantizeSole(0.00005)).toBe(0.0001);
    expect(quantizeSole(-0.00005)).toBe(-0.0001);
    expect(quantizeSole(0.02499)).toBe(0.025);
  });

  it('AC-AST-030.3: the result is deterministic', async () => {
    const sources = [await body(0.02), await feet(0.0251)];
    const a = await computeSoleOffsets(rig, sources);
    const b = await computeSoleOffsets(rig, sources);
    expect([...a.offsets]).toEqual([...b.offsets]);
    expect(JSON.stringify(applySoleOffsets(rig, a.offsets))).toBe(
      JSON.stringify(applySoleOffsets(rig, b.offsets)),
    );
  });

  it('AC-AST-031.1: a feet part 0.0151 m below the body warns AST_SOLE_SPREAD', async () => {
    const out = await computeSoleOffsets(rig, [
      await body(0.02),
      await feet(0.0351),
    ]);
    expect(out.offsets.get(GROUP_A)).toBe(0.0351);
    expect(out.warnings).toHaveLength(1);
    const w = out.warnings[0];
    expect(w?.code).toBe('AST_SOLE_SPREAD');
    expect(w?.partId).toBe('boots');
    expect(w?.message).toContain(GROUP_A);
    expect(w?.message).toContain('0.0151');
  });

  it('AC-AST-031.2: a spread of 0.0051 m does not warn', async () => {
    const out = await computeSoleOffsets(rig, [
      await body(0.02),
      await feet(0.0251),
    ]);
    expect(out.warnings).toEqual([]);
  });

  it('AC-AST-033.1: a sole 0.15 m below the lowest feet joint fails with AST_SOLE_OFFSET_RANGE', async () => {
    await expect(computeSoleOffsets(rig, [await body(0.15)])).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof SoleRangeError &&
        e.groupId === GROUP_A &&
        e.value === '0.15',
    );
  });

  it('AC-AST-033.2: a body without feet triangles and no feet part fails with "none"', async () => {
    const noFeet = bodyBoxes(rest, 0.02, [
      'pelvis',
      'spine_01',
      'Head',
      'thigh_l',
    ]);
    const source: SoleSource = {
      packId: 'p',
      entry: entry('body', 'body'),
      bytes: await glb(noFeet, true),
    };
    expect(BODY_REGIONS.indexOf('feet')).toBe(10);
    await expect(computeSoleOffsets(rig, [source])).rejects.toSatisfy(
      (e: unknown) => e instanceof SoleRangeError && e.value === 'none',
    );
  });

  it('AC-AST-034.1: --write-canonical keeps the stored value of groups it writes again', () => {
    const existing = applySoleOffsets(rig, new Map([[GROUP_A, 0.0251]]));
    const groups = carrySoleOffsets(
      rig.skeletonGroups.map(g => ({id: g.id, restPose: g.restPose})),
      existing,
    );
    expect(groups.find(g => g.id === GROUP_A)?.soleOffsetM).toBe(0.0251);
    expect(groups.find(g => g.id === 'fixture-b')?.soleOffsetM).toBeUndefined();
    const dropped = carrySoleOffsets([{id: 'fixture-b'}], existing);
    expect(dropped).toEqual([{id: 'fixture-b'}]);
  });
});
