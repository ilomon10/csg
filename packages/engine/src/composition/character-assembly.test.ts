import {describe, expect, it} from 'vitest';
import {Color, Matrix4, Vector3} from 'three';
import type {Bone, Material, Mesh, Object3D, SkinnedMesh} from 'three';
import {
  BODY_REGIONS,
  V1_SLOT_IDS,
  defaultRenderSettings,
  slotRegistrySchema,
} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import {computeGroundOffset} from '../anatomy/apply';
import {
  INTERPOLANT_BYTES_PER_CALL,
  heapGrowthPerCall,
} from '../animation/test-heap';
import {ENGINE_DISPOSED, createCharacterAssembly} from './character-assembly';
import type {AssemblyRegistry, CharacterAssembly} from './character-assembly';
import {createTestRegistry, fixtureSpec, ref} from './assembly-test-env';
import type {TestRegistry} from './assembly-test-env';
import {REGION_ID_ATTRIBUTE, isRegionHidden, regionMaskOf} from './region-mask';
import {TINT_SLOT_USER_DATA} from './tint-material';
import {SettingsBinder} from '../pipeline/settings-binder';
import {
  PART_ID_USER_DATA,
  TOON_MATERIAL_USER_DATA,
} from '../pipeline/toon-material';

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

  it('REQ-ANM-008: evaluate (clip, anatomy, ground, sockets) allocates nothing per frame', async () => {
    const {assembly, spec} = await built();
    await assembly.setClip(ref('fixture-clip'), 'metadata');
    // Non-default anatomy so every anatomy path (scales, root/pelvis, ground, props) runs.
    await assembly.setCharacter(
      withSpec(spec, {
        anatomy: {
          ...spec.anatomy,
          legLength: 1.2,
          head: 1.3,
          hands: 1.5,
          height: 1.1,
        },
      }),
    );
    const {bytesPerCall, limit} = heapGrowthPerCall(
      i => assembly.evaluate((i % 100) / 100),
      50_000,
      5_000,
      INTERPOLANT_BYTES_PER_CALL,
    );
    expect(bytesPerCall).toBeLessThan(limit);
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

/** A registry whose part and clip loads wait for `open()` (in-flight calls). */
function gatedRegistry() {
  const registry = createTestRegistry();
  let open!: () => void;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  let closed = false;
  const gated: AssemblyRegistry = {
    async resolve(r) {
      if (closed) await gate;
      return registry.resolve(r);
    },
    async resolveClip(r) {
      if (closed) await gate;
      return registry.resolveClip(r);
    },
    clipEntry: r => registry.clipEntry(r),
  };
  return {
    registry,
    gated,
    close: () => {
      closed = true;
    },
    open: () => open(),
  };
}

/** A registry that serves `builtin:fixture-pack/broken`: the fixture clip without a pelvis joint in its source rest pose (retargets only onto its own group). */
function brokenClipRegistry(): AssemblyRegistry & {inner: TestRegistry} {
  const inner = createTestRegistry();
  return {
    inner,
    resolve: r => inner.resolve(r),
    async resolveClip(r) {
      if (r !== ref('broken')) return inner.resolveClip(r);
      const loaded = await inner.resolveClip(ref('fixture-clip'));
      if (!loaded.ok) return loaded;
      return {
        ok: true,
        value: {
          ...loaded.value,
          ref: ref('broken'),
          source: {
            ...loaded.value.source,
            joints: loaded.value.source.joints.filter(j => j.name !== 'pelvis'),
          },
        },
      };
    },
    clipEntry: r =>
      inner.clipEntry(r === ref('broken') ? ref('fixture-clip') : r),
  };
}

describe('character assembly: dispose races (M1-31 M2)', () => {
  it('dispose during the first setCharacter returns ENGINE_DISPOSED and attaches nothing', async () => {
    const {gated, close, open, registry} = gatedRegistry();
    const assembly = createCharacterAssembly({registry: gated});
    close();
    const pending = assembly.setCharacter(fixtureSpec());
    // Let the serialized run reach the gated load.
    await Promise.resolve();
    await Promise.resolve();
    assembly.dispose();
    open();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ENGINE_DISPOSED);
    expect(assembly.root.children).toHaveLength(0);
    expect(assembly.parts.size).toBe(0);
    expect(assembly.body).toBeNull();
    // Registry-owned part scenes were never tinted.
    const body = await registry.resolve(ref('fixture-body'));
    if (!body.ok) throw new Error('fixture body');
    for (const mesh of meshes(body.value.scene)) {
      expect(
        (mesh.material as Material).userData[TINT_SLOT_USER_DATA],
      ).toBeUndefined();
    }
  });

  it('dispose during a part swap or a clip load returns ENGINE_DISPOSED; no unhandled rejection', async () => {
    const {gated, close, open} = gatedRegistry();
    const assembly = createCharacterAssembly({registry: gated});
    const spec = fixtureSpec();
    expect((await assembly.setCharacter(spec)).ok).toBe(true);
    close();
    const swap = assembly.setCharacter(
      withSpec(spec, {
        parts: {...spec.parts, torso: {ref: ref('fixture-shirt-b')}},
      }),
    );
    const clip = assembly.setClip(ref('fixture-clip'));
    await Promise.resolve();
    await Promise.resolve();
    assembly.dispose();
    open();
    const [a, b] = await Promise.all([swap, clip]);
    for (const r of [a, b]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(ENGINE_DISPOSED);
    }
    expect(assembly.parts.size).toBe(0);
    expect(assembly.root.children).toHaveLength(0);
  });

  it('setCharacter and setClip after dispose resolve to ENGINE_DISPOSED instead of throwing', async () => {
    const {assembly, spec} = await built();
    assembly.dispose();
    const a = await assembly.setCharacter(spec);
    const b = await assembly.setClip(ref('fixture-clip'));
    expect(a).toMatchObject({ok: false, error: {code: ENGINE_DISPOSED}});
    expect(b).toMatchObject({ok: false, error: {code: ENGINE_DISPOSED}});
  });
});

describe('character assembly: retarget failures are Results (M1-31 M5)', () => {
  it('REQ-ANM-022: setClip returns the retarget error and keeps the previous clip', async () => {
    const registry = brokenClipRegistry();
    const assembly = createCharacterAssembly({registry});
    // Body group fixture-a, clip group fixture-b: the clip must be retargeted.
    expect((await assembly.setCharacter(fixtureSpec())).ok).toBe(true);
    expect((await assembly.setClip(ref('fixture-clip'), 'metadata')).ok).toBe(
      true,
    );
    const source = assembly.player?.log.at(-1);
    const result = await assembly.setClip(ref('broken'), 'metadata');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AST_RIG_MISMATCH');
      expect(result.error.details).toMatchObject({
        ref: ref('broken'),
        reason: 'retarget',
        skeletonGroup: 'fixture-a',
      });
    }
    expect(
      assembly.player?.log.filter(l => l.startsWith('source:')).at(-1),
    ).toBe(source);
  });

  it('REQ-CMP-033 / REQ-ANM-022: a body switch whose skeleton the selected clip cannot retarget onto fails and keeps the previous character', async () => {
    const registry = brokenClipRegistry();
    const assembly = createCharacterAssembly({registry});
    const spec = withSpec(fixtureSpec(), {body: {ref: ref('fixture-body-b')}});
    expect((await assembly.setCharacter(spec)).ok).toBe(true);
    // Same skeleton group as the clip (fixture-b): no retarget needed, so it binds.
    expect((await assembly.setClip(ref('broken'), 'metadata')).ok).toBe(true);
    const skeleton = assembly.body?.skeleton;
    const player = assembly.player;
    const parts = [...assembly.parts.values()].map(p => p.attached);
    const result = await assembly.setCharacter(
      withSpec(spec, {body: {ref: ref('fixture-body')}}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AST_RIG_MISMATCH');
      expect(result.error.details).toMatchObject({reason: 'retarget'});
    }
    expect(assembly.spec).toBe(spec);
    expect(assembly.body?.skeleton).toBe(skeleton);
    expect(assembly.body?.skeletonGroupId).toBe('fixture-b');
    expect(assembly.player).toBe(player);
    expect([...assembly.parts.values()].map(p => p.attached)).toEqual(parts);
    for (const part of parts) expect(part.object.parent).not.toBeNull();
  });
});

describe('character assembly: region hides (REQ-AST-028)', () => {
  it('AC-AST-028.2 (engine part): with a torso part hiding torso, every body torso vertex is discarded by the shared mask node and no other region is', async () => {
    const {assembly} = await built();
    const torsoIndex = BODY_REGIONS.indexOf('torso');
    expect(assembly.regionMask.value).toBe(regionMaskOf(['torso']));
    const body = assembly.parts.get('body')?.attached.object as Object3D;
    const bodyMeshes = meshes(body);
    expect(bodyMeshes.length).toBeGreaterThan(0);
    let torsoVertices = 0;
    let otherVertices = 0;
    for (const mesh of bodyMeshes) {
      const material = mesh.material as Material & {maskNode?: unknown};
      // One TSL node material (no backend-specific GLSL/WGSL), so WebGPU and
      // WebGL2 compile the same discard condition from the same uniform.
      expect((material as {isNodeMaterial?: boolean}).isNodeMaterial).toBe(
        true,
      );
      expect(material.maskNode).toBeDefined();
      const nodes: unknown[] = [];
      (
        material.maskNode as {traverse(cb: (n: unknown) => void): void}
      ).traverse(n => nodes.push(n));
      expect(nodes).toContain(assembly.regionMask);
      const region = mesh.geometry.getAttribute(REGION_ID_ATTRIBUTE);
      expect(region.array).toBeInstanceOf(Float32Array);
      for (let i = 0; i < region.count; i++) {
        const id = region.getX(i);
        const hidden = isRegionHidden(assembly.regionMask.value, id);
        if (Math.round(id) === torsoIndex) {
          torsoVertices++;
          expect(hidden).toBe(true);
        } else {
          otherVertices++;
          expect(hidden).toBe(false);
        }
      }
    }
    expect(torsoVertices).toBeGreaterThan(0);
    expect(otherVertices).toBeGreaterThan(0);
  });
});

/** A registry whose part loads finish after `delayMs(ref)` (simulated network order). */
function delayedRegistry(delayMs: (r: string) => number): AssemblyRegistry {
  const inner = createTestRegistry();
  return {
    async resolve(r) {
      const result = await inner.resolve(r);
      await new Promise(resolve => setTimeout(resolve, delayMs(r)));
      return result;
    },
    resolveClip: r => inner.resolveClip(r),
    clipEntry: r => inner.clipEntry(r),
  };
}

/** `[mesh path, partId]` of every mesh under the root, in scene-graph order. */
function partIdTable(assembly: CharacterAssembly): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  assembly.root.traverse(o => {
    if ((o as Partial<Mesh>).isMesh !== true) return;
    const path: string[] = [];
    for (let p: Object3D | null = o; p !== null; p = p.parent)
      path.unshift(p.name);
    out.push([path.join('/'), o.userData[PART_ID_USER_DATA]]);
  });
  return out;
}

describe('character assembly: pixel pipeline integration (M2-16)', () => {
  it('AC-PIX-014.1: part IDs follow the slot order, not the order parts finish loading', async () => {
    const order = [
      ref('fixture-body'),
      ref('fixture-shirt'),
      ref('fixture-sword'),
    ];
    const loadedOrder: string[][] = [[], []];
    const tables = [];
    for (const [run, delays] of [
      [0, [1, 15, 30]],
      [1, [30, 15, 1]],
    ] as const) {
      const registry = delayedRegistry(r => delays[order.indexOf(r)] ?? 0);
      const wrapped: AssemblyRegistry = {
        ...registry,
        resolve: async r => {
          const result = await registry.resolve(r);
          loadedOrder[run]?.push(r);
          return result;
        },
      };
      const assembly = createCharacterAssembly({registry: wrapped});
      expect((await assembly.setCharacter(fixtureSpec())).ok).toBe(true);
      tables.push(partIdTable(assembly));
      expect(Object.fromEntries(assembly.partIds)).toEqual({
        body: 1,
        torso: 1 + V1_SLOT_IDS.indexOf('torso'),
        'prop-main-hand': 1 + V1_SLOT_IDS.indexOf('prop-main-hand'),
      });
      assembly.dispose();
    }
    // The loads really completed in opposite orders.
    expect(loadedOrder[1]).toEqual([...(loadedOrder[0] ?? [])].reverse());
    expect(tables[1]).toEqual(tables[0]);
    // Every mesh carries an ID; the body is 1, props come last.
    for (const [, id] of tables[0] ?? []) expect(id).toBeGreaterThanOrEqual(1);
  });

  it('REQ-PIX-014: a custom slot registry order drives the IDs; unknown slots follow sorted', async () => {
    const registry = createTestRegistry();
    const slots = slotRegistrySchema.parse({
      format: 'sprite-slot-registry',
      version: 1,
      slots: [
        {
          id: 'body',
          label: 'b',
          order: 0,
          kinds: ['skinned'],
          required: true,
          randomize: {emptyChance: 0},
        },
        {
          id: 'prop-main-hand',
          label: 'p',
          order: 1,
          kinds: ['static'],
          required: false,
          defaultSocket: 'hand_r',
          randomize: {emptyChance: 0},
        },
        {
          id: 'torso',
          label: 't',
          order: 2,
          kinds: ['skinned'],
          required: false,
          randomize: {emptyChance: 0},
        },
      ],
    });
    const assembly = createCharacterAssembly({registry, slots});
    expect((await assembly.setCharacter(fixtureSpec())).ok).toBe(true);
    expect(Object.fromEntries(assembly.partIds)).toEqual({
      body: 1,
      'prop-main-hand': 2,
      torso: 3,
    });
    assembly.dispose();
  });

  it('REQ-PIX-011, REQ-PIX-014: with TintMaterialOptions every mesh, the static prop included, gets a toon material and a part ID; setMaterialOptions switches back', async () => {
    const binder = new SettingsBinder(defaultRenderSettings());
    const registry = createTestRegistry();
    const assembly = createCharacterAssembly({
      registry,
      material: {binder, backend: 'webgl2', mode: 'export'},
    });
    expect((await assembly.setCharacter(fixtureSpec())).ok).toBe(true);
    const toonKinds = () =>
      meshes(assembly.root).map(m => ({
        toon: (m.material as Material).userData[TOON_MATERIAL_USER_DATA],
        id: m.userData[PART_ID_USER_DATA],
      }));
    const sword = assembly.parts.get('prop-main-hand')!;
    expect(sword.part.entry.kind).toBe('static');
    expect(meshes(sword.attached.object).length).toBeGreaterThan(0);
    for (const m of meshes(sword.attached.object)) {
      expect((m.material as Material).userData[TOON_MATERIAL_USER_DATA]).toBe(
        'toon',
      );
    }
    for (const k of toonKinds()) {
      expect(k.toon).toBe('toon');
      expect(k.id).toBeGreaterThanOrEqual(1);
    }
    assembly.setMaterialOptions(undefined);
    for (const k of toonKinds()) expect(k.toon).toBeUndefined();
    expect(assembly.log).toContain('materials:unlit');
    assembly.dispose();
    binder.dispose();
  });

  it('exposes the held clip duration', async () => {
    const {assembly} = await built();
    expect(assembly.clipDurationSec).toBeNull();
    expect((await assembly.setClip(ref('fixture-clip'))).ok).toBe(true);
    expect(assembly.clipDurationSec).toBe(1);
    assembly.dispose();
  });
});
