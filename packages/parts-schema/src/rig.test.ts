import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {rigDefinitionSchema} from './rig';
import {makeRig} from './test-fixtures';

describe('rigDefinitionSchema', () => {
  it('AC-ANA-002.2: a valid rig parses and keeps unknown fields', () => {
    const result = rigDefinitionSchema.safeParse({...makeRig(), extra: 1});
    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as Record<string, unknown>)['extra']).toBe(1);
  });

  it('AC-ANA-002.2: a missing anatomy key fails naming the key', () => {
    const rig = makeRig();
    delete (rig.anatomyBones as Record<string, unknown>)['armLength'];
    const result = rigDefinitionSchema.safeParse(rig);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('armLength'))).toBe(
        true,
      );
    }
  });

  it('AC-ANA-002.2: an anatomy key with no bones fails naming the key', () => {
    const rig = makeRig();
    rig.anatomyBones.feet = [];
    const result = rigDefinitionSchema.safeParse(rig);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain('"feet"');
  });

  it('REQ-ANA-002: unknown bones in anatomy, region or socket maps fail', () => {
    const a = makeRig();
    a.anatomyBones.head = ['head'];
    expect(rigDefinitionSchema.safeParse(a).success).toBe(false);
    const b = makeRig();
    b.regionBones.feet = ['ghost'];
    expect(rigDefinitionSchema.safeParse(b).success).toBe(false);
    const c = makeRig();
    c.socketBones.head = 'head';
    expect(rigDefinitionSchema.safeParse(c).success).toBe(false);
  });

  it('REQ-ANA-002: D1 keeps source names, so socket head maps to joint Head', () => {
    const rig = rigDefinitionSchema.parse(makeRig());
    expect(rig.socketBones.head).toBe('Head');
    expect(rig.bones).toContain('Head');
  });

  it('REQ-AST-005: duplicate bones and a bone in two regions fail', () => {
    const dup = makeRig();
    dup.bones[1] = 'root';
    expect(rigDefinitionSchema.safeParse(dup).success).toBe(false);
    const twice = makeRig();
    twice.regionBones.feet = ['Head'];
    expect(rigDefinitionSchema.safeParse(twice).success).toBe(false);
  });

  it('AC-ANA-019.2: socketBones lacking pelvis fails naming socketBones.pelvis', () => {
    const rig = makeRig();
    delete (rig.socketBones as Record<string, unknown>)['pelvis'];
    expect(paths(rig)).toContain('socketBones.pelvis');
  });

  it('AC-ANA-020.1: anatomyBones.head listing "head" fails naming it', () => {
    const rig = makeRig();
    rig.anatomyBones.head = ['head'];
    const result = rigDefinitionSchema.safeParse(rig);
    expect(paths(rig)).toContain('anatomyBones.head.0');
    expect(
      result.success ? '' : result.error.issues.map(i => i.message).join(),
    ).toContain('"head"');
  });

  it('REQ-AST-005: a parent listed after its child fails naming parents.<bone>', () => {
    const rig = makeRig();
    rig.parents['pelvis'] = 'Head';
    expect(paths(rig)).toContain('parents.pelvis');
  });

  it('REQ-AST-005: reordered bones put a parent after its child', () => {
    const rig = makeRig();
    [rig.bones[1], rig.bones[2]] = [rig.bones[2]!, rig.bones[1]!];
    expect(paths(rig)).toContain('parents.spine_03');
  });

  it('REQ-AST-005: zero or two null parents fail', () => {
    const none = makeRig();
    none.parents['root'] = 'pelvis';
    expect(paths(none)).toContain('parents.root');
    const two = makeRig();
    two.parents['Head'] = null;
    expect(paths(two)).toContain('parents.Head');
  });

  it('AC-AST-026.3: every group needs a rest pose for every bone', () => {
    const rig = makeRig();
    delete rig.skeletonGroups[1]!.restPose['Head'];
    expect(paths(rig)).toContain('skeletonGroups.1.restPose.Head');
  });

  it('AC-AST-026.3: duplicate group ids and an unknown default group fail', () => {
    const dup = makeRig();
    dup.skeletonGroups[1]!.id = 'g-a';
    expect(paths(dup)).toContain('skeletonGroups.1.id');
    const bad = makeRig();
    bad.defaultSkeletonGroup = 'nope';
    expect(paths(bad)).toContain('defaultSkeletonGroup');
  });

  it('AC-AST-026.3: group ids must match [a-z0-9-]{1,32}', () => {
    const rig = makeRig();
    rig.skeletonGroups[0]!.id = 'Bad_Id';
    expect(rigDefinitionSchema.safeParse(rig).success).toBe(false);
  });

  it('REQ-AST-005: the committed Quaternius rig validates', () => {
    const file = new URL('../rigs/quaternius-ue5-65.json', import.meta.url);
    const rig = JSON.parse(readFileSync(file, 'utf8'));
    const result = rigDefinitionSchema.safeParse(rig);
    expect(result.success ? [] : result.error.issues).toEqual([]);
    expect(rig).not.toHaveProperty('hipBone');
    expect(rig.skeletonGroups).toHaveLength(4);
  });
});

function paths(rig: unknown): string[] {
  const result = rigDefinitionSchema.safeParse(rig);
  return result.success ? [] : result.error.issues.map(i => i.path.join('.'));
}
