import {Document} from '@gltf-transform/core';
import {describe, expect, it} from 'vitest';
import {skeletonFromGroup} from '../rig-verify.js';
import type {RigGroupsView} from '../rig-verify.js';
import {classifySkeleton} from './skeleton.js';

// Spec ACs say g-a/g-b; the fixture group ids are fixture-a/fixture-b.
const BONES = ['root', 'pelvis', 'spine_01', 'hand_r'];
const PARENTS: Record<string, string | null> = {
  root: null,
  pelvis: 'root',
  spine_01: 'pelvis',
  hand_r: 'spine_01',
};
type Rest = {t: number[]; r: number[]; s: number[]};

function restPose(pelvisDy: number): Record<string, Rest> {
  return Object.fromEntries(
    BONES.map((b, i) => [
      b,
      {
        t: [0, i === 1 ? 1 + pelvisDy : 0.5 * i, 0],
        r: [0, 0, 0, 1],
        s: [1, 1, 1],
      },
    ]),
  );
}

const POSES = {'fixture-a': restPose(0), 'fixture-b': restPose(0.05)};
const RIG: RigGroupsView = {
  bones: BONES,
  parents: PARENTS,
  skeletonGroups: [
    {id: 'fixture-a', restPose: POSES['fixture-a']},
    {id: 'fixture-b', restPose: POSES['fixture-b']},
  ],
};

function nodesFor(
  doc: Document,
  pose: Record<string, Rest>,
  rename: Record<string, string> = {},
) {
  const nodes = BONES.map(b =>
    doc
      .createNode(rename[b] ?? b)
      .setTranslation(pose[b]!.t as [number, number, number])
      .setRotation(pose[b]!.r as [number, number, number, number])
      .setScale(pose[b]!.s as [number, number, number]),
  );
  BONES.forEach((b, i) => {
    const p = PARENTS[b];
    if (p) nodes[BONES.indexOf(p)]!.addChild(nodes[i]!);
  });
  return nodes;
}

function skinnedDoc(
  groupId: string,
  pose: Record<string, Rest> = POSES[groupId as 'fixture-a' | 'fixture-b'],
  rename: Record<string, string> = {},
): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const nodes = nodesFor(doc, pose, rename);
  const ibm = doc
    .createAccessor()
    .setType('MAT4')
    .setBuffer(buffer)
    .setArray(
      new Float32Array(skeletonFromGroup(RIG, groupId)!.inverseBind.flat()),
    );
  const skin = doc.createSkin().setInverseBindMatrices(ibm);
  nodes.forEach(n => skin.addJoint(n));
  doc.createScene().addChild(nodes[0]!);
  return doc;
}

function clipDoc(pose: Record<string, Rest>): Document {
  const doc = new Document();
  const nodes = nodesFor(doc, pose);
  doc.createScene().addChild(nodes[0]!);
  return doc;
}

describe('classifySkeleton', () => {
  it('AC-AST-026.1: a part in fixture-a classifies as fixture-a', () => {
    const r = classifySkeleton(skinnedDoc('fixture-a'), RIG, {id: 'body'});
    expect(r.skeletonGroup).toBe('fixture-a');
    expect(r.warnings).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('AC-AST-026.1: a part in fixture-b (pelvis +0.05 m) classifies as fixture-b', () => {
    const r = classifySkeleton(skinnedDoc('fixture-b'), RIG, {id: 'shirt'});
    expect(r.skeletonGroup).toBe('fixture-b');
    expect(r.errors).toEqual([]);
  });

  it('AC-AST-026.1: a skinless clip file with fixture-b rest poses classifies as fixture-b', () => {
    const r = classifySkeleton(clipDoc(POSES['fixture-b']), RIG, {
      id: 'clip',
    });
    expect(r.skeletonGroup).toBe('fixture-b');
  });

  it('AC-AST-026.4: a perturbed rest pose warns, names part, closest group and worst bone', () => {
    const pose = structuredClone(POSES['fixture-a']);
    pose['hand_r']!.t[0] = 0.01;
    const r = classifySkeleton(skinnedDoc('fixture-a', pose), RIG, {
      id: 'shirt',
    });
    expect(r.skeletonGroup).toBeUndefined();
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    expect(w.code).toBe('AST_SKELETON_GROUP_UNMATCHED');
    expect(w.partId).toBe('shirt');
    expect(w.message).toContain('shirt');
    expect(w.details).toMatchObject({
      closestGroup: 'fixture-a',
      worstBone: 'hand_r',
    });
  });

  it('AC-AST-026.2: a renamed bone is an AST_RIG_MISMATCH error', () => {
    const r = classifySkeleton(
      skinnedDoc('fixture-a', undefined, {hand_r: 'Hand_R'}),
      RIG,
      {id: 'shirt'},
    );
    expect(r.skeletonGroup).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(r.errors[0]?.code).toBe('AST_RIG_MISMATCH');
    expect(r.errors[0]?.message).toContain('Hand_R');
  });

  it('AC-AST-026.4: tolerance edge: delta below 1e-4 m still matches', () => {
    const pose = structuredClone(POSES['fixture-a']);
    pose['hand_r']!.t[0] = 5e-5;
    const doc = skinnedDoc('fixture-a', pose);
    expect(classifySkeleton(doc, RIG).skeletonGroup).toBe('fixture-a');
  });
});
