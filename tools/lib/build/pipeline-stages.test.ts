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

describe('AC-AST-012 regions', () => {
  const item = {kind: 'part' as const, id: 'body', config: {slot: 'body'}};
  it('AC-AST-012.1 / 025.1 writes u8 _REGION, hand_l vertices carry hands', () => {
    const doc = makeBody();
    expect(writeRegions(doc, item, rig()).written).toBe(true);
    const acc = doc
      .getRoot()
      .listMeshes()[0]!
      .listPrimitives()[0]!
      .getAttribute('_REGION')!;
    expect(acc.getComponentType()).toBe(5121);
    expect(acc.getType()).toBe('SCALAR');
    expect(acc.getNormalized()).toBe(false);
    expect(acc.getCount()).toBe(BONES.length);
    expect(acc.getScalar(4)).toBe(BODY_REGIONS.indexOf('hands'));
    expect(acc.getScalar(3)).toBe(BODY_REGIONS.indexOf('head'));
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
