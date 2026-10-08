import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Document, NodeIO} from '@gltf-transform/core';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readRigFile, SourceReadError} from './gltf-skeleton.js';
import {verifyFile, DEFAULT_TOLERANCES} from './rig-verify.js';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verify-rig-'));
});
afterAll(async () => {
  await rm(dir, {recursive: true, force: true});
});

async function makeGlb(path: string, withClip: boolean): Promise<void> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const root = doc.createNode('root').setTranslation([0, 1, 0]);
  const arm = doc.createNode('Armature').addChild(root);
  const child = doc.createNode('spine_01').setTranslation([0, 0.5, 0]);
  root.addChild(child);
  const ibm = doc
    .createAccessor()
    .setType('MAT4')
    .setBuffer(buf)
    .setArray(
      new Float32Array([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0,
        0, 0, 1, 0, 0, -1.5, 0, 1,
      ]),
    );
  const skin = doc
    .createSkin()
    .setInverseBindMatrices(ibm)
    .addJoint(root)
    .addJoint(child);
  const pos = doc
    .createAccessor()
    .setType('VEC3')
    .setBuffer(buf)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  const joints = doc
    .createAccessor()
    .setType('VEC4')
    .setBuffer(buf)
    .setArray(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]));
  const weights = doc
    .createAccessor()
    .setType('VEC4')
    .setBuffer(buf)
    .setArray(new Float32Array([0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]));
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', pos)
    .setAttribute('JOINTS_0', joints)
    .setAttribute('WEIGHTS_0', weights);
  const mesh = doc.createMesh('m').addPrimitive(prim);
  const meshNode = doc.createNode('mesh').setMesh(mesh).setSkin(skin);
  doc.createScene().addChild(arm).addChild(meshNode);
  if (withClip) {
    const anim = doc.createAnimation('clip');
    const input = doc
      .createAccessor()
      .setType('SCALAR')
      .setBuffer(buf)
      .setArray(new Float32Array([0, 1]));
    const output = doc
      .createAccessor()
      .setType('VEC3')
      .setBuffer(buf)
      .setArray(new Float32Array([0, 0, 0, 0, 1, 0]));
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output);
    const channel = doc
      .createAnimationChannel()
      .setTargetNode(child)
      .setTargetPath('translation')
      .setSampler(sampler);
    anim.addSampler(sampler).addChannel(channel);
  }
  await new NodeIO().write(path, doc);
}

describe('gltf-skeleton reader', () => {
  it('AC-AST-003.1: reads skeleton, weights and clip targets from a synthetic GLB', async () => {
    const p = join(dir, 'ref.glb');
    await makeGlb(p, true);
    const data = await readRigFile(p, 'ref.glb', 'test');
    expect(data.skeleton?.joints.map(j => j.name)).toEqual([
      'root',
      'spine_01',
    ]);
    expect(data.skeleton?.joints[1]?.parent).toBe('root');
    expect(data.weights?.maxInfluences).toBe(2);
    expect(data.weights?.triangles).toBe(1);
    expect(data.clips?.targetNames).toEqual(['spine_01']);
    const items = verifyFile(data.skeleton!, data, DEFAULT_TOLERANCES);
    expect(items.map(i => [i.kind, i.status])).toEqual([
      ['skinned-mesh', 'pass'],
      ['animation', 'pass'],
    ]);
  });

  it('rejects files without glTF magic bytes', async () => {
    const p = join(dir, 'fake.glb');
    await writeFile(p, 'not a glb at all');
    await expect(readRigFile(p, 'fake.glb', 'test')).rejects.toBeInstanceOf(
      SourceReadError,
    );
  });

  it('refuses remote buffer URIs in .gltf files', async () => {
    const p = join(dir, 'remote.gltf');
    await writeFile(
      p,
      JSON.stringify({
        asset: {version: '2.0'},
        buffers: [{uri: 'https://example.com/x.bin', byteLength: 4}],
      }),
    );
    await expect(readRigFile(p, 'remote.gltf', 'test')).rejects.toThrow(
      /Remote buffer/,
    );
  });
});
