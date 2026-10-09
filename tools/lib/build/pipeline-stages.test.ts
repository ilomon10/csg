import {Document, NodeIO} from '@gltf-transform/core';
import type {Node} from '@gltf-transform/core';
import {EXTMeshoptCompression} from '@gltf-transform/extensions';
import {MeshoptDecoder, MeshoptEncoder} from 'meshoptimizer';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import sharp from 'sharp';
import {describe, expect, it} from 'vitest';
import {BODY_REGIONS} from '@csg/parts-schema';
import type {RigDefinition} from '@csg/parts-schema';
import {normalizeDocument} from './normalize.js';
import {optimizeDocument} from './optimize.js';
import {writeRegions} from './region.js';

const BONES = ['root', 'pelvis', 'spine_03', 'Head', 'hand_l'] as const;
const PARENT = [null, 'root', 'pelvis', 'spine_03', 'spine_03'];
const REST: Array<[number, number, number]> = [
  [0, 0, 0],
  [0, 1, 0],
  [0, 0.3, 0],
  [0, 0.3, 0],
  [0.4, 0, 0],
];

/** Skinned box-segment body; `scale` multiplies lengths, `yaw` 180 degrees faces -Z. */
function makeBody(scale = 1, facingMinusZ = false, withAnim = false): Document {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const nodes: Node[] = BONES.map((b, i) => {
    const n = doc
      .createNode(b)
      .setTranslation(REST[i]!.map(v => v * scale) as [number, number, number]);
    return n;
  });
  nodes.forEach((n, i) => {
    const p = PARENT[i];
    if (p) nodes[BONES.indexOf(p as (typeof BONES)[number])]!.addChild(n);
    else scene.addChild(n);
  });
  // World bind positions.
  const world: Array<[number, number, number]> = [];
  BONES.forEach((_b, i) => {
    const p = PARENT[i];
    const base = p
      ? world[BONES.indexOf(p as (typeof BONES)[number])]!
      : ([0, 0, 0] as [number, number, number]);
    world.push([
      base[0] + REST[i]![0] * scale,
      base[1] + REST[i]![1] * scale,
      base[2] + REST[i]![2] * scale,
    ]);
  });
  const sign = facingMinusZ ? -1 : 1;
  // One vertex per joint (rigid), offset toward the character's front (+z or -z).
  const positions = new Float32Array(BONES.length * 3);
  const joints = new Uint16Array(BONES.length * 4);
  const weights = new Float32Array(BONES.length * 4);
  BONES.forEach((_b, i) => {
    positions.set(
      [world[i]![0] * sign, world[i]![1], 0.1 * scale * sign],
      i * 3,
    );
    joints[i * 4] = i;
    weights[i * 4] = 1;
  });
  if (facingMinusZ) {
    // Source faces -Z with x mirrored by the 180 degree yaw: x' = -x.
    BONES.forEach((_b, i) => {
      positions[i * 3] = -world[i]![0];
      positions[i * 3 + 2] = -0.1 * scale;
    });
  }
  const ibm = new Float32Array(BONES.length * 16);
  BONES.forEach((_b, i) => {
    ibm.set(
      [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        -positions[i * 3]! * 0 - world[i]![0],
        -world[i]![1],
        -world[i]![2],
        1,
      ],
      i * 16,
    );
  });
  if (facingMinusZ) {
    // Skeleton is exported already yawed: bone world x and z are negated.
    nodes[0]!.setRotation([0, 1, 0, 0]);
    BONES.forEach((_b, i) => {
      ibm.set(
        [
          -1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          -1,
          0,
          world[i]![0],
          -world[i]![1],
          0,
          1,
        ],
        i * 16,
      );
    });
  }
  const idx = new Uint16Array([0, 1, 2, 2, 3, 4]);
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc
        .createAccessor()
        .setType('VEC3')
        .setArray(positions)
        .setBuffer(buffer),
    )
    .setAttribute(
      'JOINTS_0',
      doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer),
    )
    .setAttribute(
      'WEIGHTS_0',
      doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer),
    )
    .setIndices(
      doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer),
    );
  const skin = doc
    .createSkin('skin')
    .setInverseBindMatrices(
      doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer),
    );
  nodes.forEach(n => skin.addJoint(n));
  const meshNode = doc
    .createNode('body')
    .setMesh(doc.createMesh('body').addPrimitive(prim))
    .setSkin(skin);
  scene.addChild(meshNode);
  if (withAnim) {
    const anim = doc.createAnimation('clip');
    const input = doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer);
    const output = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 1 * scale, 0, 0, 1.5 * scale, 0]))
      .setBuffer(buffer);
    anim.addSampler(
      doc.createAnimationSampler().setInput(input).setOutput(output),
    );
    anim.addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(nodes[1]!)
        .setTargetPath('translation')
        .setSampler(anim.listSamplers()[0]!),
    );
  }
  return doc;
}

function rig(unmapped?: string): RigDefinition {
  const regionBones = Object.fromEntries(
    BODY_REGIONS.map(r => [r, [] as string[]]),
  ) as unknown as RigDefinition['regionBones'];
  regionBones.pelvis = ['root', 'pelvis'];
  regionBones.torso = ['spine_03'];
  regionBones.head = ['Head'];
  regionBones.hands = ['hand_l'];
  if (unmapped)
    for (const r of BODY_REGIONS)
      regionBones[r] = regionBones[r].filter(b => b !== unmapped);
  return {regionBones} as unknown as RigDefinition;
}

function skinnedBounds(doc: Document): {height: number; fwd: number} {
  // Skinned position = jointWorld * IBM * v.
  const node = doc
    .getRoot()
    .listNodes()
    .find(n => n.getSkin())!;
  const skin = node.getSkin()!;
  const prim = node.getMesh()!.listPrimitives()[0]!;
  const pos = prim.getAttribute('POSITION')!;
  const jnt = prim.getAttribute('JOINTS_0')!;
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices()!;
  let min = Infinity;
  let max = -Infinity;
  let z = 0;
  for (let i = 0; i < pos.getCount(); i++) {
    const v = pos.getElement(i, [0, 0, 0]);
    const j = jnt.getElement(i, [0, 0, 0, 0])[0]!;
    const w = joints[j]!.getWorldMatrix();
    const m = ibm.getElement(j, new Array<number>(16).fill(0));
    const a = [0, 1, 2].map(
      r => m[r]! * v[0]! + m[4 + r]! * v[1]! + m[8 + r]! * v[2]! + m[12 + r]!,
    );
    const y = w[1]! * a[0]! + w[5]! * a[1]! + w[9]! * a[2]! + w[13]!;
    const zz = w[2]! * a[0]! + w[6]! * a[1]! + w[10]! * a[2]! + w[14]!;
    min = Math.min(min, y);
    max = Math.max(max, y);
    z += zz;
  }
  return {height: max - min, fwd: z / pos.getCount()};
}

describe('AC-AST-011.1 normalize', () => {
  it('rescales a 100x body to the reference height within 1 percent and keeps names', () => {
    const ref = skinnedBounds(makeBody(1)).height;
    const doc = makeBody(100);
    const res = normalizeDocument(doc, {unitScale: 0.01});
    expect(res.applied).toBe(true);
    expect(Math.abs(skinnedBounds(doc).height / ref - 1)).toBeLessThan(0.01);
    expect(
      doc
        .getRoot()
        .listNodes()
        .map(n => n.getName()),
    ).toContain('Head');
  });
  it('turns a -Z facing body to +Z', () => {
    const doc = makeBody(1, true);
    const before = skinnedBounds(doc).fwd;
    normalizeDocument(doc, {facing: '-z'});
    const after = skinnedBounds(doc);
    expect(before).toBeLessThan(0);
    expect(after.fwd).toBeGreaterThan(0);
    const world = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'hand_l')!
      .getWorldMatrix();
    expect(world[12]).toBeGreaterThan(0);
  });
  it('scales animated root translations and is a no-op for identity options', () => {
    const doc = makeBody(100, false, true);
    normalizeDocument(doc, {unitScale: 0.01});
    const out = doc
      .getRoot()
      .listAnimations()[0]!
      .listSamplers()[0]!
      .getOutput()!;
    expect(out.getElement(1, [0, 0, 0])[1]).toBeCloseTo(1.5, 5);
    const clean = makeBody(1);
    expect(normalizeDocument(clean).applied).toBe(false);
  });
});

describe('AC-AST-011.2 non-uniform armature scale', () => {
  it('bakes the uniform mean scale (cube root of the product), warns AST_NORMALIZE_NONUNIFORM and does not fail', () => {
    const doc = makeBody();
    const scene = doc.getRoot().listScenes()[0]!;
    const root = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'root')!;
    const pelvisBefore = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'pelvis')!
      .getTranslation()[1];
    const armature = doc.createNode('Armature').setScale([1, 1, 1.01]);
    scene.removeChild(root);
    armature.addChild(root);
    scene.addChild(armature);
    const result = normalizeDocument(doc);
    expect(result.applied).toBe(true);
    const mean = Math.cbrt(1.01);
    expect(mean).toBeCloseTo(1.00332, 5);
    const warnings = result.warnings.filter(
      w => w.code === 'AST_NORMALIZE_NONUNIFORM',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('Armature "Armature"');
    const pelvis = doc
      .getRoot()
      .listNodes()
      .find(n => n.getName() === 'pelvis')!;
    expect(pelvis.getTranslation()[1]).toBeCloseTo(pelvisBefore * mean, 6);
  });
});

describe('AC-AST-012 regions', () => {
  const item = {kind: 'part' as const, id: 'body', config: {slot: 'body'}};
  function regionsOf(doc: Document) {
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const acc = prim.getAttribute('_REGION')!;
    const idx = prim.getIndices()!;
    const tris: number[][] = [];
    for (let t = 0; t < idx.getCount() / 3; t++) {
      tris.push([0, 1, 2].map(k => acc.getScalar(idx.getScalar(t * 3 + k))));
    }
    return {prim, acc, idx, tris};
  }
  it('AC-AST-012.1 / 025.1 writes u8 _REGION, constant per triangle', () => {
    const doc = makeBody();
    expect(writeRegions(doc, item, rig()).written).toBe(true);
    const {acc, tris} = regionsOf(doc);
    expect(acc.getComponentType()).toBe(5121);
    expect(acc.getType()).toBe('SCALAR');
    expect(acc.getNormalized()).toBe(false);
    expect(acc.getCount()).toBeGreaterThanOrEqual(BONES.length);
    for (const t of tris) expect(new Set(t).size).toBe(1);
  });
  it('AC-AST-012.1 a triangle spanning regions 0 and 2 gets one region; only boundary vertices are duplicated', () => {
    const doc = makeBody();
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    // Triangles (0,1,2) pelvis-ish and (2,3,4) head/torso/hands share vertex 2.
    const before = prim.getAttribute('POSITION')!.getCount();
    writeRegions(doc, item, rig());
    const after = regionsOf(doc);
    const count = after.acc.getCount();
    expect(count).toBeGreaterThan(before);
    expect(count).toBeLessThanOrEqual(before + 3);
    for (const t of after.tris) expect(new Set(t).size).toBe(1);
    // Duplicated vertices carry identical skinning/position attributes.
    const pos = after.prim.getAttribute('POSITION')!;
    const j = after.prim.getAttribute('JOINTS_0')!;
    const w = after.prim.getAttribute('WEIGHTS_0')!;
    expect(j.getCount()).toBe(count);
    expect(w.getCount()).toBe(count);
    const seenKey = new Map<string, string>();
    for (let v = 0; v < count; v++) {
      const key = pos.getElement(v, [0, 0, 0]).join(',');
      const skin =
        j.getElement(v, [0, 0, 0, 0]).join(',') +
        '|' +
        w.getElement(v, [0, 0, 0, 0]).join(',');
      if (seenKey.has(key)) expect(seenKey.get(key)).toBe(skin);
      seenKey.set(key, skin);
    }
    // Deterministic.
    const again = makeBody();
    writeRegions(again, item, rig());
    expect(Array.from(regionsOf(again).acc.getArray()!)).toEqual(
      Array.from(after.acc.getArray()!),
    );
  });
  it('AC-AST-012.2 unmapped joint fails naming the joint', () => {
    expect(() => writeRegions(makeBody(), item, rig('hand_l'))).toThrow(
      /AST_REGION_UNMAPPED.*hand_l/,
    );
  });
  it('skips non-body items', () => {
    const doc = makeBody();
    expect(
      writeRegions(doc, {kind: 'part', id: 's', config: {slot: 'top'}}, rig())
        .written,
    ).toBe(false);
  });
});

describe('AC-AST-012 regions (fixture triangles)', () => {
  const body = {kind: 'part' as const, id: 'tri-body', config: {slot: 'body'}};
  const regionRig = (): RigDefinition => {
    const regionBones = Object.fromEntries(
      BODY_REGIONS.map(r => [r, [] as string[]]),
    ) as unknown as RigDefinition['regionBones'];
    regionBones['lower-arms'] = ['la'];
    regionBones.hands = ['hd'];
    return {regionBones} as unknown as RigDefinition;
  };

  /** Two-joint skinned mesh; each vertex is [la weight, hd weight]. */
  function triDoc(
    weights: Array<[number, number]>,
    indices: number[],
    withSkinAttributes = true,
  ): Document {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene();
    const la = doc.createNode('la');
    const hd = doc.createNode('hd');
    scene.addChild(la);
    scene.addChild(hd);
    const n = weights.length;
    const positions = new Float32Array(n * 3);
    const normals = new Float32Array(n * 3);
    weights.forEach((_w, i) => {
      positions.set([i * 0.1, i * 0.2 + 1, 0.05 * i], i * 3);
      normals.set([0, 0, 1], i * 3);
    });
    const acc = (
      type: 'VEC3' | 'VEC4' | 'SCALAR',
      array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
    ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', acc('VEC3', positions))
      .setAttribute('NORMAL', acc('VEC3', normals))
      .setIndices(acc('SCALAR', new Uint16Array(indices)));
    if (withSkinAttributes) {
      const joints = new Uint16Array(n * 4);
      const w = new Float32Array(n * 4);
      weights.forEach(([a, h], i) => {
        joints.set([0, 1, 0, 0], i * 4);
        w.set([a, h, 0, 0], i * 4);
      });
      prim
        .setAttribute('JOINTS_0', acc('VEC4', joints))
        .setAttribute('WEIGHTS_0', acc('VEC4', w));
    }
    const skin = doc
      .createSkin('skin')
      .addJoint(la)
      .addJoint(hd)
      .setInverseBindMatrices(
        doc
          .createAccessor()
          .setType('MAT4')
          .setArray(
            new Float32Array([
              1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1,
              0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
            ]),
          )
          .setBuffer(buffer),
      );
    scene.addChild(
      doc
        .createNode('mesh')
        .setMesh(doc.createMesh('m').addPrimitive(prim))
        .setSkin(skin),
    );
    return doc;
  }

  it('AC-AST-012.3: a primitive without JOINTS_0/WEIGHTS_0, or a vertex whose weights are all 0, fails with AST_REGION_UNWEIGHTED naming the body (and the vertex)', () => {
    const noAttrs = triDoc(
      [
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      [0, 1, 2],
      false,
    );
    expect(() => writeRegions(noAttrs, body, regionRig())).toThrow(
      /AST_REGION_UNWEIGHTED.*tri-body/,
    );
    const zeroVertex = triDoc(
      [
        [1, 0],
        [1, 0],
        [0, 0],
      ],
      [0, 1, 2],
    );
    expect(() => writeRegions(zeroVertex, body, regionRig())).toThrow(
      /AST_REGION_UNWEIGHTED.*tri-body.*vertex 2/,
    );
  });

  it('AC-AST-012.4: every triangle has three equal _REGION values, the triangle count equals the source and every source vertex position is in the output', () => {
    const weights: Array<[number, number]> = [
      [1, 0],
      [0, 1],
      [0.6, 0.4],
      [0.2, 0.8],
      [1, 0],
    ];
    const indices = [0, 1, 2, 2, 3, 4, 1, 3, 4];
    const doc = triDoc(weights, indices);
    const before = new Set<string>();
    const pos0 = doc
      .getRoot()
      .listMeshes()[0]!
      .listPrimitives()[0]!
      .getAttribute('POSITION')!;
    for (let i = 0; i < pos0.getCount(); i++) {
      before.add(pos0.getElement(i, [0, 0, 0]).join(','));
    }
    writeRegions(doc, body, regionRig());
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const idx = prim.getIndices()!;
    const region = prim.getAttribute('_REGION')!;
    const pos = prim.getAttribute('POSITION')!;
    expect(idx.getCount() / 3).toBe(indices.length / 3);
    for (let t = 0; t < idx.getCount() / 3; t++) {
      const values = [0, 1, 2].map(k =>
        region.getScalar(idx.getScalar(t * 3 + k)),
      );
      expect(new Set(values).size).toBe(1);
    }
    const after = new Set<string>();
    for (let i = 0; i < pos.getCount(); i++) {
      after.add(pos.getElement(i, [0, 0, 0]).join(','));
    }
    for (const p of before) expect(after.has(p)).toBe(true);
  });

  it('AC-AST-012.5: a triangle with summed weights 1.2 lower-arms and 1.8 hands gets hands (6), its lower-arms neighbour gets lower-arms (5), and the two shared vertices exist once per value with identical attributes', () => {
    expect(BODY_REGIONS.indexOf('lower-arms')).toBe(5);
    expect(BODY_REGIONS.indexOf('hands')).toBe(6);
    const doc = triDoc(
      [
        [0, 1],
        [0.6, 0.4],
        [0.6, 0.4],
        [1, 0],
      ],
      [0, 1, 2, 1, 2, 3],
    );
    writeRegions(doc, body, regionRig());
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const idx = prim.getIndices()!;
    const region = prim.getAttribute('_REGION')!;
    const regionOfTri = (t: number) =>
      [0, 1, 2].map(k => region.getScalar(idx.getScalar(t * 3 + k)));
    expect(regionOfTri(0)).toEqual([6, 6, 6]);
    expect(regionOfTri(1)).toEqual([5, 5, 5]);
    const attrs = (v: number) =>
      ['POSITION', 'NORMAL', 'JOINTS_0', 'WEIGHTS_0']
        .map(s => prim.getAttribute(s)!.getElement(v, [0, 0, 0, 0]).join(','))
        .join('|');
    // Shared vertices 1 and 2: tri 0 corners 1 and 2 hold the first copies, tri 1 corners 0 and 1
    // hold the duplicates.
    for (const [first, second] of [
      [idx.getScalar(1), idx.getScalar(3)],
      [idx.getScalar(2), idx.getScalar(4)],
    ] as const) {
      expect(first).not.toBe(second);
      expect(attrs(first)).toBe(attrs(second));
    }
  });
});

async function withTexture(doc: Document, size: number): Promise<void> {
  const raw = Buffer.alloc(size * size * 3);
  for (let n = 0; n < raw.length; n++) raw[n] = (n * 31 + (n >> 7)) & 255;
  const png = await sharp(raw, {raw: {width: size, height: size, channels: 3}})
    .jpeg()
    .toBuffer();
  const tex = doc
    .createTexture('t')
    .setImage(new Uint8Array(png))
    .setMimeType('image/jpeg');
  const mat = doc.createMaterial('m').setBaseColorTexture(tex);
  doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMaterial(mat);
  const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
  prim.setAttribute(
    'TEXCOORD_0',
    doc
      .createAccessor()
      .setType('VEC2')
      .setArray(new Float32Array(BONES.length * 2))
      .setBuffer(doc.getRoot().listBuffers()[0]!),
  );
}

async function build(): Promise<Uint8Array> {
  const doc = makeBody(1, false, true);
  writeRegions(doc, {kind: 'part', id: 'b', config: {slot: 'body'}}, rig());
  await withTexture(doc, 2048);
  await optimizeDocument(doc, {kind: 'body'});
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });
  return io.writeBinary(doc);
}

describe('AC-AST-010 optimize', () => {
  it('AC-AST-010.1 meshopt + PNG <= 1024, no draco/basisu, names kept', async () => {
    const bytes = await build();
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({'meshopt.decoder': MeshoptDecoder});
    const doc = await io.readBinary(bytes);
    const used = doc
      .getRoot()
      .listExtensionsUsed()
      .map(e => e.extensionName);
    expect(used).toContain(EXTMeshoptCompression.EXTENSION_NAME);
    expect(used).not.toContain('KHR_texture_basisu');
    expect(used).not.toContain('KHR_draco_mesh_compression');
    const tex = doc.getRoot().listTextures()[0]!;
    expect(tex.getMimeType()).toBe('image/png');
    expect(Math.max(...tex.getSize()!)).toBeLessThanOrEqual(1024);
    expect(
      doc
        .getRoot()
        .listNodes()
        .map(n => n.getName())
        .sort(),
    ).toEqual([...BONES, 'body'].sort());
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    expect(prim.getAttribute('_REGION')).not.toBeNull();
    expect(prim.getAttribute('JOINTS_0')).not.toBeNull();
  });
  it('AC-AST-010.2 resample keeps bone transforms within 1e-4', async () => {
    const doc = makeBody(1, false, true);
    const out = doc
      .getRoot()
      .listAnimations()[0]!
      .listSamplers()[0]!
      .getOutput()!;
    const before = [out.getElement(0, [0, 0, 0]), out.getElement(1, [0, 0, 0])];
    await optimizeDocument(doc, {kind: 'clip'});
    const o2 = doc.getRoot().listAnimations()[0]!.listSamplers()[0]!;
    const times = o2.getInput()!;
    for (const t of [0, 1 / 3, 2 / 3, 1]) {
      const lerp = (i: number) =>
        before[0]![i]! + (before[1]![i]! - before[0]![i]!) * t;
      let sampled = -1;
      for (let i = 0; i < times.getCount(); i++)
        if (Math.abs(times.getScalar(i) - t) < 1e-6) sampled = i;
      if (sampled >= 0)
        expect(
          Math.abs(
            o2.getOutput()!.getElement(sampled, [0, 0, 0])[1]! - lerp(1),
          ),
        ).toBeLessThanOrEqual(1e-4);
    }
    expect(doc.getRoot().listNodes().length).toBe(BONES.length + 1);
  });
  it('is deterministic: same input, same bytes', async () => {
    const [a, b] = [await build(), await build()];
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('AC-AST-010.3 texture limits', () => {
  it('textureLimit returns 512 for bodies and 256 for every other kind', async () => {
    const {textureLimit} = await import('./optimize');
    expect(textureLimit('body')).toBe(512);
    expect(textureLimit('part')).toBe(256);
    expect(textureLimit('prop')).toBe(256);
    expect(textureLimit('clip')).toBe(256);
  });
});
