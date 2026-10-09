import {beforeAll, describe, expect, it} from 'vitest';
import {
  Bone,
  Euler,
  Group,
  Matrix4,
  Quaternion,
  Skeleton,
  Vector3,
} from 'three';
import type {Mesh, Object3D} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {
  TINT_SLOTS,
  partEntrySchema,
  rigDefinitionSchema,
} from '@csg/parts-schema';
import type {
  AssetRef,
  HexColor,
  TintSlot,
  PartEntry,
  PartSocket,
  RigDefinition,
} from '@csg/parts-schema';
import type {BodySkeleton} from '../contracts/composition';
import type {LoadedPartInternal} from '../contracts/registry';
import type {RestPose} from '../retarget/types';
import {attachStaticPart} from './attach-static-part';
import {
  applyTintMaterial,
  createTintUniforms,
  restoreMaterials,
} from './tint-material';
import {
  resolveSocketBone,
  resolveSocketJoint,
  socketBindingOf,
  socketInheritsScale,
  updateSockets,
} from './sockets';

// The engine package has no @types/node: load node:fs through an untyped specifier.
interface Fs {
  readFileSync(path: URL): Uint8Array;
  readFileSync(path: URL, encoding: 'utf8'): string;
}
const FS_MODULE = 'node:fs';
const FIXTURES = new URL('../../test/fixtures/', import.meta.url);

let fs: Fs;
let rig: RigDefinition;
let swordEntry: PartEntry;
let swordScene: Group;

async function parseGlb(bytes: Uint8Array): Promise<Group> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return gltf.scene;
}

beforeAll(async () => {
  fs = (await import(/* @vite-ignore */ FS_MODULE)) as Fs;
  rig = rigDefinitionSchema.parse(
    JSON.parse(
      fs.readFileSync(new URL('rigs/fixture-ue5-22.json', FIXTURES), 'utf8'),
    ),
  );
  const manifest = JSON.parse(
    fs.readFileSync(new URL('pack/manifest.json', FIXTURES), 'utf8'),
  ) as {parts: unknown[]};
  const raw = manifest.parts.find(
    p => (p as {id?: unknown}).id === 'fixture-sword',
  );
  swordEntry = partEntrySchema.parse(raw);
  swordScene = await parseGlb(
    fs.readFileSync(new URL('pack/parts/fixture-sword.glb', FIXTURES)),
  );
});

/**
 * In-test character skeleton built from the `fixture-a` rest pose (independent of M1-21's
 * `createBodySkeleton`): a container group holding the root bone.
 */
function buildBody(
  r: RigDefinition = rig,
  skip: readonly string[] = [],
): BodySkeleton {
  const group = r.skeletonGroups.find(g => g.id === 'fixture-a');
  if (group === undefined) throw new Error('fixture-a missing');
  const root = new Group();
  root.name = 'character';
  const bones = new Map<string, Bone>();
  const list: Bone[] = [];
  for (const name of r.bones) {
    if (skip.includes(name)) continue;
    const rest = group.restPose[name];
    if (rest === undefined) throw new Error(`no rest for ${name}`);
    const bone = new Bone();
    bone.name = name;
    bone.position.fromArray(rest.t);
    bone.quaternion.fromArray(rest.r);
    bone.scale.fromArray(rest.s);
    const parentName = r.parents[name];
    const parent =
      parentName === null || parentName === undefined
        ? undefined
        : bones.get(parentName);
    (parent ?? root).add(bone);
    bones.set(name, bone);
    list.push(bone);
  }
  root.updateMatrixWorld(true);
  return {
    rig: r,
    skeletonGroupId: 'fixture-a',
    rest: {} as RestPose,
    root,
    bones,
    skeleton: new Skeleton(list),
  };
}

function part(entry: PartEntry = swordEntry): LoadedPartInternal {
  return {
    ref: `builtin:fixture-pack/${entry.id}` as AssetRef,
    entry,
    rig,
    scene: swordScene,
  };
}

function socketOf(entry: PartEntry): PartSocket {
  if (entry.socket === undefined) throw new Error('no socket');
  return entry.socket;
}

function hatSocket(inheritScale?: boolean): PartSocket {
  return {
    bone: 'head',
    offset: {
      position: [0, 0.12, 0.03],
      rotationDeg: [0, 90, 0],
      scale: [1, 1, 1],
    },
    ...(inheritScale === undefined ? {} : {inheritScale}),
  };
}

function worldOf(o: Object3D): {
  pos: Vector3;
  rot: Quaternion;
  scale: Vector3;
} {
  const pos = new Vector3();
  const rot = new Quaternion();
  const scale = new Vector3();
  o.matrixWorld.decompose(pos, rot, scale);
  return {pos, rot, scale};
}

function expectVec(actual: Vector3, expected: Vector3, eps: number): void {
  expect(actual.distanceTo(expected)).toBeLessThanOrEqual(eps);
}

function attachOk(
  body: BodySkeleton,
  socket: PartSocket,
  p: LoadedPartInternal = part(),
) {
  const res = attachStaticPart(p, body, socket);
  if (!res.ok) throw new Error(res.error.message);
  return res.value;
}

/** Simulates anatomy: scales the bones and returns the matching AnatomyScales. */
function scaleJoints(
  body: BodySkeleton,
  factors: Record<string, number>,
): Map<string, Vector3> {
  const scales = new Map<string, Vector3>();
  for (const [joint, f] of Object.entries(factors)) {
    const v = new Vector3(f, f, f);
    body.bones.get(joint)?.scale.copy(v);
    scales.set(joint, v);
  }
  return scales;
}

describe('composition: socket resolution (REQ-ANA-019, REQ-ANA-020)', () => {
  it('AC-ANA-019.1: socket head resolves to joint Head through socketBones', () => {
    const joint = resolveSocketJoint(rig, 'head');
    expect(joint).toEqual({ok: true, value: 'Head'});
    const body = buildBody();
    const bone = resolveSocketBone(body, 'head');
    expect(bone.ok && bone.value.name).toBe('Head');
  });

  it('REQ-ANA-019: every fixture socket resolves to its mapped joint', () => {
    for (const [socket, joint] of Object.entries(rig.socketBones)) {
      expect(resolveSocketJoint(rig, socket as PartSocket['bone'])).toEqual({
        ok: true,
        value: joint,
      });
    }
  });

  it('REQ-ANA-019: never uses the socket ID as a joint name', () => {
    const body = buildBody();
    // A decoy bone literally named "head" must not be chosen.
    const decoy = new Bone();
    decoy.name = 'head';
    body.root.add(decoy);
    (body.bones as Map<string, Bone>).set('head', decoy);
    const res = attachOk(body, hatSocket());
    expect(res.object.parent?.name).toBe('Head');
  });

  it('REQ-ANA-019: an unmapped socket yields AST_RIG_MISMATCH', () => {
    const broken = {
      ...rig,
      socketBones: {...rig.socketBones, head: 'head'},
    } as RigDefinition;
    const res = resolveSocketJoint(broken, 'head');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('AST_RIG_MISMATCH');
      expect(res.error.details).toMatchObject({
        socket: 'head',
        missing: ['head'],
      });
    }
    const noEntry = {...rig, socketBones: {}} as unknown as RigDefinition;
    const res2 = resolveSocketJoint(noEntry, 'pelvis');
    expect(!res2.ok && res2.error.code).toBe('AST_RIG_MISMATCH');
  });

  it('REQ-ANA-020: a skeleton lacking the joint yields AST_RIG_MISMATCH with details.missing', () => {
    const body = buildBody(rig, ['hand_r']);
    const res = attachStaticPart(part(), body, socketOf(swordEntry));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('AST_RIG_MISMATCH');
      expect(res.error.details).toMatchObject({missing: ['hand_r']});
    }
  });

  it('REQ-ANA-007: inheritScale defaults to true for head only, explicit value wins', () => {
    expect(socketInheritsScale(hatSocket())).toBe(true);
    expect(socketInheritsScale(hatSocket(false))).toBe(false);
    expect(socketInheritsScale(socketOf(swordEntry))).toBe(false);
    for (const bone of ['hand_r', 'hand_l', 'spine_03', 'pelvis'] as const) {
      expect(socketInheritsScale({...hatSocket(), bone})).toBe(false);
    }
    expect(
      socketInheritsScale({...socketOf(swordEntry), inheritScale: true}),
    ).toBe(true);
  });
});

describe('composition: attachStaticPart (REQ-ANA-007, REQ-ANA-019)', () => {
  it('AC-ANA-019.1: hat on socket head is parented to Head at Head + offset', () => {
    const body = buildBody();
    const hat = attachOk(body, hatSocket());
    expect(hat.object.parent).toBe(body.bones.get('Head'));
    const head = worldOf(body.bones.get('Head') as Bone);
    const w = worldOf(hat.object);
    expectVec(w.pos, head.pos.clone().add(new Vector3(0, 0.12, 0.03)), 1e-6);
    expectVec(w.scale, new Vector3(1, 1, 1), 1e-6);
    const expectedRot = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    expect(Math.abs(w.rot.dot(expectedRot))).toBeCloseTo(1, 6);
  });

  it('AC-ANA-007.1: sword on hand_r with hands = 1.75 keeps world scale, grip at the joint', () => {
    const body = buildBody();
    const entry = partEntrySchema.parse({
      ...swordEntry,
      socket: {
        bone: 'hand_r',
        offset: {
          position: [0.02, -0.05, 0.01],
          rotationDeg: [10, 0, -20],
          scale: [1, 1, 1],
        },
      },
    });
    const sword = attachOk(body, socketOf(entry), part(entry));
    expect(sword.object.parent).toBe(body.bones.get('hand_r'));
    // Pose the arm and apply anatomy on the hand and its ancestors.
    body.bones
      .get('lowerarm_r')
      ?.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.6);
    const scales = scaleJoints(body, {hand_r: 1.75});
    body.bones.get('lowerarm_r')?.scale.set(1, 1.2, 1); // armLength-like ancestor scale
    updateSockets(body, [sword], scales);

    const hand = worldOf(body.bones.get('hand_r') as Bone);
    const w = worldOf(sword.object);
    expectVec(w.scale, new Vector3(1, 1, 1), 1e-6);
    // Grip = joint + R_joint * offset (offset scaled by 1.0), within 1e-4 m.
    const expectedRot = hand.rot
      .clone()
      .multiply(
        new Quaternion().setFromEuler(
          new Euler((10 * Math.PI) / 180, 0, (-20 * Math.PI) / 180, 'XYZ'),
        ),
      );
    expect(Math.abs(w.rot.dot(expectedRot))).toBeCloseTo(1, 6);
    const grip = new Vector3(0.02, -0.05, 0.01)
      .applyQuaternion(hand.rot)
      .add(hand.pos);
    expectVec(w.pos, grip, 1e-4);
    expect(
      Math.abs(
        new Vector3()
          .setFromMatrixColumn(sword.object.matrixWorld, 0)
          .length() - 1,
      ),
    ).toBeLessThan(1e-6);
  });

  it('AC-ANA-007.2: hat on head with head = 1.5 scales 1.5x and its offset 1.5x', () => {
    const body = buildBody();
    const hat = attachOk(body, hatSocket());
    const scales = scaleJoints(body, {Head: 1.5, hand_r: 1.75});
    updateSockets(body, [hat], scales);
    const head = worldOf(body.bones.get('Head') as Bone);
    const w = worldOf(hat.object);
    expectVec(w.scale, new Vector3(1.5, 1.5, 1.5), 1e-6);
    const offset = w.pos.clone().sub(head.pos);
    expectVec(offset, new Vector3(0, 0.12, 0.03).multiplyScalar(1.5), 1e-6);
  });

  it('AC-ANA-007.2: an explicit inheritScale=false on head keeps the hat size', () => {
    const body = buildBody();
    const hat = attachOk(body, hatSocket(false));
    updateSockets(body, [hat], scaleJoints(body, {Head: 1.5}));
    const head = worldOf(body.bones.get('Head') as Bone);
    const w = worldOf(hat.object);
    expectVec(w.scale, new Vector3(1, 1, 1), 1e-6);
    expectVec(w.pos.clone().sub(head.pos), new Vector3(0, 0.12, 0.03), 1e-6);
  });

  it('REQ-ANA-007: the character container scale applies to every prop', () => {
    const body = buildBody();
    body.root.scale.setScalar(2);
    const sword = attachOk(body, socketOf(swordEntry));
    updateSockets(body, [sword], scaleJoints(body, {hand_r: 1.75}));
    expectVec(worldOf(sword.object).scale, new Vector3(2, 2, 2), 1e-6);
  });

  it('REQ-ANA-007: updateSockets is deterministic (bit-identical matrices)', () => {
    const run = (): number[] => {
      const body = buildBody();
      const hat = attachOk(body, hatSocket());
      updateSockets(body, [hat], scaleJoints(body, {Head: 1.37}));
      return [...hat.object.matrixWorld.elements];
    };
    expect(run()).toEqual(run());
  });

  it('clones the part scene; setVisible toggles; dispose detaches idempotently', () => {
    const body = buildBody();
    const sword = attachOk(body, socketOf(swordEntry));
    expect(sword.object.name).toBe('socket:hand_r');
    expect(sword.object.children).toHaveLength(1);
    expect(sword.object.children[0]).not.toBe(swordScene);
    expect(swordScene.parent).toBeNull();
    sword.setVisible(false);
    expect(sword.object.visible).toBe(false);
    sword.setVisible(true);
    expect(sword.object.visible).toBe(true);
    expect(socketBindingOf(sword.object)?.joint).toBe('hand_r');

    sword.dispose();
    expect(sword.object.parent).toBeNull();
    expect(body.bones.get('hand_r')?.children).not.toContain(sword.object);
    expect(socketBindingOf(sword.object)).toBeUndefined();
    expect(() => sword.dispose()).not.toThrow();
    // Shared geometry stays usable for the registry cache.
    let meshes = 0;
    swordScene.traverse(o => {
      if ((o as {isMesh?: boolean}).isMesh === true) meshes++;
    });
    expect(meshes).toBeGreaterThan(0);
    // A disposed prop is ignored by updateSockets.
    expect(() => updateSockets(body, [sword], new Map())).not.toThrow();
  });

  it('throws on a non-static part (programmer error)', () => {
    const skinned = {...swordEntry, kind: 'skinned'} as PartEntry;
    expect(() =>
      attachStaticPart(part(skinned), buildBody(), socketOf(swordEntry)),
    ).toThrow(/expected static/);
  });

  it('matrix is computed, not auto-updated from TRS', () => {
    const body = buildBody();
    const sword = attachOk(body, socketOf(swordEntry));
    expect(sword.object.matrixAutoUpdate).toBe(false);
    const before = new Matrix4().copy(sword.object.matrixWorld);
    body.root.updateMatrixWorld(true);
    expect(sword.object.matrixWorld.equals(before)).toBe(true);
  });
});

describe('composition: static props follow re-tints (M2-16)', () => {
  it('REQ-CMP-013: a later applyTintMaterial / restoreMaterials on the part scene reaches the attached prop clone; dispose unlinks', () => {
    const body = buildBody();
    const scene = swordScene.clone(true);
    const p: LoadedPartInternal = {...part(), scene};
    const prop = attachOk(body, hatSocket(), p);
    const propMeshes = (): Mesh[] => {
      const out: Mesh[] = [];
      prop.object.traverse(o => {
        if ((o as Partial<Mesh>).isMesh === true) out.push(o as Mesh);
      });
      return out;
    };
    const sourceMeshes: Mesh[] = [];
    scene.traverse(o => {
      if ((o as Partial<Mesh>).isMesh === true) sourceMeshes.push(o as Mesh);
    });
    const originals = sourceMeshes.map(m => m.material);
    expect(propMeshes().length).toBe(sourceMeshes.length);
    expect(sourceMeshes.length).toBeGreaterThan(0);

    const tints = createTintUniforms(
      Object.fromEntries(TINT_SLOTS.map(s => [s, '#ffffff'])) as Record<
        TintSlot,
        HexColor
      >,
    );
    applyTintMaterial(p, p.entry.tintSlots, tints);
    propMeshes().forEach((m, i) => {
      expect(m.material).toBe((sourceMeshes[i] as Mesh).material);
      expect(m.material).not.toBe(originals[i]);
    });
    restoreMaterials(scene);
    propMeshes().forEach((m, i) => expect(m.material).toBe(originals[i]));

    const clones = propMeshes();
    prop.dispose();
    applyTintMaterial(p, p.entry.tintSlots, tints);
    clones.forEach((m, i) => expect(m.material).toBe(originals[i]));
    restoreMaterials(scene);
  });
});
