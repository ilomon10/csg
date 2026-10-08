import {describe, expect, it} from 'vitest';
import {Color, Matrix4, Vector3} from 'three';
import type {Bone, Material, Mesh, Object3D, SkinnedMesh} from 'three';
import type {CharacterSpec} from '@csg/parts-schema';
import {computeGroundOffset} from '../anatomy/apply';
import {createCharacterAssembly} from './character-assembly';
import type {CharacterAssembly} from './character-assembly';
import {createTestRegistry, fixtureSpec, ref} from './assembly-test-env';
import {regionMaskOf} from './region-mask';
import {TINT_SLOT_USER_DATA} from './tint-material';

// Spec ACs say `g-a`/`g-b`; the fixtures use `fixture-a`/`fixture-b` (same meaning).

function withSpec(
  base: CharacterSpec,
  patch: Partial<CharacterSpec>,
): CharacterSpec {
  return {...base, ...patch};
}

async function built(spec = fixtureSpec()) {
  const registry = createTestRegistry();
  const assembly = createCharacterAssembly({registry});
  const result = await assembly.setCharacter(spec);
  expect(result).toEqual({ok: true, value: undefined});
  return {registry, assembly, spec};
}

function skinnedMeshes(object: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  object.traverse(o => {
    if ((o as Partial<SkinnedMesh>).isSkinnedMesh === true)
      out.push(o as SkinnedMesh);
  });
  return out;
}

function meshes(object: Object3D): Mesh[] {
  const out: Mesh[] = [];
  object.traverse(o => {
    if ((o as Partial<Mesh>).isMesh === true) out.push(o as Mesh);
  });
  return out;
}

function boneMatrices(assembly: CharacterAssembly): number[] {
  const out: number[] = [];
  for (const bone of assembly.body?.skeleton.bones ?? []) {
    out.push(...bone.matrixWorld.elements);
  }
  return out;
}

function bone(assembly: CharacterAssembly, name: string): Bone {
  const b = assembly.body?.bones.get(name);
  if (b === undefined) throw new Error(`no bone ${name}`);
  return b;
}

describe('character assembly (M1-25)', () => {
  it('REQ-CMP-037: builds the skeleton of the body characterSkeletonGroup and attaches body, shirt and sword', async () => {
    const {assembly} = await built();
    expect(assembly.body?.skeletonGroupId).toBe('fixture-a');
    expect(assembly.body?.root.parent).toBe(assembly.root);
    expect([...assembly.parts.keys()].sort()).toEqual([
      'body',
      'prop-main-hand',
      'torso',
    ]);
    // Every skinned mesh of body and shirt uses the character's Bone objects.
    const characterBones = new Set(assembly.body?.skeleton.bones);
    for (const slot of ['body', 'torso']) {
      const object = assembly.parts.get(slot)?.attached.object as Object3D;
      const skinned = skinnedMeshes(object);
      expect(skinned.length).toBeGreaterThan(0);
      for (const mesh of skinned) {
        for (const b of mesh.skeleton.bones)
          expect(characterBones.has(b)).toBe(true);
      }
    }
    expect(assembly.log).toContain('body:rebuild:fixture-a');
  });

  it('AC-CMP-002.2: a spec with no body fails with CMP_BODY_MISSING and the character is unchanged', async () => {
    const {assembly, spec} = await built();
    const before = {
      body: assembly.body,
      parts: [...assembly.parts.values()].map(p => p.attached),
    };
    const noBody = {...spec} as Partial<CharacterSpec>;
    delete noBody.body;
    const result = await assembly.setCharacter(noBody as CharacterSpec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CMP_BODY_MISSING');
    expect(assembly.body).toBe(before.body);
    expect([...assembly.parts.values()].map(p => p.attached)).toEqual(
      before.parts,
    );
    expect(assembly.spec).toBe(spec);
  });

  it('AC-CMP-033.1: changing only tints.hair loads and rebinds nothing and takes < 16 ms', async () => {
    const {assembly, registry, spec} = await built();
    const resolves = registry.resolveCalls.length;
    const fetches = registry.inner.loader.fetchCount;
    const logLength = assembly.log.length;
    const skeleton = assembly.body?.skeleton;
    const start = performance.now();
    const result = await assembly.setCharacter(
      withSpec(spec, {tints: {...spec.tints, hair: '#112233'}}),
    );
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    expect(registry.resolveCalls.length).toBe(resolves);
    expect(registry.inner.loader.fetchCount).toBe(fetches);
    expect(assembly.log.slice(logLength)).toEqual(['tint:hair']);
    expect(assembly.body?.skeleton).toBe(skeleton);
    expect(assembly.tints.hair.value.equals(new Color('#112233'))).toBe(true);
    expect(elapsed).toBeLessThan(16);
  });

  it('AC-CMP-013.1: two parts mapped to primary update through one uniform, no reload', async () => {
    const base = fixtureSpec();
    const {assembly, registry} = await built(
      withSpec(base, {body: {ref: ref('fixture-body-primary')}}),
    );
    const primaryMaterials = (): Material[] => {
      const out: Material[] = [];
      for (const slot of ['body', 'torso']) {
        const object = assembly.parts.get(slot)?.attached.object as Object3D;
        for (const mesh of meshes(object)) {
          const m = mesh.material as Material;
          if (m.userData[TINT_SLOT_USER_DATA] === 'primary') out.push(m);
        }
      }
      return out;
    };
    const before = primaryMaterials();
    // One material per part (body + shirt) is mapped to primary.
    expect(before.length).toBe(2);
    const resolves = registry.resolveCalls.length;
    const spec = assembly.spec as CharacterSpec;
    const result = await assembly.setCharacter(
      withSpec(spec, {tints: {...spec.tints, primary: '#3a5fcd'}}),
    );
    expect(result.ok).toBe(true);
    expect(registry.resolveCalls.length).toBe(resolves);
    // Same materials (no rebuild, no recompile); the shared uniform holds the new color.
    expect(primaryMaterials()).toEqual(before);
    expect(assembly.tints.primary.value.equals(new Color('#3a5fcd'))).toBe(
      true,
    );
  });

  it('REQ-CMP-033: toggling and swapping an outfit part keeps the same Skeleton object', async () => {
    const {assembly, registry, spec} = await built();
    const skeleton = assembly.body?.skeleton;
    const bones = assembly.body?.bones;
    const bodyAttached = assembly.parts.get('body')?.attached;
    const noShirt = withSpec(spec, {
      parts: {'prop-main-hand': spec.parts['prop-main-hand']!},
    });
    let logLength = assembly.log.length;
    expect((await assembly.setCharacter(noShirt)).ok).toBe(true);
    expect(assembly.log.slice(logLength)).toEqual(['part:detach:torso']);
    expect(assembly.parts.has('torso')).toBe(false);

    const resolves = registry.resolveCalls.length;
    logLength = assembly.log.length;
    const shirtB = withSpec(spec, {
      parts: {...spec.parts, torso: {ref: ref('fixture-shirt-b')}},
    });
    expect((await assembly.setCharacter(shirtB)).ok).toBe(true);
    // Only the changed part is resolved and attached.
    expect(registry.resolveCalls.slice(resolves)).toEqual([
      ref('fixture-shirt-b'),
    ]);
    expect(assembly.log.slice(logLength)).toEqual(['part:attach:torso']);
    expect(assembly.body?.skeleton).toBe(skeleton);
    expect(assembly.body?.bones).toBe(bones);
    expect(assembly.parts.get('body')?.attached).toBe(bodyAttached);
    expect(assembly.log.filter(e => e.startsWith('body:rebuild'))).toHaveLength(
      1,
    );
  });

  it('REQ-CMP-037: a body switch to another skeleton group rebuilds the skeleton and drops the old clip cache', async () => {
    const {assembly, spec} = await built();
    expect((await assembly.setClip(ref('fixture-clip'), 'metadata')).ok).toBe(
      true,
    );
    const oldPlayer = assembly.player;
    const oldSkeleton = assembly.body?.skeleton;
    const oldRoot = assembly.body?.root;
    expect(oldPlayer?.log).toContain('retarget:miss');

    const result = await assembly.setCharacter(
      withSpec(spec, {body: {ref: ref('fixture-body-b')}}),
    );
    expect(result.ok).toBe(true);
    expect(assembly.body?.skeletonGroupId).toBe('fixture-b');
    expect(assembly.body?.skeleton).not.toBe(oldSkeleton);
    expect(oldRoot?.parent).toBeNull();
    expect(assembly.log).toContain('clip-cache:invalidate:fixture-a');
    expect(assembly.log.at(-4)).toBe('body:rebuild:fixture-b');
    // A new player (fresh retarget cache) got the selected clip again.
    expect(assembly.player).not.toBe(oldPlayer);
    expect(assembly.player?.log[0]).toBe('retarget:miss');
    expect(assembly.player?.log).toContain(`source:${ref('fixture-clip')}`);
    // AC-CMP-037.1: local rest TRS equals the fixture-b rest pose.
    const rig = assembly.body!.rig;
    const restB = rig.skeletonGroups.find(g => g.id === 'fixture-b')!.restPose;
    assembly.player?.setClip(null, 'in-place');
    assembly.evaluate(0);
    const pelvis = bone(assembly, 'pelvis');
    expect(pelvis.position.y).toBeCloseTo(restB['pelvis']!.t[1], 6);
  });

  it('AC-CMP-033.2: a failed part load returns CMP_PART_LOAD_FAILED and keeps the previous character', async () => {
    const {assembly, spec} = await built();
    const shirt = assembly.parts.get('torso')?.attached;
    const skeleton = assembly.body?.skeleton;
    const result = await assembly.setCharacter(
      withSpec(spec, {
        parts: {...spec.parts, torso: {ref: ref('fixture-missing')}},
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CMP_PART_LOAD_FAILED');
    expect(assembly.spec).toBe(spec);
    expect(assembly.parts.get('torso')?.attached).toBe(shirt);
    expect(shirt?.object.parent).not.toBeNull();
    expect(assembly.body?.skeleton).toBe(skeleton);

    // Same on a body change: the failing part aborts the rebuild before anything changes.
    const failed = await assembly.setCharacter(
      withSpec(spec, {
        body: {ref: ref('fixture-body-b')},
        parts: {torso: {ref: ref('fixture-missing')}},
      }),
    );
    expect(failed.ok).toBe(false);
    expect(assembly.body?.skeleton).toBe(skeleton);
    expect(assembly.body?.skeletonGroupId).toBe('fixture-a');
    expect(assembly.parts.get('torso')?.attached).toBe(shirt);
  });

  it('REQ-CMP-003: a part in a slot it does not declare fails with CMP_SLOT_MISMATCH', async () => {
    const {assembly, spec} = await built();
    const result = await assembly.setCharacter(
      withSpec(spec, {
        parts: {...spec.parts, feet: {ref: ref('fixture-shirt')}},
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CMP_SLOT_MISMATCH');
    expect(assembly.parts.has('feet')).toBe(false);
  });

  it('REQ-CMP-011: hides of equipped parts set the region mask; unequip shows the region again', async () => {
    const {assembly, spec} = await built();
    expect(assembly.regionMask.value).toBe(regionMaskOf(['torso']));
    await assembly.setCharacter(withSpec(spec, {parts: {}}));
    expect(assembly.regionMask.value).toBe(0);
  });

  it('AC-ANA-011.1: anatomy changes do not resolve or rebind and p95 < 16 ms', async () => {
    // Fixture character has 3 parts; the 8-part perf fixture lands with the M3 slider work.
    const {assembly, registry, spec} = await built();
    const resolves = registry.resolveCalls.length;
    const skeleton = assembly.body?.skeleton;
    const times: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const head = 1 + (0.5 * i) / 120;
      const start = performance.now();
      await assembly.setCharacter(
        withSpec(spec, {anatomy: {...spec.anatomy, head}}),
      );
      assembly.evaluate(0);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    expect(p95).toBeLessThan(16);
    expect(registry.resolveCalls.length).toBe(resolves);
    expect(assembly.body?.skeleton).toBe(skeleton);
    expect(bone(assembly, 'Head').scale.x).toBeCloseTo(1.5, 6);
  });

  it('AC-ANA-006.1 (proxy): torso part and body deform with the same per-bone transforms at torsoWidth 1.3', async () => {
    const {assembly, spec} = await built();
    await assembly.setCharacter(
      withSpec(spec, {anatomy: {...spec.anatomy, torsoWidth: 1.3}}),
    );
    assembly.evaluate(0);
    const [bodyMesh] = skinnedMeshes(
      assembly.parts.get('body')?.attached.object as Object3D,
    );
    const [shirtMesh] = skinnedMeshes(
      assembly.parts.get('torso')?.attached.object as Object3D,
    );
    if (bodyMesh === undefined || shirtMesh === undefined)
      throw new Error('no skinned meshes');
    // No per-part data: both skeletons reference the same Bone objects.
    const bodyInverse = new Map<string, Matrix4>();
    bodyMesh.skeleton.bones.forEach((b, i) =>
      bodyInverse.set(b.name, bodyMesh.skeleton.boneInverses[i] as Matrix4),
    );
    for (const b of shirtMesh.skeleton.bones) {
      expect(bodyMesh.skeleton.bones).toContain(b);
    }
    // Every shirt vertex deformed by the shirt skin equals the same bind-space point deformed
    // by the body's skinning matrices (same weights): the gap is far below 0.5 px at 64 px.
    const position = shirtMesh.geometry.getAttribute('position');
    const skinIndex = shirtMesh.geometry.getAttribute('skinIndex');
    const skinWeight = shirtMesh.geometry.getAttribute('skinWeight');
    const viaShirt = new Vector3();
    const viaBody = new Vector3();
    const bind = new Vector3();
    const term = new Vector3();
    const m = new Matrix4();
    let maxGap = 0;
    for (let i = 0; i < position.count; i++) {
      viaShirt.fromBufferAttribute(position, i);
      shirtMesh.applyBoneTransform(i, viaShirt);
      bind.fromBufferAttribute(position, i).applyMatrix4(shirtMesh.bindMatrix);
      viaBody.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w === 0) continue;
        const b = shirtMesh.skeleton.bones[
          skinIndex.getComponent(i, k)
        ] as Bone;
        m.multiplyMatrices(b.matrixWorld, bodyInverse.get(b.name) as Matrix4);
        viaBody.addScaledVector(term.copy(bind).applyMatrix4(m), w);
      }
      viaBody.applyMatrix4(shirtMesh.bindMatrixInverse);
      maxGap = Math.max(maxGap, viaShirt.distanceTo(viaBody));
    }
    // 0.5 output px at 64 px over the 2.2 m preview frame is ~0.017 m.
    expect(maxGap).toBeLessThan(1e-5);
  });

  it('spec 002 order: evaluate is absolute, repeatable, grounded and places sockets after anatomy', async () => {
    const {assembly, spec} = await built();
    await assembly.setClip(ref('fixture-clip'), 'metadata');
    const anatomy = {
      ...spec.anatomy,
      legLength: 0.7,
      feet: 1.5,
      hands: 1.75,
      armLength: 1.2,
    };
    await assembly.setCharacter(withSpec(spec, {anatomy}));
    assembly.evaluate(0.2);
    assembly.evaluate(0.7);
    const afterHistory = boneMatrices(assembly);
    assembly.evaluate(0.9);
    assembly.evaluate(0.7);
    assembly.evaluate(0.7);
    // REQ-ANM-008 / AC-ANA-009.2: no accumulation (anatomy scales are not re-multiplied).
    expect(boneMatrices(assembly)).toEqual(afterHistory);
    // Step 4: ground offset from the bind pose with anatomy.
    expect(assembly.body?.root.position.y).toBe(
      computeGroundOffset(assembly.anatomy!, anatomy),
    );
    // Step 5 after step 3: the sword wrapper sits on hand_r with unit world scale.
    const sword = assembly.parts.get('prop-main-hand')?.attached
      .object as Object3D;
    const hand = new Vector3().setFromMatrixPosition(
      bone(assembly, 'hand_r').matrixWorld,
    );
    const grip = new Vector3().setFromMatrixPosition(sword.matrixWorld);
    expect(grip.distanceTo(hand)).toBeLessThan(1e-6);
    const scale = new Vector3().setFromMatrixScale(sword.matrixWorld);
    expect(scale.x).toBeCloseTo(1, 6);
    // Step 1: the clip is sampled (the pose differs between two times).
    assembly.evaluate(0.25);
    expect(boneMatrices(assembly)).not.toEqual(afterHistory);
  });

  it('AC-ANM-014.1: in-place resolves the in-place variant before it reaches the player', async () => {
    const {assembly, registry} = await built();
    const result = await assembly.setClip(ref('fixture-clip'));
    expect(result.ok).toBe(true);
    expect(registry.resolveClipCalls).toEqual([ref('fixture-clip-ip')]);
    expect(assembly.player?.log.at(-1)).toBe(
      `source:${ref('fixture-clip-ip')}`,
    );
  });

  it('REQ-ANM-008: evaluate allocates nothing per frame once anatomy is evaluated', async () => {
    const {assembly} = await built();
    await assembly.setClip(ref('fixture-clip'), 'metadata');
    for (let i = 0; i < 2000; i++) assembly.evaluate((i % 100) / 100);
    const gc = (globalThis as {gc?: () => void}).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 50_000; i++) assembly.evaluate((i % 100) / 100);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(
      8 * 1024 * 1024,
    );
  });

  it('dispose detaches everything and restores the registry-owned materials', async () => {
    const {assembly} = await built();
    const shirt = assembly.parts.get('torso')!.part;
    assembly.dispose();
    expect(assembly.root.children).toHaveLength(0);
    expect(assembly.parts.size).toBe(0);
    for (const mesh of meshes(shirt.scene)) {
      expect(
        (mesh.material as Material).userData[TINT_SLOT_USER_DATA],
      ).toBeUndefined();
    }
  });
});
