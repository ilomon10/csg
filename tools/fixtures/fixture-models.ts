/**
 * Builds the fixture glTF documents with gltf-transform (spec 011 REQ-AST-021). Pure: returns
 * {@link Document}s, never touches the disk.
 */
import {Document} from '@gltf-transform/core';
import type {Accessor, Buffer as GltfBuffer, Node} from '@gltf-transform/core';
import {BODY_REGIONS} from '@csg/parts-schema';
import {invert} from '../lib/mat4.js';
import type {Quat, Vec3} from '../lib/mat4.js';
import {
  BONES,
  BONE_DEFS,
  GROUP_A,
  GROUP_B,
  PARENTS,
  REGION_BONES,
  restPoseOf,
  rotX,
  rotZ,
  quatMul,
  worldMatrices,
  worldPositions,
} from './fixture-rig.js';
import type {Rest} from './fixture-rig.js';

/** Influences of one vertex: `[boneName, weight]` pairs. */
export type Influences = ReadonlyArray<readonly [string, number]>;

/** An axis-aligned box skinned to bones. */
export interface BoxSpec {
  min: Vec3;
  max: Vec3;
  /** Influences of every vertex of the box. */
  influences: Influences;
  /** Optional per-vertex override (vertex index in the 24-vertex box). */
  vertexInfluences?: Readonly<Record<number, Influences>>;
}

/** Keyframe times of the fixture clip, seconds. */
export const CLIP_TIMES = [0, 0.5, 1] as const;
/** Elbow flexion at key 0.5 s, degrees about local X, applied after the rest rotation. */
export const ELBOW_DEG = 30;
/** Hip forward travel (+Z) at key 0.5 s, metres. */
export const HIP_FORWARD_M = 0.1;
/** Root travel (+Z) at keys 0, 0.5, 1.0 s, metres (root motion). */
export const ROOT_Z = [0, 0.5, 1] as const;

const FACES: ReadonlyArray<{n: Vec3; c: ReadonlyArray<Vec3>}> = [
  {
    n: [1, 0, 0],
    c: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    c: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  {
    n: [0, 1, 0],
    c: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    n: [0, -1, 0],
    c: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    n: [0, 0, 1],
    c: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    c: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

interface Geometry {
  positions: number[];
  normals: number[];
  indices: number[];
  /** Box index of each vertex. */
  boxOf: number[];
}

function boxGeometry(boxes: readonly BoxSpec[]): Geometry {
  const g: Geometry = {
    positions: [],
    normals: [],
    indices: [],
    boxOf: [],
  };
  boxes.forEach((box, bi) => {
    FACES.forEach(face => {
      const first = g.positions.length / 3;
      face.c.forEach(corner => {
        g.positions.push(
          corner[0] ? box.max[0] : box.min[0],
          corner[1] ? box.max[1] : box.min[1],
          corner[2] ? box.max[2] : box.min[2],
        );
        g.normals.push(...face.n);
        g.boxOf.push(bi);
      });
      g.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    });
  });
  return g;
}

function createBones(
  doc: Document,
  rest: Record<string, Rest>,
  renames: Readonly<Record<string, string>>,
) {
  const nodes = new Map<string, Node>();
  for (const b of BONE_DEFS) {
    const r = rest[b.name];
    if (r === undefined) throw new Error(b.name);
    const node = doc
      .createNode(renames[b.name] ?? b.name)
      .setTranslation([...r.t])
      .setRotation([...r.r])
      .setScale([...r.s]);
    nodes.set(b.name, node);
  }
  return nodes;
}

function attachHierarchy(doc: Document, nodes: Map<string, Node>): void {
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);
  for (const name of BONES) {
    const parent = PARENTS[name];
    const node = nodes.get(name);
    if (node === undefined) throw new Error(name);
    if (parent === null || parent === undefined) scene.addChild(node);
    else nodes.get(parent)?.addChild(node);
  }
}

function newDoc(): {doc: Document; buffer: GltfBuffer} {
  const doc = new Document();
  doc.getRoot().getAsset().generator =
    'character-sprite-generator fixtures:build';
  return {doc, buffer: doc.createBuffer('data')};
}

function acc(
  doc: Document,
  buffer: GltfBuffer,
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4',
  array:
    | Float32Array<ArrayBuffer>
    | Uint8Array<ArrayBuffer>
    | Uint16Array<ArrayBuffer>,
  normalized = false,
): Accessor {
  return doc
    .createAccessor()
    .setBuffer(buffer)
    .setType(type)
    .setArray(array)
    .setNormalized(normalized);
}

/** Options of {@link buildSkinnedPart}. */
export interface SkinnedPartOptions {
  name: string;
  materialName: string;
  color: [number, number, number, number];
  group: typeof GROUP_A | typeof GROUP_B;
  boxes: readonly BoxSpec[];
  /** Writes `_REGION` (bodies, REQ-AST-025). */
  withRegion?: boolean;
  /** Source joint renames, e.g. `{hand_r: 'Hand_R'}` (mismatched-rig part). */
  renames?: Readonly<Record<string, string>>;
}

/** Builds a skinned part: full skeleton, one mesh, one skin with inverse bind matrices. */
export function buildSkinnedPart(o: SkinnedPartOptions): Document {
  const {doc, buffer} = newDoc();
  const rest = restPoseOf(o.group);
  const nodes = createBones(doc, rest, o.renames ?? {});
  attachHierarchy(doc, nodes);
  const world = worldMatrices(rest);
  const skin = doc.createSkin(`${o.name}-skin`);
  const ibms: number[] = [];
  for (const name of BONES) {
    const node = nodes.get(name);
    const w = world.get(name);
    const inv = w === undefined ? null : invert(w);
    if (node === undefined || inv === null) throw new Error(name);
    skin.addJoint(node);
    ibms.push(...inv);
  }
  skin.setInverseBindMatrices(acc(doc, buffer, 'MAT4', new Float32Array(ibms)));
  skin.setSkeleton(nodes.get('root') ?? null);

  const geo = boxGeometry(o.boxes);
  const n = geo.positions.length / 3;
  const joints0 = new Uint8Array(n * 4);
  const weights0 = new Float32Array(n * 4);
  const joints1 = new Uint8Array(n * 4);
  const weights1 = new Float32Array(n * 4);
  let needSecondSet = false;
  const region = new Uint8Array(n);
  const perBoxVertex = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    const bi = geo.boxOf[v] ?? 0;
    const local = perBoxVertex.get(bi) ?? 0;
    perBoxVertex.set(bi, local + 1);
    const box = o.boxes[bi];
    if (box === undefined) throw new Error('box');
    const infl = box.vertexInfluences?.[local] ?? box.influences;
    if (infl.length > 8) throw new Error('at most 8 influences');
    infl.forEach(([bone, weight], k) => {
      const j = BONES.indexOf(bone);
      if (j < 0) throw new Error(`unknown bone ${bone}`);
      if (k < 4) {
        joints0[v * 4 + k] = j;
        weights0[v * 4 + k] = weight;
      } else {
        needSecondSet = true;
        joints1[v * 4 + (k - 4)] = j;
        weights1[v * 4 + (k - 4)] = weight;
      }
    });
    if (o.withRegion === true) {
      const top = [...infl].sort((a, b) => b[1] - a[1])[0];
      const bone = top?.[0] ?? 'root';
      region[v] = BODY_REGIONS.findIndex(r => REGION_BONES[r].includes(bone));
    }
  }
  const material = doc
    .createMaterial(o.materialName)
    .setBaseColorFactor(o.color)
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(acc(doc, buffer, 'SCALAR', new Uint16Array(geo.indices)))
    .setAttribute(
      'POSITION',
      acc(doc, buffer, 'VEC3', new Float32Array(geo.positions)),
    )
    .setAttribute(
      'NORMAL',
      acc(doc, buffer, 'VEC3', new Float32Array(geo.normals)),
    )
    .setAttribute('JOINTS_0', acc(doc, buffer, 'VEC4', joints0))
    .setAttribute('WEIGHTS_0', acc(doc, buffer, 'VEC4', weights0));
  if (needSecondSet) {
    prim
      .setAttribute('JOINTS_1', acc(doc, buffer, 'VEC4', joints1))
      .setAttribute('WEIGHTS_1', acc(doc, buffer, 'VEC4', weights1));
  }
  if (o.withRegion === true)
    prim.setAttribute('_REGION', acc(doc, buffer, 'SCALAR', region));
  const mesh = doc.createMesh(o.name).addPrimitive(prim);
  const meshNode = doc.createNode(o.name).setMesh(mesh).setSkin(skin);
  const scene =
    doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (scene === undefined) throw new Error('fixture has no scene');
  scene.addChild(meshNode);
  return doc;
}

/** Static sword prop: blade and hilt, no skin, authored along +Y at the origin. */
export function buildSword(): Document {
  const {doc, buffer} = newDoc();
  const geo = boxGeometry([
    {min: [-0.02, 0.1, -0.005], max: [0.02, 0.9, 0.005], influences: []},
    {min: [-0.07, 0.06, -0.015], max: [0.07, 0.1, 0.015], influences: []},
    {min: [-0.015, -0.05, -0.015], max: [0.015, 0.06, 0.015], influences: []},
  ]);
  const material = doc
    .createMaterial('Metal')
    .setBaseColorFactor([0.75, 0.75, 0.8, 1])
    .setMetallicFactor(1)
    .setRoughnessFactor(0.4);
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(acc(doc, buffer, 'SCALAR', new Uint16Array(geo.indices)))
    .setAttribute(
      'POSITION',
      acc(doc, buffer, 'VEC3', new Float32Array(geo.positions)),
    )
    .setAttribute(
      'NORMAL',
      acc(doc, buffer, 'VEC3', new Float32Array(geo.normals)),
    );
  const node = doc
    .createNode('sword')
    .setMesh(doc.createMesh('sword').addPrimitive(prim));
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);
  scene.addChild(node);
  return doc;
}

/** `lowerarm_l` rotation at key 0.5 s: `Rz(10 deg) * Rx(30 deg)` (rest rotation, then elbow flexion). */
export function elbowKey(): Quat {
  return quatMul(rotZ(10), rotX(ELBOW_DEG));
}

/** Clip authored on `fixture-b`: skeleton nodes at the B rest pose plus one 1.0 s animation. */
export function buildClip(): Document {
  const {doc, buffer} = newDoc();
  const rest = restPoseOf(GROUP_B);
  const nodes = createBones(doc, rest, {});
  attachHierarchy(doc, nodes);
  const anim = doc.createAnimation('fixture-clip');
  const times = acc(doc, buffer, 'SCALAR', new Float32Array(CLIP_TIMES));
  const track = (
    bone: string,
    path: 'translation' | 'rotation',
    values: number[],
  ) => {
    const node = nodes.get(bone);
    if (node === undefined) throw new Error(bone);
    const sampler = doc
      .createAnimationSampler()
      .setInterpolation('LINEAR')
      .setInput(times)
      .setOutput(
        acc(
          doc,
          buffer,
          path === 'rotation' ? 'VEC4' : 'VEC3',
          new Float32Array(values),
        ),
      );
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(node)
          .setTargetPath(path)
          .setSampler(sampler),
      );
  };
  const rt = rest['root']?.t ?? [0, 0, 0];
  const pt = rest['pelvis']?.t ?? [0, 0, 0];
  const lr = rest['lowerarm_l']?.r ?? [0, 0, 0, 1];
  track(
    'root',
    'translation',
    ROOT_Z.flatMap(z => [rt[0], rt[1], rt[2] + z]),
  );
  track('pelvis', 'translation', [
    ...pt,
    pt[0],
    pt[1],
    pt[2] + HIP_FORWARD_M,
    ...pt,
  ]);
  track('lowerarm_l', 'rotation', [...lr, ...elbowKey(), ...lr]);
  return doc;
}

/** Boxes of the body: one box per bone segment of the 10 populated regions (`hair` has no bone). */
export function bodyBoxes(
  rest: Record<string, Rest>,
  pad: number,
  only?: readonly string[],
): BoxSpec[] {
  const pos = worldPositions(rest);
  const p = (n: string): Vec3 => {
    const v = pos.get(n);
    if (v === undefined) throw new Error(n);
    return v;
  };
  const seg = (bone: string, end: Vec3): BoxSpec => {
    const a = p(bone);
    return {
      min: [0, 1, 2].map(
        i => Math.min(a[i] ?? 0, end[i] ?? 0) - pad,
      ) as unknown as Vec3,
      max: [0, 1, 2].map(
        i => Math.max(a[i] ?? 0, end[i] ?? 0) + pad,
      ) as unknown as Vec3,
      influences: [[bone, 1]],
    };
  };
  const off = (bone: string, d: Vec3): Vec3 => {
    const a = p(bone);
    return [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
  };
  const all: Array<[string, Vec3]> = [
    ['pelvis', p('spine_01')],
    ['spine_01', p('spine_02')],
    ['spine_02', p('spine_03')],
    ['spine_03', p('neck_01')],
    ['neck_01', p('Head')],
    ['Head', p('Head_leaf')],
  ];
  for (const s of ['l', 'r']) {
    all.push(
      [`clavicle_${s}`, p(`upperarm_${s}`)],
      [`upperarm_${s}`, p(`lowerarm_${s}`)],
      [`lowerarm_${s}`, p(`hand_${s}`)],
      [`hand_${s}`, off(`hand_${s}`, [0, -0.1, 0])],
      [`thigh_${s}`, p(`calf_${s}`)],
      [`calf_${s}`, p(`foot_${s}`)],
      [`foot_${s}`, off(`foot_${s}`, [0, 0, 0.12])],
    );
  }
  return all
    .filter(([bone]) => only === undefined || only.includes(bone))
    .map(([b, e]) => seg(b, e));
}

/** Body (fixture-a): every region has a box; `_REGION` written. */
export function buildBody(): Document {
  return buildSkinnedPart({
    name: 'fixture-body',
    materialName: 'Body',
    color: [0.85, 0.65, 0.55, 1],
    group: GROUP_A,
    boxes: bodyBoxes(restPoseOf(GROUP_A), 0.04),
    withRegion: true,
  });
}

const SHIRT_BONES = [
  'spine_01',
  'spine_02',
  'spine_03',
  'upperarm_l',
  'upperarm_r',
];

/** Shirt skinned to `fixture-a` (or `fixture-b`, or with a renamed joint). */
export function buildShirt(
  group: typeof GROUP_A | typeof GROUP_B,
  name: string,
  renames: Readonly<Record<string, string>> = {},
): Document {
  return buildSkinnedPart({
    name,
    materialName: 'Shirt',
    color: [0.2, 0.4, 0.8, 1],
    group,
    boxes: bodyBoxes(restPoseOf(group), 0.055, SHIRT_BONES),
    renames,
  });
}

/** Weights of the 5-influence vertex (AC-AST-027.1). */
export const FIVE_INFLUENCE_WEIGHTS = [0.4, 0.3, 0.15, 0.1, 0.05] as const;
/** Joints of the 5-influence vertex, in weight order. */
export const FIVE_INFLUENCE_BONES = [
  'upperarm_l',
  'lowerarm_l',
  'clavicle_l',
  'hand_l',
  'spine_03',
] as const;

/** Skinned part on `fixture-a` whose vertex 0 has 5 non-zero influences (M1-17 input). */
export function buildFiveInfluence(): Document {
  const boxes = bodyBoxes(restPoseOf(GROUP_A), 0.05, ['upperarm_l']).map(
    (b): BoxSpec => ({
      ...b,
      vertexInfluences: {
        0: FIVE_INFLUENCE_BONES.map(
          (bone, i) => [bone, FIVE_INFLUENCE_WEIGHTS[i] ?? 0] as const,
        ),
      },
    }),
  );
  return buildSkinnedPart({
    name: 'five-influence',
    materialName: 'Five',
    color: [0.8, 0.2, 0.2, 1],
    group: GROUP_A,
    boxes,
  });
}
