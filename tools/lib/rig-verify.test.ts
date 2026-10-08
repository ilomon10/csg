import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {readRigFile} from './gltf-skeleton.js';
import {describe, expect, it} from 'vitest';
import {compose, decompose, invert, multiply, quatAngle} from './mat4.js';
import {
  analyzeVertexWeights,
  buildReport,
  checkClipTargets,
  checkWeights,
  decideOutcome,
  DEFAULT_TOLERANCES,
  deriveLengthAxis,
  deriveRigDefinition,
  emptyWeightStats,
  groupBySkeletonGroups,
  groupSkeletons,
  annotateSkeletonGroups,
  matchSkeletonGroups,
  restPoseFkError,
  skeletonFromGroup,
  verifyBuiltPart,
  renderMarkdown,
  suggestBoneMap,
  verifyFile,
} from './rig-verify.js';
import type {
  JointRest,
  SkeletonGroupInput,
  RigFileData,
  RigOverlay,
  SkeletonData,
} from './rig-verify.js';

const NAMES: Array<[string, string | null, [number, number, number]]> = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 1, 0]],
  ['spine_01', 'pelvis', [0, 0.2, 0]],
  ['hand_r', 'spine_01', [-0.3, 0.2, 0]],
  ['lowerarm_l', 'spine_01', [0.3, 0.2, 0]],
];

function makeSkeleton(
  mutate?: (j: JointRest[]) => JointRest[],
  bindShift?: Record<string, [number, number, number]>,
): SkeletonData {
  let joints: JointRest[] = NAMES.map(([name, parent, t]) => ({
    name,
    parent,
    translation: t,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  }));
  if (mutate) joints = mutate(joints);
  const world = new Map<string, number[]>();
  const inverseBind = joints.map(j => {
    const local = compose(j.translation, j.rotation, j.scale);
    const parentW = j.parent ? world.get(j.parent) : undefined;
    const w = parentW ? multiply(parentW, local) : local;
    world.set(j.name, w);
    const shifted = [...w];
    const s = bindShift?.[j.name];
    if (s) {
      shifted[12] = (shifted[12] ?? 0) + s[0];
      shifted[13] = (shifted[13] ?? 0) + s[1];
      shifted[14] = (shifted[14] ?? 0) + s[2];
    }
    return invert(shifted) as number[];
  });
  return {
    joints,
    inverseBind,
    armatureWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
}

function fileOf(skeleton: SkeletonData, file = 'part.gltf'): RigFileData {
  return {file, packId: 'p', skeleton, weights: null, clips: null};
}

const ref = makeSkeleton();

describe('mat4', () => {
  it('round-trips compose/decompose and measures small angles', () => {
    const q = [0.1, 0.2, 0.3, 0.9273618495495703] as const;
    const m = compose([1, 2, 3], q, [1, 2, 1]);
    const d = decompose(m);
    expect(d.translation).toEqual([1, 2, 3]);
    expect(d.scale[1]).toBeCloseTo(2, 9);
    expect(quatAngle(q, d.rotation)).toBeLessThan(1e-9);
    const tiny = [Math.sin(5e-5), 0, 0, Math.cos(5e-5)] as const;
    expect(quatAngle([0, 0, 0, 1], tiny)).toBeCloseTo(1e-4, 10);
  });
});

describe('verify-rig', () => {
  it('AC-AST-003.1: a part skinned to the reference rig passes', () => {
    const items = verifyFile(ref, fileOf(makeSkeleton()), DEFAULT_TOLERANCES);
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('pass');
    expect(items[0]?.jointCount).toBe(5);
  });

  it('AC-AST-003.2: a renamed bone fails with missing and extra bones', () => {
    const cand = makeSkeleton(js =>
      js.map(j => (j.name === 'hand_r' ? {...j, name: 'Hand_R'} : j)),
    );
    const [item] = verifyFile(ref, fileOf(cand), DEFAULT_TOLERANCES);
    expect(item?.status).toBe('fail');
    expect(item?.missingBones).toEqual(['hand_r']);
    expect(item?.extraBones).toEqual(['Hand_R']);
  });

  it('AC-AST-008.1: suggests Hand_R -> hand_r', () => {
    const cand = makeSkeleton(js =>
      js.map(j => (j.name === 'hand_r' ? {...j, name: 'Hand_R'} : j)),
    );
    const [item] = verifyFile(ref, fileOf(cand), DEFAULT_TOLERANCES);
    expect(item?.suggestedBoneMap).toEqual({Hand_R: 'hand_r'});
    expect(suggestBoneMap(['hand_r'], ['Hand_R'])).toEqual({Hand_R: 'hand_r'});
  });

  it('AC-AST-003.3: a 2 mm inverse-bind shift fails with a bindPose issue', () => {
    const cand = makeSkeleton(undefined, {lowerarm_l: [0.002, 0, 0]});
    const [item] = verifyFile(ref, fileOf(cand), DEFAULT_TOLERANCES);
    expect(item?.status).toBe('fail');
    const bp = item?.bindPose.find(b => b.bone === 'lowerarm_l');
    expect(bp?.maxPosDelta).toBeCloseTo(0.002, 5);
  });

  it('AC-AST-004.1: a 5e-5 m difference passes and is reported as info', () => {
    const cand = makeSkeleton(undefined, {lowerarm_l: [5e-5, 0, 0]});
    const [item] = verifyFile(ref, fileOf(cand), DEFAULT_TOLERANCES);
    expect(item?.status).toBe('pass');
    expect(item?.bindPose).toHaveLength(0);
    expect(item?.issues.some(i => i.severity === 'info')).toBe(true);
    expect(item?.metrics?.worstBindPosM).toBeCloseTo(5e-5, 7);
  });

  it('flags parent mismatches, armature transform and length axis', () => {
    const reparent = makeSkeleton(js =>
      js.map(j => (j.name === 'hand_r' ? {...j, parent: 'pelvis'} : j)),
    );
    const [a] = verifyFile(ref, fileOf(reparent), DEFAULT_TOLERANCES);
    expect(a?.parentMismatches).toEqual([
      {bone: 'hand_r', expected: 'spine_01', actual: 'pelvis'},
    ]);
    const shifted: SkeletonData = {
      ...makeSkeleton(),
      armatureWorld: compose([0, 0, 0.01], [0, 0, 0, 1], [1, 1, 1]),
    };
    const [b] = verifyFile(ref, fileOf(shifted), DEFAULT_TOLERANCES);
    expect(b?.issues.some(i => i.message.includes('Armature root'))).toBe(true);
    const xAxis = makeSkeleton(js =>
      js.map(j => (j.parent ? {...j, translation: [1, 0, 0] as const} : j)),
    );
    expect(deriveLengthAxis(xAxis.joints).axis).toBe('x');
    const [c] = verifyFile(ref, fileOf(xAxis), DEFAULT_TOLERANCES);
    expect(c?.issues.some(i => i.message.includes('length axis'))).toBe(true);
  });

  it('flags more than 4 influences and unnormalized weights', () => {
    const stats = emptyWeightStats();
    // Vertex 0: 5 influences across two sets; vertex 1: weights sum to 0.8.
    analyzeVertexWeights(
      stats,
      [
        {
          joints: [0, 1, 2, 3, 0, 0, 0, 0],
          weights: [0.2, 0.2, 0.2, 0.2, 0.4, 0.2, 0.2, 0],
        },
        {joints: [4, 0, 0, 0, 0, 0, 0, 0], weights: [0.2, 0, 0, 0, 0, 0, 0, 0]},
      ],
      2,
      5,
    );
    expect(stats.maxInfluences).toBe(5);
    expect(stats.unnormalizedVertices).toBe(1);
    const codes = checkWeights(stats).map(i => i.code);
    expect(codes).toContain('AST_BUDGET_INFLUENCES');
    expect(codes).toContain('AST_WEIGHTS_UNNORMALIZED');
    const bad = emptyWeightStats();
    analyzeVertexWeights(
      bad,
      [{joints: [9, 0, 0, 0], weights: [1, 0, 0, 0]}],
      1,
      5,
    );
    expect(bad.badJointIndexVertices).toBe(1);
  });

  it('samples huge meshes instead of scanning every vertex', () => {
    const stats = emptyWeightStats();
    const n = 200000;
    analyzeVertexWeights(
      stats,
      [
        {
          joints: new Uint8Array(n * 4),
          weights: new Float32Array(n * 4).fill(0.25),
        },
      ],
      n,
      1,
      1000,
    );
    expect(stats.sampled).toBeLessThanOrEqual(1000);
    expect(stats.vertices).toBe(n);
  });

  it('checks that clip channels target canonical bones only', () => {
    const canonical = new Set(['root', 'pelvis']);
    const ok = checkClipTargets(canonical, {
      clipCount: 1,
      channelCount: 2,
      targetNames: ['pelvis', 'root'],
    });
    expect(ok.issues.every(i => i.severity === 'info')).toBe(true);
    const bad = checkClipTargets(canonical, {
      clipCount: 1,
      channelCount: 2,
      targetNames: ['Armature', 'pelvis'],
    });
    expect(bad.extra).toEqual(['Armature']);
    const [item] = verifyFile(
      ref,
      {
        file: 'c.glb',
        packId: 'p',
        skeleton: null,
        weights: null,
        clips: {clipCount: 1, channelCount: 1, targetNames: ['nope']},
      },
      DEFAULT_TOLERANCES,
    );
    expect(item?.kind).toBe('animation');
    expect(item?.status).toBe('fail');
  });

  it('decides shared, mapped and fallback outcomes', () => {
    const tol = DEFAULT_TOLERANCES;
    const pass = verifyFile(ref, fileOf(makeSkeleton()), tol);
    expect(decideOutcome(pass)).toBe('shared');
    const bind = verifyFile(
      ref,
      fileOf(makeSkeleton(undefined, {pelvis: [0.01, 0, 0]})),
      tol,
    );
    expect(decideOutcome(bind)).toBe('mapped');
    const renamed = verifyFile(
      ref,
      fileOf(
        makeSkeleton(js =>
          js.map(j => (j.name === 'hand_r' ? {...j, name: 'Hand_R'} : j)),
        ),
      ),
      tol,
    );
    expect(decideOutcome(renamed)).toBe('mapped');
    const different = verifyFile(
      ref,
      fileOf(makeSkeleton(js => js.filter(j => j.name !== 'hand_r'))),
      tol,
    );
    expect(decideOutcome(different)).toBe('fallback');
  });

  it('groups skeletons with identical bind poses', () => {
    const groups = groupSkeletons(
      {file: 'ref', skeleton: ref},
      [
        {file: 'a', skeleton: makeSkeleton()},
        {file: 'b', skeleton: makeSkeleton(undefined, {pelvis: [0.05, 0, 0]})},
        {file: 'c', skeleton: makeSkeleton(undefined, {pelvis: [0.05, 0, 0]})},
      ],
      DEFAULT_TOLERANCES,
    );
    expect(groups.map(g => g.files)).toEqual([
      ['ref', 'a'],
      ['b', 'c'],
    ]);
    expect(groups[1]?.vsReference.maxPosM).toBeCloseTo(0.05, 6);
  });

  it('AC-AST-006.1 / AC-AST-006.2: report summary, markdown row and determinism', () => {
    const build = () => {
      const items = [
        ...verifyFile(
          ref,
          fileOf(makeSkeleton(), 'good.gltf'),
          DEFAULT_TOLERANCES,
        ),
        ...verifyFile(
          ref,
          fileOf(
            makeSkeleton(undefined, {lowerarm_l: [0.002, 0, 0]}),
            'bad|x.gltf',
          ),
          DEFAULT_TOLERANCES,
        ),
      ];
      return buildReport({
        canonicalRig: 'test-rig',
        tolerances: DEFAULT_TOLERANCES,
        toolVersions: {node: 'x'},
        referenceFile: 'ref.gltf',
        items,
      });
    };
    const a = build();
    expect(a.summary).toEqual({pass: 1, warn: 0, fail: 1});
    const md = renderMarkdown(a);
    expect(md).toMatch(/\| bad\\\|x\.gltf \| p \| skinned-mesh \| fail \|/);
    expect(JSON.stringify(build())).toBe(JSON.stringify(a));
    expect(renderMarkdown(build())).toBe(md);
    expect(md).not.toMatch(/Run date/);
  });
});

const groupB = makeSkeleton(js =>
  js.map(j => (j.name === 'pelvis' ? {...j, translation: [0, 1.05, 0]} : j)),
);
const groupInputs: SkeletonGroupInput[] = [
  {id: 'g-a', packId: 'p', file: 'a.gltf', skeleton: ref},
  {id: 'g-b', packId: 'p', file: 'b.gltf', skeleton: groupB},
];

describe('canonical rig derivation', () => {
  const overlay: RigOverlay = {
    defaultSkeletonGroup: 'g-a',
    socketBones: {
      hand_r: 'hand_r',
      hand_l: 'lowerarm_l',
      head: 'spine_01',
      spine_03: 'spine_01',
      pelvis: 'pelvis',
    },
    skeletonGroups: {'g-a': 'a.gltf', 'g-b': 'b.gltf'},
    anatomyBones: Object.fromEntries(
      [
        'height',
        'head',
        'torsoWidth',
        'shoulders',
        'armLength',
        'legLength',
        'hands',
        'feet',
        'limbThickness',
      ].map(k => [k, ['pelvis']]),
    ),
    regionBones: {
      head: [],
      hair: [],
      neck: [],
      torso: ['spine_01', 'lowerarm_l'],
      'upper-arms': [],
      'lower-arms': [],
      hands: ['hand_r'],
      pelvis: ['root', 'pelvis'],
      'upper-legs': [],
      'lower-legs': [],
      feet: [],
    },
  };

  it('AC-AST-005.1: writes bones parent-before-child with rest transforms', () => {
    const shuffled: SkeletonData = {
      ...ref,
      joints: [...ref.joints].reverse(),
      inverseBind: [...ref.inverseBind].reverse(),
    };
    const {rig, errors} = deriveRigDefinition(
      'test-rig',
      shuffled,
      overlay,
      groupInputs,
    );
    expect(errors).toEqual([]);
    expect(rig?.rootBone).toBe('root');
    expect(rig?.lengthAxis).toBe('y');
    const seen = new Set<string>();
    for (const b of rig?.bones ?? []) {
      const p = rig?.parents[b];
      if (p) expect(seen.has(p)).toBe(true);
      seen.add(b);
    }
    expect(rig && 'joints' in rig).toBe(false);
    expect(Object.keys(rig?.socketBones ?? {}).sort()).toEqual([
      'hand_l',
      'hand_r',
      'head',
      'pelvis',
      'spine_03',
    ]);
    expect(rig?.comment).toMatch(/Derived by/);
  });

  it('AC-AST-012.2: reports a joint that is in no region', () => {
    const bad: RigOverlay = {
      ...overlay,
      regionBones: {...overlay.regionBones, pelvis: ['root']},
    };
    const {rig, errors} = deriveRigDefinition(
      'test-rig',
      ref,
      bad,
      groupInputs,
    );
    expect(rig).toBeNull();
    expect(
      errors.some(
        e => e.includes('AST_REGION_UNMAPPED') && e.includes('pelvis'),
      ),
    ).toBe(true);
  });
});

describe('skeleton groups (REQ-AST-026)', () => {
  const tol = DEFAULT_TOLERANCES;

  it('AC-AST-026.3: rig JSON has one restPose per group for every bone', () => {
    const overlay = {
      defaultSkeletonGroup: 'g-a',
      socketBones: {
        hand_r: 'hand_r',
        hand_l: 'lowerarm_l',
        head: 'spine_01',
        spine_03: 'spine_01',
        pelvis: 'pelvis',
      },
      skeletonGroups: {'g-a': 'a.gltf', 'g-b': 'b.gltf'},
      anatomyBones: Object.fromEntries(
        [
          'height',
          'head',
          'torsoWidth',
          'shoulders',
          'armLength',
          'legLength',
          'hands',
          'feet',
          'limbThickness',
        ].map(k => [k, ['pelvis']]),
      ),
      regionBones: {
        head: [],
        hair: [],
        neck: [],
        torso: ['spine_01', 'lowerarm_l'],
        'upper-arms': [],
        'lower-arms': [],
        hands: ['hand_r'],
        pelvis: ['root', 'pelvis'],
        'upper-legs': [],
        'lower-legs': [],
        feet: [],
      },
    };
    const {rig, errors} = deriveRigDefinition('r', ref, overlay, groupInputs);
    expect(errors).toEqual([]);
    expect(rig?.skeletonGroups.map(g => g.id)).toEqual(['g-a', 'g-b']);
    for (const g of rig?.skeletonGroups ?? []) {
      expect(Object.keys(g.restPose)).toEqual(rig?.bones);
    }
    expect(rig?.skeletonGroups[1]?.restPose.pelvis?.t).toEqual([0, 1.05, 0]);
  });

  it('AC-AST-026.3: rest-pose FK equals inverse(IBM) of each representative', () => {
    for (const g of groupInputs) {
      const e = restPoseFkError(g.skeleton);
      expect(e.posM).toBeLessThan(tol.posM);
      expect(e.rotRad).toBeLessThan(tol.rotRad);
      expect(e.scale).toBeLessThan(tol.scale);
    }
    const broken = makeSkeleton(undefined, {pelvis: [0, 0.01, 0]});
    expect(restPoseFkError(broken).posM).toBeGreaterThan(tol.posM);
  });

  it('AC-AST-026.5: every skinned file lands in exactly one group', () => {
    const files = [
      {file: 'x1.gltf', skeleton: makeSkeleton()},
      {file: 'x2.gltf', skeleton: groupB},
      {
        file: 'x3.gltf',
        skeleton: makeSkeleton(js =>
          js.map(j =>
            j.name === 'pelvis' ? {...j, translation: [0, 2, 0]} : j,
          ),
        ),
      },
    ];
    const r = groupBySkeletonGroups(ref, groupInputs, 'g-a', files, tol);
    expect(r.groups.map(g => g.id)).toEqual(['g-a', 'g-b']);
    expect(r.groups[0]?.isReference).toBe(true);
    expect(r.groups[0]?.files).toEqual(['x1.gltf']);
    expect(r.groups[1]?.files).toEqual(['x2.gltf']);
    expect(r.unmatched).toEqual([{file: 'x3.gltf', matches: []}]);
    expect(matchSkeletonGroups(groupInputs, ref, tol)).toEqual(['g-a']);
  });

  it('AC-AST-026.4: unmatched rest pose is a warning, not an error', () => {
    const items = verifyFile(ref, fileOf(makeSkeleton(), 'u.gltf'), tol);
    annotateSkeletonGroups(items, new Map(), [{file: 'u.gltf', matches: []}]);
    const w = items[0]?.issues.find(
      i => i.code === 'AST_SKELETON_GROUP_UNMATCHED',
    );
    expect(w?.severity).toBe('warn');
    expect(w?.message).toContain('u.gltf');
  });

  const rigView = () => {
    const parents = Object.fromEntries(NAMES.map(([n, p]) => [n, p]));
    const restPose = (sk: SkeletonData) =>
      Object.fromEntries(
        sk.joints.map(j => [
          j.name,
          {t: [...j.translation], r: [...j.rotation], s: [...j.scale]},
        ]),
      );
    return {
      bones: NAMES.map(([n]) => n),
      parents,
      skeletonGroups: [
        {id: 'g-a', restPose: restPose(ref)},
        {id: 'g-b', restPose: restPose(groupB)},
      ],
    };
  };

  it('AC-AST-026.1: verifyBuiltPart warns (not fails) on a bind-pose-only difference', () => {
    const rig = rigView();
    expect(verifyBuiltPart(rig, 'g-a', fileOf(makeSkeleton())).status).toBe(
      'pass',
    );
    expect(verifyBuiltPart(rig, 'g-b', fileOf(groupB)).status).toBe('pass');
    const r = verifyBuiltPart(rig, 'g-a', fileOf(groupB));
    expect(r.ok).toBe(true);
    expect(r.status).toBe('warn');
    const w = r.issues.find(i => i.severity === 'warn');
    expect(w?.message).toContain('g-a');
    expect(w?.message).toContain('pelvis');
  });

  it('AC-AST-026.2: verifyBuiltPart fails on a renamed bone', () => {
    const cand = makeSkeleton(js =>
      js.map(j => (j.name === 'hand_r' ? {...j, name: 'Hand_R'} : j)),
    );
    const r = verifyBuiltPart(rigView(), 'g-a', fileOf(cand));
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'AST_RIG_MISMATCH')).toBe(true);
  });

  it('AC-AST-016.1: verifyBuiltPart fails on 5 influences, unknown group fails', () => {
    const stats = emptyWeightStats();
    analyzeVertexWeights(
      stats,
      [
        {joints: [0, 1, 2, 3], weights: [0.2, 0.2, 0.2, 0.2]},
        {joints: [4, 0, 0, 0], weights: [0.2, 0, 0, 0]},
      ],
      1,
      5,
    );
    const data = {...fileOf(makeSkeleton()), weights: stats};
    const r = verifyBuiltPart(rigView(), 'g-a', data);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.code === 'AST_BUDGET_INFLUENCES')).toBe(true);
    expect(verifyBuiltPart(rigView(), 'nope', data).ok).toBe(false);
    expect(skeletonFromGroup(rigView(), 'nope')).toBeNull();
  });
});

describe('real packs (skipped without assets-src)', () => {
  const root = resolve(__dirname, '../../assets-src');
  const overlayPath = resolve(
    __dirname,
    '../rigs/quaternius-ue5-65.overlay.json',
  );
  const have = existsSync(root) && existsSync(overlayPath);
  it.skipIf(!have)(
    'AC-AST-026.3: FK of rest TRS equals inverse(IBM) for each group representative',
    async () => {
      const overlay = JSON.parse(
        readFileSync(overlayPath, 'utf8'),
      ) as RigOverlay;
      for (const [id, rel] of Object.entries(overlay.skeletonGroups)) {
        const d = await readRigFile(join(root, rel), rel, 'p');
        expect(d.skeleton, id).not.toBeNull();
        const e = restPoseFkError(d.skeleton as SkeletonData);
        expect(e.posM, id).toBeLessThan(DEFAULT_TOLERANCES.posM);
        expect(e.rotRad, id).toBeLessThan(DEFAULT_TOLERANCES.rotRad);
        expect(e.scale, id).toBeLessThan(DEFAULT_TOLERANCES.scale);
      }
    },
  );
});
