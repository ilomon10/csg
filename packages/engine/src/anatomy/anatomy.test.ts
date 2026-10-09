import {
  BufferGeometry,
  Matrix4,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from 'three';
import {describe, expect, it} from 'vitest';
import {defaultAnatomy} from '@csg/parts-schema';
import type {AnatomyParams, RigDefinition} from '@csg/parts-schema';
import type {AnatomyBinding} from '../contracts/anatomy';
import type {BodySkeleton} from '../contracts/composition';
import {restWorldMatrices} from '../rig';
import {
  anatomySkinScales,
  applyAnatomy,
  applyAnatomyToPose,
  applyAnatomyToSkins,
  computeGroundOffset,
  createAnatomyBinding,
  resetBodyToRest,
  socketPropScale,
} from './index';
import {heapGrowthPerCall} from '../animation/test-heap';
import {createTestBody, loadFixtureRig} from './test-skeleton';

// Spec ACs say `g-a`/`g-b`; the fixtures use `fixture-a`/`fixture-b` (same meaning).
const rig = loadFixtureRig('fixture-ue5-22.json');
const rigX = loadFixtureRig('fixture-ue5-22-x.json');

function bind(r: RigDefinition, group = 'fixture-a') {
  const body = createTestBody(r, group);
  const res = createAnatomyBinding(r, body);
  if (!res.ok) throw new Error(res.error.message);
  return {body, binding: res.value};
}

function params(over: Partial<AnatomyParams> = {}): AnatomyParams {
  return {...defaultAnatomy(), ...over};
}

/** The binding and values the bones were last posed with (skin scales of {@link skinWorld}). */
let posed: {binding: AnatomyBinding; p: AnatomyParams} | null = null;

/** `applyAnatomyToPose`, remembering the values for {@link skinWorld}. */
function applyPose(binding: AnatomyBinding, p: AnatomyParams) {
  applyAnatomyToPose(binding, p);
  posed = {binding, p};
}

/** Bind pose with anatomy applied; returns world matrices via three. */
function pose(body: BodySkeleton, binding: AnatomyBinding, p: AnatomyParams) {
  resetBodyToRest(binding);
  applyPose(binding, p);
  body.root.updateMatrixWorld(true);
}

/**
 * The world matrix that skins a joint's geometry: the bone's world matrix
 * times its own-frame anatomy skin scale (what `applyAnatomyToSkins` folds
 * into the inverse bind matrices).
 */
function skinWorld(body: BodySkeleton, name: string): Matrix4 {
  const m = (body.bones.get(name)?.matrixWorld as Matrix4).clone();
  const s =
    posed === null
      ? undefined
      : anatomySkinScales(posed.binding, posed.p).get(name);
  return s === undefined
    ? m
    : m.multiply(new Matrix4().makeScale(s.x, s.y, s.z));
}

function worldPos(body: BodySkeleton, name: string): Vector3 {
  return new Vector3().setFromMatrixPosition(
    body.bones.get(name)?.matrixWorld as Matrix4,
  );
}

/** World scale (column lengths) of the geometry skinned to a joint. */
function worldScale(body: BodySkeleton, name: string): Vector3 {
  return new Vector3().setFromMatrixScale(skinWorld(body, name));
}

/** World axes (unit) of the geometry skinned to a joint. */
function axes(body: BodySkeleton, name: string): Vector3[] {
  const e = skinWorld(body, name).elements;
  return [0, 4, 8].map(o => new Vector3(e[o], e[o + 1], e[o + 2]).normalize());
}

describe('AC-ANA-001.3 (proxy: bone matrices)', () => {
  it('defaults give unit scales, rest bone matrices and zero ground offset', () => {
    const {body, binding} = bind(rig);
    const p = params();
    for (const s of applyAnatomy(binding, p).values()) {
      expect(s.toArray()).toEqual([1, 1, 1]);
    }
    pose(body, binding, p);
    const fk = restWorldMatrices(body.rest);
    for (const j of body.rest.joints) {
      const m = (body.bones.get(j.name)?.matrixWorld as Matrix4).elements;
      const f = fk.get(j.name) as Float64Array;
      for (let i = 0; i < 16; i++) expect(m[i]).toBeCloseTo(f[i] as number, 12);
    }
    expect(computeGroundOffset(binding, p)).toBe(0);
  });
});

describe('AC-ANA-002.1: anatomyBones is data', () => {
  it('only the joints listed for hands change', () => {
    const custom: RigDefinition = {
      ...rig,
      anatomyBones: {...rig.anatomyBones, hands: ['hand_l']},
    };
    const {body, binding} = bind(custom);
    pose(body, binding, params({hands: 1.5}));
    expect(worldScale(body, 'hand_l').toArray()).toEqual([1.5, 1.5, 1.5]);
    for (const j of body.rest.joints) {
      if (j.name === 'hand_l') continue;
      expect(worldScale(body, j.name).x).toBeCloseTo(1, 4);
    }
  });

  it('a listed joint missing from the skeleton is AST_RIG_MISMATCH (case-sensitive)', () => {
    const custom: RigDefinition = {
      ...rig,
      anatomyBones: {...rig.anatomyBones, head: ['head']},
    };
    const res = createAnatomyBinding(custom, createTestBody(rig, 'fixture-a'));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('AST_RIG_MISMATCH');
    expect(res.error.details).toEqual({missing: ['head']});
  });
});

describe('AC-ANA-003.1: length compensation', () => {
  it.each(['fixture-a', 'fixture-b'])(
    'armLength 1.2 stretches the elbow 1.2x and leaves hand scale (%s)',
    group => {
      const {body, binding} = bind(rig, group);
      const rest0 = worldPos(body, 'lowerarm_l').distanceTo(
        worldPos(body, 'upperarm_l'),
      );
      pose(body, binding, params({armLength: 1.2}));
      const d = worldPos(body, 'lowerarm_l').distanceTo(
        worldPos(body, 'upperarm_l'),
      );
      expect(d / rest0).toBeCloseTo(1.2, 4);
      // The hand is not in armLength: its world scale is unchanged, also under
      // fixture-b's rotated arm bones (Rz 10 deg): segment-scale compensation
      // never lets a joint's own scale reach a child's frame.
      const handScale = worldScale(body, 'hand_l');
      const tol = 9;
      for (const k of ['x', 'y', 'z'] as const) {
        expect(handScale[k]).toBeCloseTo(1, tol);
      }
      // A listed child carries only its own factor, not the parent's on top.
      expect(worldScale(body, 'lowerarm_l').y).toBeCloseTo(1.2, tol);
    },
  );
});

describe('AC-ANA-003.2: torsoWidth compensation', () => {
  it.each(['fixture-a', 'fixture-b'])(
    'neck, Head and clavicles keep scale 1 with no shear, also at extremes (%s)',
    group => {
      const {body, binding} = bind(rig, group);
      const extremes: Partial<AnatomyParams>[] = [
        {torsoWidth: 1.4},
        {
          height: 0.8,
          head: 0.8,
          torsoWidth: 0.8,
          shoulders: 0.8,
          armLength: 0.75,
          legLength: 0.7,
          hands: 0.75,
          feet: 0.75,
          limbThickness: 0.75,
        },
        {
          height: 1.25,
          head: 2,
          torsoWidth: 1.4,
          shoulders: 1.4,
          armLength: 1.25,
          legLength: 1.3,
          hands: 1.75,
          feet: 1.75,
          limbThickness: 1.75,
        },
      ];
      for (const over of extremes) {
        pose(body, binding, params(over));
        for (const name of body.rest.joints.map(j => j.name)) {
          const e = (body.bones.get(name)?.matrixWorld as Matrix4).elements;
          expect(e.every(Number.isFinite)).toBe(true);
        }
        const only = over.head === undefined;
        for (const name of ['neck_01', 'Head', 'clavicle_l', 'clavicle_r']) {
          if (only)
            expect(worldScale(body, name).toArray()).toEqual(
              [1, 1, 1].map(() => expect.closeTo(1, 4)),
            );
        }
        const [x, y, z] = axes(body, 'Head') as [Vector3, Vector3, Vector3];
        expect(Math.abs(x.dot(y))).toBeLessThan(1e-4);
        expect(Math.abs(x.dot(z))).toBeLessThan(1e-4);
        expect(Math.abs(y.dot(z))).toBeLessThan(1e-4);
      }
    },
  );

  it('spine bones themselves widen on the cross-section axes only', () => {
    const {body, binding} = bind(rig);
    pose(body, binding, params({torsoWidth: 1.4}));
    for (const n of ['spine_01', 'spine_02', 'spine_03']) {
      expect(worldScale(body, n).toArray()).toEqual(
        [1.4, 1, 1.4].map(v => expect.closeTo(v, 4)),
      );
    }
  });
});

describe('AC-ANA-003.4: no shear at any rest or animated rotation (segment-scale compensation)', () => {
  const chibi = params({
    height: 0.85,
    head: 1.8,
    torsoWidth: 1.1,
    shoulders: 0.9,
    armLength: 0.75,
    legLength: 0.7,
    hands: 1.4,
    feet: 1.4,
    limbThickness: 1.4,
  });

  it.each(['fixture-a', 'fixture-b'])(
    'chibi with knees bent 90 deg and feet turned 70 deg: every joint is orthogonal and the feet are uniform (%s)',
    group => {
      const {body, binding} = bind(rig, group);
      resetBodyToRest(binding);
      // Animated rotations far from the rest (the Quaternius foot is rotated
      // 70 deg from its calf at rest; a walk bends the knee about 90 deg).
      for (const side of ['l', 'r']) {
        body.bones.get(`calf_${side}`)?.rotateX(Math.PI / 2);
        body.bones.get(`foot_${side}`)?.rotateX((70 * Math.PI) / 180);
        body.bones.get(`upperarm_${side}`)?.rotateZ(Math.PI / 3);
      }
      applyPose(binding, chibi);
      body.root.updateMatrixWorld(true);
      for (const j of body.rest.joints) {
        const [x, y, z] = axes(body, j.name) as [Vector3, Vector3, Vector3];
        expect({
          j: j.name,
          d: Math.max(
            Math.abs(x.dot(y)),
            Math.abs(x.dot(z)),
            Math.abs(y.dot(z)),
          ),
        }).toEqual({j: j.name, d: expect.closeTo(0, 9)});
      }
      for (const n of ['foot_l', 'foot_r', 'ball_l', 'ball_r']) {
        if (!body.bones.has(n)) continue;
        expect(worldScale(body, n).toArray()).toEqual(
          [1, 1, 1].map(() => expect.closeTo(0.85 * 1.4, 9)),
        );
      }
      for (const n of ['calf_l', 'thigh_r']) {
        expect(worldScale(body, n).toArray()).toEqual(
          [0.85 * 1.4, 0.85 * 0.7, 0.85 * 1.4].map(v => expect.closeTo(v, 9)),
        );
      }
    },
  );
});

describe("AC-ANA-003.3, AC-ANA-003.4: skin scales go into each mesh's own inverse bind matrices", () => {
  it('writes S(skin) * B^-1 per joint, keeps shared source matrices, and restores them exactly at default', () => {
    const {body, binding} = bind(rig);
    const bones = body.rest.joints.map(j => body.bones.get(j.name)!);
    const source = bones.map(b => b.matrixWorld.clone().invert());
    const sourceCopy = source.map(m => m.clone());
    const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
    // Same Matrix4 objects as the "registry" source, as attachSkinnedPart does.
    mesh.bind(new Skeleton(bones, [...source]), new Matrix4());
    body.root.add(mesh);
    const p = params({legLength: 0.7, limbThickness: 1.4, torsoWidth: 1.1});
    applyAnatomyToSkins(binding, p, body.root);
    const skins = anatomySkinScales(binding, p);
    bones.forEach((b, i) => {
      const s = skins.get(b.name) as Vector3;
      const expected = new Matrix4()
        .makeScale(s.x, s.y, s.z)
        .multiply(sourceCopy[i] as Matrix4);
      // Signed zeros aside (+0 normalizes them), the same products.
      expect(mesh.skeleton.boneInverses[i]?.elements.map(v => v + 0)).toEqual(
        expected.elements.map(v => v + 0),
      );
      expect(source[i]?.equals(sourceCopy[i] as Matrix4)).toBe(true);
    });
    expect(skins.get('calf_l')?.toArray()).toEqual([1.4, 0.7, 1.4]);
    expect(skins.get('foot_l')?.toArray()).toEqual([1, 1, 1]);
    applyAnatomyToSkins(binding, params(), body.root);
    bones.forEach((_, i) => {
      expect(mesh.skeleton.boneInverses[i]?.elements).toEqual(
        sourceCopy[i]?.elements,
      );
    });
    mesh.geometry.dispose();
    (mesh.material as MeshBasicMaterial).dispose();
  });
});

describe('AC-ANA-003.3: limbThickness compensation', () => {
  it('limb vertices move 1.5x away from the bone axis; hand and foot stay at scale 1', () => {
    const {body, binding} = bind(rig);
    const bone = body.bones.get('upperarm_l');
    // Rigid vertices skinned to upperarm_l, defined in the bind (rest) pose.
    const restW = restWorldMatrices(body.rest).get(
      'upperarm_l',
    ) as Float64Array;
    const inverseBind = new Matrix4()
      .fromArray(restW as unknown as number[])
      .invert();
    const vertices = [
      new Vector3(0.12 + 0.05, 0.9, 0.02),
      new Vector3(0.12 - 0.04, 0.75, -0.03),
    ];
    const axisDist = (v: Vector3, origin: Vector3) =>
      Math.hypot(v.x - origin.x, v.z - origin.z); // bone axis is world Y
    const before = vertices.map(v => axisDist(v, worldPos(body, 'upperarm_l')));
    pose(body, binding, params({limbThickness: 1.5}));
    expect(bone).toBeDefined();
    const skin = new Matrix4().multiplyMatrices(
      skinWorld(body, 'upperarm_l'),
      inverseBind,
    );
    vertices.forEach((v, i) => {
      const moved = v.clone().applyMatrix4(skin);
      const ratio =
        axisDist(moved, worldPos(body, 'upperarm_l')) / (before[i] as number);
      expect(ratio).toBeGreaterThan(1.485);
      expect(ratio).toBeLessThan(1.515);
    });
    for (const n of ['hand_l', 'hand_r', 'foot_l', 'foot_r']) {
      expect(worldScale(body, n).toArray()).toEqual(
        [1, 1, 1].map(() => expect.closeTo(1, 4)),
      );
    }
  });
});

describe('AC-ANA-004.1: propagating head', () => {
  it('hair vertices grow 1.8x around the Head joint; the neck is unchanged', () => {
    const {body, binding} = bind(rig);
    const head = worldPos(body, 'Head');
    const restW = restWorldMatrices(body.rest).get('Head') as Float64Array;
    const inverseBind = new Matrix4()
      .fromArray(restW as unknown as number[])
      .invert();
    const hair = [
      new Vector3(-0.1, 0.1, -0.1),
      new Vector3(0.1, 0.3, 0.1),
      new Vector3(0.0, 0.25, -0.12),
    ].map(v => v.add(head));
    const size = (pts: Vector3[]) => {
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      pts.forEach(p => {
        min.min(p);
        max.max(p);
      });
      return max.sub(min);
    };
    const neckBefore = worldPos(body, 'neck_01').clone();
    const neckM = body.bones.get('neck_01')?.matrixWorld.clone() as Matrix4;
    pose(body, binding, params({head: 1.8}));
    const skin = new Matrix4().multiplyMatrices(
      skinWorld(body, 'Head'),
      inverseBind,
    );
    const grown = hair.map(v => v.clone().applyMatrix4(skin));
    const a = size(hair);
    const b = size(grown);
    for (const k of ['x', 'y', 'z'] as const)
      expect(b[k] / a[k]).toBeCloseTo(1.8, 9);
    // Scaling is about the head joint, and the neck is untouched.
    expect(worldPos(body, 'Head').distanceTo(head)).toBeLessThan(1e-9);
    expect(worldPos(body, 'neck_01').distanceTo(neckBefore)).toBeLessThan(1e-9);
    expect(body.bones.get('neck_01')?.matrixWorld.equals(neckM)).toBe(true);
    // Descendants of Head grow with it.
    expect(worldScale(body, 'Head_leaf').x).toBeCloseTo(1.8, 6);
  });
});

describe('AC-ANA-005.1: lengthAxis x', () => {
  it('legLength 1.3 scales along local X and leaves the cross-section', () => {
    const {binding} = bind(rigX);
    const scales = applyAnatomy(binding, params({legLength: 1.3}));
    for (const n of ['thigh_l', 'thigh_r']) {
      expect(scales.get(n)?.toArray()).toEqual([1.3, 1, 1]);
    }
    expect(scales.get('calf_l')?.x).toBeCloseTo(1.3 / 1.3, 12);
    const {body, binding: b2} = bind(rigX);
    pose(body, b2, params({legLength: 1.3}));
    for (const n of ['thigh_l', 'calf_l']) {
      const s = worldScale(body, n);
      expect(s.x).toBeCloseTo(1.3, 6);
      expect(s.y).toBeCloseTo(1, 6);
      expect(s.z).toBeCloseTo(1, 6);
    }
    // The calf sits 1.3x farther from the thigh along X.
    expect(
      Math.abs(worldPos(body, 'calf_l').x - worldPos(body, 'thigh_l').x),
    ).toBeCloseTo(0.42 * 1.3, 6);
  });
});

describe('AC-ANA-008.1: ground offset from the character skeleton rest', () => {
  it.each(['fixture-a', 'fixture-b'])(
    'lowest foot joint is at y = 0 with legLength 0.7 and feet 1.5 (%s)',
    group => {
      const {body, binding} = bind(rig, group);
      const p = params({legLength: 0.7, feet: 1.5});
      const offset = computeGroundOffset(binding, p);
      pose(body, binding, p);
      const lowest = Math.min(
        worldPos(body, 'foot_l').y,
        worldPos(body, 'foot_r').y,
      );
      expect(lowest + offset).toBeCloseTo(0, 9);
      // Shorter legs lift the feet, so the character is shifted down.
      expect(offset).toBeLessThan(0);
    },
  );

  it('is cached and deterministic per parameter set', () => {
    const {binding} = bind(rig);
    const p = params({legLength: 0.8});
    expect(computeGroundOffset(binding, p)).toBe(
      computeGroundOffset(binding, {...p}),
    );
    expect(applyAnatomy(binding, p)).toBe(applyAnatomy(binding, {...p}));
  });
});

describe('AC-ANA-009.1: clip translation follows the length factor', () => {
  it('elbow-to-wrist is 1.2x with armLength 1.2', () => {
    const {body, binding} = bind(rig);
    const sample = () => {
      resetBodyToRest(binding);
      body.bones.get('lowerarm_l')?.position.set(0, -0.3, 0);
      body.bones.get('hand_l')?.position.set(0, -0.21, 0);
    };
    const wrist = (p: AnatomyParams) => {
      sample();
      applyAnatomyToPose(binding, p);
      body.root.updateMatrixWorld(true);
      return worldPos(body, 'hand_l').distanceTo(worldPos(body, 'lowerarm_l'));
    };
    const base = wrist(params());
    expect(base).toBeCloseTo(0.21, 9);
    expect(Math.abs(wrist(params({armLength: 1.2})) - base * 1.2)).toBeLessThan(
      1e-4,
    );
  });

  it('multiplies clip scale tracks by the anatomy scale', () => {
    const {body, binding} = bind(rig);
    resetBodyToRest(binding);
    body.bones.get('upperarm_l')?.scale.set(1, 2, 1);
    applyPose(binding, params({armLength: 1.2}));
    body.root.updateMatrixWorld(true);
    // The clip scale stays on the bone; the anatomy factor skins its geometry.
    expect(body.bones.get('upperarm_l')?.scale.toArray()).toEqual([1, 2, 1]);
    expect(worldScale(body, 'upperarm_l').toArray()).toEqual(
      [1, 2 * 1.2, 1].map(v => expect.closeTo(v, 9)),
    );
  });
});

describe('AC-ANA-009.2: determinism', () => {
  it('the same frame sampled twice gives bit-identical bone matrices', () => {
    const {body, binding} = bind(rig, 'fixture-b');
    const p = params({
      armLength: 1.2,
      legLength: 1.13,
      head: 1.37,
      torsoWidth: 1.21,
    });
    const run = () => {
      resetBodyToRest(binding);
      body.bones.get('lowerarm_l')?.position.set(0.01, -0.29, 0.02);
      const pel = body.bones.get('pelvis');
      if (pel) pel.position.y += 0.031;
      const rt = body.bones.get('root');
      if (rt) rt.position.z += 0.7;
      applyAnatomyToPose(binding, p);
      body.root.updateMatrixWorld(true);
      return body.skeleton.bones.map(b => Array.from(b.matrixWorld.elements));
    };
    expect(run()).toEqual(run());
  });
});

describe('AC-ANA-010.1: clip vertical and root translation scale with legLength', () => {
  it('feet stay on the ground over frames 0-7 of a bobbing walk with legLength 1.3', () => {
    const {body, binding} = bind(rig);
    const frames = Array.from({length: 8}, (_, f) => f);
    // Synthetic walk: pelvis bobs 4 cm, contact (bob 0) at frames 0 and 4; root moves forward.
    const bob = (f: number) => 0.02 * (1 - Math.cos((2 * Math.PI * f) / 4));
    const lowestFoot = (p: AnatomyParams, f: number) => {
      resetBodyToRest(binding);
      const pelvis = body.bones.get('pelvis');
      if (pelvis) pelvis.position.y = 0.87 + bob(f);
      body.bones.get('root')?.position.set(0, 0, f * 0.1);
      applyAnatomyToPose(binding, p);
      body.root.updateMatrixWorld(true);
      return (
        Math.min(worldPos(body, 'foot_l').y, worldPos(body, 'foot_r').y) +
        computeGroundOffset(binding, p)
      );
    };
    const long = params({legLength: 1.3});
    const base = params();
    for (const f of frames) {
      expect(lowestFoot(long, f)).toBeGreaterThan(-0.01);
      if (bob(f) === 0 || f % 4 === 0) {
        expect(
          Math.abs(lowestFoot(long, f) - lowestFoot(base, 0)),
        ).toBeLessThan(0.02);
      }
      // Bob amplitude scales with legLength (delta form).
      expect(lowestFoot(long, f)).toBeCloseTo(bob(f) * 1.3, 6);
    }
    // Horizontal root translation scales too.
    lowestFoot(long, 5);
    expect(body.bones.get('root')?.position.z).toBeCloseTo(0.5 * 1.3, 9);
  });
});

/** The fixture rig with its `root` rotated -90 degrees about X (Quaternius layout). */
function rotatedRootRig(): RigDefinition {
  const r = structuredClone(rig);
  const h = Math.SQRT1_2;
  for (const group of r.skeletonGroups) {
    const root = group.restPose['root'];
    const pelvis = group.restPose['pelvis'];
    if (root === undefined || pelvis === undefined) throw new Error('fixture');
    root.r = [-h, 0, 0, h];
    // World up (pelvis height) is the root's local Z; +90 degrees about X on
    // the pelvis restores the rest of the skeleton's world orientation.
    pelvis.t = [pelvis.t[0], -pelvis.t[2], pelvis.t[1]];
    pelvis.r = [h, 0, 0, h];
  }
  return r;
}

describe('AC-ANA-010.2: root/pelvis vertical is along world up; root horizontal scales by legLength only', () => {
  const p = params({legLength: 1.3, height: 1.2});
  // Clip: root moves +1.0 m in Z over frames 0..7; the pelvis bobs vertically
  // and sways sideways/forward in its parent's horizontal plane.
  const bob = (f: number) => 0.02 * (1 - Math.cos((2 * Math.PI * f) / 4));
  const sway = (f: number) => 0.01 * Math.sin((2 * Math.PI * f) / 8);

  it.each([
    ['fixture rig (root identity, vertical = local Y)', false],
    ['root rotated -90 degrees about X (vertical = pelvis local Z)', true],
  ] as const)('%s', (_label, rotated) => {
    const r = rotated ? rotatedRootRig() : rig;
    const {body, binding} = bind(r);
    const pelvisRest = binding.body.rest.joints.find(j => j.name === 'pelvis')
      ?.translation as readonly [number, number, number];
    const vAxis = rotated ? 2 : 1;
    const fwdAxis = rotated ? 1 : 2;
    const vRest = pelvisRest[vAxis] as number;
    const rootZ: number[] = [];
    for (let f = 0; f < 8; f++) {
      resetBodyToRest(binding);
      const root = body.bones.get('root');
      const pelvis = body.bones.get('pelvis');
      if (root === undefined || pelvis === undefined) throw new Error('bones');
      root.position.set(0, 0, f / 7);
      const clip = [...pelvisRest] as [number, number, number];
      clip[vAxis] = vRest + bob(f);
      clip[fwdAxis] = (clip[fwdAxis] as number) + sway(f);
      clip[0] = clip[0] + sway(f);
      pelvis.position.fromArray(clip);
      applyAnatomyToPose(binding, p);
      rootZ.push(root.position.z);
      // Vertical component: v_rest + (v_clip - v_rest) * legLength.
      expect(pelvis.position.getComponent(vAxis)).toBeCloseTo(
        vRest + bob(f) * 1.3,
        9,
      );
      // Horizontal components of the pelvis are the clip values, unscaled.
      expect(pelvis.position.getComponent(fwdAxis)).toBeCloseTo(
        (pelvisRest[fwdAxis] as number) + sway(f),
        12,
      );
      expect(pelvis.position.x).toBeCloseTo(pelvisRest[0] + sway(f), 12);
      // The root has no vertical clip motion: it stays at its rest height.
      expect(root.position.y).toBeCloseTo(0, 12);
    }
    // Root displacement frames 0..7: 1.0 m * legLength (height does not enter).
    expect((rootZ[7] as number) - (rootZ[0] as number)).toBeCloseTo(1.3, 6);
  });

  it('the rotated-root rig has the same world rest pose and ground offset as the fixture rig', () => {
    const a = bind(rig);
    const b = bind(rotatedRootRig());
    const q = params({legLength: 0.7, feet: 1.5});
    pose(a.body, a.binding, q);
    pose(b.body, b.binding, q);
    for (const n of ['pelvis', 'foot_l', 'Head', 'hand_r']) {
      expect(worldPos(b.body, n).distanceTo(worldPos(a.body, n))).toBeLessThan(
        1e-9,
      );
    }
    // REQ-ANA-008 reads world Y, so a rotated root does not change grounding.
    expect(computeGroundOffset(b.binding, q)).toBeCloseTo(
      computeGroundOffset(a.binding, q),
      9,
    );
  });
});

describe('REQ-ANM-008 / REQ-ANA-011: anatomy evaluation allocates nothing per frame', () => {
  it('applyAnatomyToPose, computeGroundOffset and socketPropScale reuse the cached evaluation', () => {
    const {body, binding} = bind(rig);
    const p = params({legLength: 1.2, head: 1.3, hands: 1.5, height: 1.1});
    const pelvis = body.bones.get('pelvis');
    const {bytesPerCall, limit} = heapGrowthPerCall(i => {
      resetBodyToRest(binding);
      if (pelvis !== undefined) pelvis.position.y += (i % 7) * 0.001;
      applyAnatomyToPose(binding, p);
      applyAnatomyToSkins(binding, p, body.root);
      computeGroundOffset(binding, p);
      socketPropScale(binding, p, 'hand_r');
    }, 100_000);
    expect(bytesPerCall).toBeLessThan(limit);
  });
});

describe('REQ-ANA-007: socket prop scale rules', () => {
  it('a non-inheriting prop keeps world scale and offset; the head inherits', () => {
    const {body, binding} = bind(rig);
    const p = params({hands: 1.75, head: 1.5, height: 1.1});
    pose(body, binding, p);
    const hand = socketPropScale(binding, p, 'hand_r').clone();
    const worldS = worldScale(body, 'hand_r');
    expect(worldS.x * hand.x).toBeCloseTo(1, 9);
    expect(worldS.y * hand.y).toBeCloseTo(1, 9);
    const head = socketPropScale(binding, p, 'head').toArray();
    expect(head).toEqual([1, 1, 1]);
    expect(worldScale(body, 'Head').x).toBeCloseTo(1.5 * 1.1, 9);
    // An explicit override wins over the default.
    expect(socketPropScale(binding, p, 'head', false).x).toBeCloseTo(
      1 / 1.65,
      9,
    );
    expect(socketPropScale(binding, p, 'hand_r', true).toArray()).toEqual([
      1, 1, 1,
    ]);
  });
});
