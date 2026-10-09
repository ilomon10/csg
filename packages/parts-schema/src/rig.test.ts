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

  it('AC-ANA-021.1: the committed rig validates with root, Head and default group', () => {
    const file = new URL('../rigs/quaternius-ue5-65.json', import.meta.url);
    const rig = JSON.parse(readFileSync(file, 'utf8'));
    const result = rigDefinitionSchema.safeParse(rig);
    expect(result.success ? [] : result.error.issues).toEqual([]);
    expect(rig.parents.root).toBeNull();
    expect(rig.parents.Head).toBe('neck_01');
    expect(rig.defaultSkeletonGroup).toBe('superhero-m');
  });

  it('AC-ANA-021.2: zero or two null parents fail with an exactly-one-root issue under parents', () => {
    for (const edit of [
      (r: ReturnType<typeof makeRig>) => (r.parents['pelvis'] = null),
      (r: ReturnType<typeof makeRig>) => (r.parents['root'] = 'pelvis'),
    ]) {
      const rig = makeRig();
      edit(rig);
      const result = rigDefinitionSchema.safeParse(rig);
      const issues = result.success ? [] : result.error.issues;
      expect(
        issues.some(
          i =>
            i.path[0] === 'parents' &&
            i.message.includes('exactly one root is required'),
        ),
      ).toBe(true);
    }
  });

  it('AC-ANA-021.3: rootBone differing from the null-parent joint fails naming rootBone', () => {
    const rig = makeRig();
    rig.rootBone = 'pelvis';
    expect(paths(rig)).toContain('rootBone');
  });

  it('AC-ANA-021.4: a parent listed after its child, or not in bones, fails naming parents.<bone>', () => {
    const later = makeRig();
    later.parents['pelvis'] = 'Head';
    expect(paths(later)).toContain('parents.pelvis');
    const unknown = makeRig();
    unknown.parents['pelvis'] = 'Pelvis';
    expect(paths(unknown)).toContain('parents.pelvis');
    const reordered = makeRig();
    [reordered.bones[1], reordered.bones[2]] = [
      reordered.bones[2]!,
      reordered.bones[1]!,
    ];
    expect(paths(reordered)).toContain('parents.spine_03');
  });

  it('AC-ANA-021.5: a missing or extra parents entry fails naming that joint', () => {
    const missing = makeRig();
    delete missing.parents['hand_l'];
    expect(paths(missing)).toContain('parents.hand_l');
    const extra = makeRig();
    extra.parents['tail_01'] = 'root';
    expect(paths(extra)).toContain('parents.tail_01');
  });

  it('AC-ANA-021.6: an unknown or missing defaultSkeletonGroup fails naming it', () => {
    const unknown = makeRig();
    unknown.defaultSkeletonGroup = 'g-c';
    expect(paths(unknown)).toContain('defaultSkeletonGroup');
    const missing = makeRig() as Record<string, unknown>;
    delete missing['defaultSkeletonGroup'];
    expect(paths(missing)).toContain('defaultSkeletonGroup');
  });

  it('AC-ANA-021.7: a group rest pose missing a joint, or a duplicate group id, fails with the group path', () => {
    const rig = makeRig();
    delete rig.skeletonGroups[1]!.restPose['hand_l'];
    expect(paths(rig)).toContain('skeletonGroups.1.restPose.hand_l');
    const dup = makeRig();
    dup.skeletonGroups[1]!.id = 'g-a';
    expect(paths(dup)).toContain('skeletonGroups.1.id');
  });

  it('AC-AST-026.3: group ids must match [a-z0-9-]{1,32}', () => {
    const rig = makeRig();
    rig.skeletonGroups[0]!.id = 'Bad_Id';
    expect(rigDefinitionSchema.safeParse(rig).success).toBe(false);
  });

  it('REQ-AST-005: the committed Quaternius rig has no hipBone and 4 groups', () => {
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
