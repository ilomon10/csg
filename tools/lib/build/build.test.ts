import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Document, NodeIO} from '@gltf-transform/core';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {loadPackFromText, parseAssetSources} from './config.js';
import {checkSources, hashSourceTree} from './sources.js';
import {splitPack} from './split.js';
import {BuildError} from './types.js';
import type {LoadedPack} from './types.js';
import {parseArgs, runBuild} from '../../build-parts.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'build-'));
});
afterEach(() => rmSync(tmp, {recursive: true, force: true}));

function put(dir: string, rel: string, data: string | Uint8Array): void {
  const p = join(dir, rel);
  mkdirSync(join(p, '..'), {recursive: true});
  writeFileSync(p, data);
}

describe('AC-AST-024.1/.2/.3 tree hash', () => {
  it('matches the spec formula and is order independent', async () => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    put(a, 'a.txt', 'a');
    put(a, 'sub/b.txt', 'b');
    put(b, 'sub/b.txt', 'b');
    put(b, 'a.txt', 'a');
    const expected = sha(`a.txt\0${sha('a')}\nsub/b.txt\0${sha('b')}\n`);
    expect(await hashSourceTree(a)).toBe(expected);
    expect(await hashSourceTree(b)).toBe(expected);
  });
  it('changes on edit/rename, not on empty dir', async () => {
    const a = join(tmp, 'a');
    put(a, 'a.txt', 'a');
    put(a, 'sub/b.txt', 'b');
    const base = await hashSourceTree(a);
    mkdirSync(join(a, 'empty'));
    expect(await hashSourceTree(a)).toBe(base);
    put(a, 'sub/b.txt', 'c');
    expect(await hashSourceTree(a)).not.toBe(base);
    put(a, 'sub/b.txt', 'b');
    put(a, 'sub/c.txt', 'b');
    rmSync(join(a, 'sub/b.txt'));
    expect(await hashSourceTree(a)).not.toBe(base);
  });
  it('refuses symbolic links', async () => {
    const a = join(tmp, 'a');
    put(a, 'a.txt', 'a');
    symlinkSync('/etc/hostname', join(a, 'link'));
    await expect(hashSourceTree(a)).rejects.toMatchObject({
      code: 'AST_SOURCE_FORMAT',
    });
  });
});

function pack(overrides: Partial<LoadedPack> = {}): LoadedPack {
  const text = JSON.stringify({
    format: 'sprite-pack-config',
    version: 1,
    packId: 'p',
    name: 'P',
    license: {
      license: 'CC0-1.0',
      author: 'A',
      sourceUrl: 'https://example.com',
      commercialUse: 'yes',
      attributionRequired: false,
    },
    rig: 'fixture-ue5-22',
    parts: [
      {
        id: 'shirt',
        match: {file: 'src.glb', node: 'Shirt*'},
        name: 'Shirt',
        slot: 'top',
        hides: [],
        tintSlots: [],
        tags: [],
      },
      {
        id: 'pants',
        match: {file: 'src.glb', node: 'Pants'},
        name: 'Pants',
        slot: 'bottom',
        hides: [],
        tintSlots: [],
        tags: [],
      },
      {
        id: 'hat',
        match: {file: 'src.glb', node: 'Hat'},
        name: 'Hat',
        slot: 'hat',
        hides: [],
        tintSlots: [],
        tags: [],
      },
    ],
    clips: [
      {
        id: 'walk',
        match: {file: 'src.glb', animation: 'Walk'},
        name: 'Walk',
        category: 'locomotion',
        loop: true,
        defaultFrameCount: 8,
        tags: [],
      },
    ],
  });
  const loaded = loadPackFromText(text, 'p.json', [
    {
      packId: 'p',
      name: 'P',
      vendorUrl: 'https://v',
      tier: 'standard',
      dir: 'Vendor Pack[Standard]',
    },
  ]);
  return {...loaded, ...overrides};
}

async function sourceDoc(): Promise<Document> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const root = doc.createNode('root');
  const hip = doc.createNode('pelvis');
  root.addChild(hip);
  scene.addChild(root);
  const joints = [root, hip];
  for (const [i, name] of ['Shirt_A', 'Pants', 'Hat'].entries()) {
    const tex = doc
      .createTexture(`tex-${name}`)
      .setImage(new Uint8Array([i]))
      .setMimeType('image/png');
    const mat = doc.createMaterial(`mat-${name}`).setBaseColorTexture(tex);
    const pos = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setBuffer(buf);
    const jts = doc
      .createAccessor()
      .setType('VEC4')
      .setArray(new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]))
      .setBuffer(buf);
    const wts = doc
      .createAccessor()
      .setType('VEC4')
      .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
      .setBuffer(buf);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', pos)
      .setAttribute('JOINTS_0', jts)
      .setAttribute('WEIGHTS_0', wts)
      .setMaterial(mat);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    const skin = doc.createSkin(`skin-${name}`);
    joints.forEach(j => skin.addJoint(j));
    skin.setInverseBindMatrices(
      doc
        .createAccessor()
        .setType('MAT4')
        .setBuffer(buf)
        .setArray(
          new Float32Array([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0,
            0, 0, 0, 1, 0, 0, 0, 0, 1,
          ]),
        ),
    );
    scene.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin));
  }
  for (const name of ['Walk', 'Run']) {
    const anim = doc.createAnimation(name);
    const input = doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buf);
    const output = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 0, 1, 0]))
      .setBuffer(buf);
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output);
    anim
      .addSampler(sampler)
      .addChannel(
        doc
          .createAnimationChannel()
          .setTargetNode(hip)
          .setTargetPath('translation')
          .setSampler(sampler),
      );
  }
  return doc;
}

describe('split', () => {
  const srcRoot = () => join(tmp, 'assets-src');
  async function writeSource(): Promise<void> {
    const bytes = await new NodeIO().writeBinary(await sourceDoc());
    put(join(srcRoot(), 'Vendor Pack[Standard]'), 'src.glb', bytes);
  }

  it('AC-AST-009.1 one mesh, skeleton, own materials/textures per part; vendor dir with spaces and brackets', async () => {
    await writeSource();
    const items = await splitPack(pack(), {srcRoot: srcRoot()});
    const parts = items.filter(i => i.kind === 'part');
    expect(parts.map(p => p.id)).toEqual(['shirt', 'pants', 'hat']);
    for (const p of parts) {
      const root = p.doc.getRoot();
      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listMaterials()).toHaveLength(1);
      expect(root.listTextures()).toHaveLength(1);
      expect(root.listSkins()).toHaveLength(1);
      expect(root.listAnimations()).toHaveLength(0);
      expect(
        root
          .listSkins()[0]!
          .listJoints()
          .map(j => j.getName()),
      ).toEqual(['root', 'pelvis']);
    }
    expect(parts[0]!.doc.getRoot().listMeshes()[0]!.getName()).toBe('Shirt_A');
  });

  it('clip keeps skeleton and exactly one animation, no meshes', async () => {
    await writeSource();
    const clip = (await splitPack(pack(), {srcRoot: srcRoot()})).find(
      i => i.kind === 'clip',
    )!;
    const root = clip.doc.getRoot();
    expect(root.listAnimations().map(a => a.getName())).toEqual(['Walk']);
    expect(root.listMeshes()).toHaveLength(0);
    expect(root.listNodes().map(n => n.getName())).toEqual(
      expect.arrayContaining(['root', 'pelvis']),
    );
  });

  it('AC-AST-009.2 unmatched pattern fails with AST_CONFIG_UNMATCHED naming it', async () => {
    await writeSource();
    const p = pack();
    p.config.parts[1]!.match.node = 'Nope*';
    const err = await splitPack(p, {srcRoot: srcRoot()}).catch(e => e);
    expect(err).toBeInstanceOf(BuildError);
    expect(err.code).toBe('AST_CONFIG_UNMATCHED');
    expect(err.message).toContain('Nope*');
  });

  it('AC-AST-009.2 unmatched animation name fails', async () => {
    await writeSource();
    const p = pack();
    p.config.clips[0]!.match.animation = 'Fly';
    await expect(splitPack(p, {srcRoot: srcRoot()})).rejects.toMatchObject({
      code: 'AST_CONFIG_UNMATCHED',
    });
  });

  it('AC-AST-002.1 .fbx fails with AST_SOURCE_FORMAT naming the file and recipe', async () => {
    const p = pack();
    p.config.parts[0]!.match.file = 'model.fbx';
    const err = await splitPack(p, {srcRoot: srcRoot()}).catch(e => e);
    expect(err.code).toBe('AST_SOURCE_FORMAT');
    expect(err.message).toContain('model.fbx');
    expect(err.message).toContain('docs/contributing/assets.md');
  });

  it('AC-AST-002.1 a .glb without glTF magic fails with AST_SOURCE_FORMAT', async () => {
    put(
      join(srcRoot(), 'Vendor Pack[Standard]'),
      'src.glb',
      'not a glb at all',
    );
    await expect(splitPack(pack(), {srcRoot: srcRoot()})).rejects.toMatchObject(
      {code: 'AST_SOURCE_FORMAT'},
    );
  });
});

describe('checkSources', () => {
  it('AC-AST-001.2 hash mismatch -> AST_SOURCE_HASH_MISMATCH exit 2 naming pack and hashes', async () => {
    const src = join(tmp, 'assets-src');
    put(join(src, 'Vendor Pack[Standard]'), 'a.txt', 'a');
    const p = pack();
    p.source = {...p.source!, treeSha256: 'f'.repeat(64)};
    const err = await checkSources([p], src).catch(e => e);
    expect(err).toMatchObject({code: 'AST_SOURCE_HASH_MISMATCH', exitCode: 2});
    expect(err.message).toContain('"p"');
    expect(err.message).toContain('f'.repeat(64));
    expect(err.message).toContain(
      await hashSourceTree(join(src, 'Vendor Pack[Standard]')),
    );
  });
  it('accepts a matching hash and reports unrecorded', async () => {
    const src = join(tmp, 'assets-src');
    const dir = join(src, 'Vendor Pack[Standard]');
    put(dir, 'a.txt', 'a');
    const p = pack();
    expect((await checkSources([p], src))[0]!.status).toBe('unrecorded');
    p.source = {...p.source!, treeSha256: await hashSourceTree(dir)};
    expect((await checkSources([p], src))[0]!.status).toBe('ok');
  });
  it('AC-AST-001.3 missing folder prints download instructions, exit 2', async () => {
    const err = await checkSources([pack()], join(tmp, 'assets-src')).catch(
      e => e,
    );
    expect(err).toMatchObject({code: 'AST_SOURCE_MISSING', exitCode: 2});
    expect(err.message).toContain('https://v');
    expect(err.message).toContain('standard');
    expect(err.message).toContain('Vendor Pack[Standard]');
  });
});

describe('config and CLI', () => {
  it('parseAssetSources defaults dir to packId and rejects path dirs', () => {
    expect(parseAssetSources('{"packs":[{"packId":"x"}]}')[0]!.dir).toBe('x');
    expect(() =>
      parseAssetSources('{"packs":[{"packId":"x","dir":"a/b"}]}'),
    ).toThrow(/dir/);
  });
  it('invalid config lists issues as AST_CONFIG_INVALID', () => {
    expect(() => loadPackFromText('{"format":"nope"}', 'x.json', [])).toThrow(
      /AST_CONFIG_INVALID/,
    );
  });
  it('parseArgs reads flags', () => {
    const o = parseArgs([
      '--pack',
      'a',
      '--pack',
      'b',
      '--src',
      '/s',
      '--out',
      '/o',
    ]);
    expect(o).toMatchObject({packs: ['a', 'b'], src: '/s', out: '/o'});
    expect(() => parseArgs(['--bogus'])).toThrow(/AST_USAGE|unknown/);
  });
  it('runBuild runs config -> sources -> split on a temp repo', async () => {
    const root = tmp;
    const p = pack();
    put(root, 'tools/packs/p/pack.config.json', JSON.stringify(p.config));
    put(
      root,
      'tools/asset-sources.json',
      JSON.stringify({
        packs: [
          {
            packId: 'p',
            name: 'P',
            vendorUrl: 'https://v',
            tier: 'standard',
            dir: 'Vendor Pack[Standard]',
          },
        ],
      }),
    );
    put(
      join(root, 'assets-src', 'Vendor Pack[Standard]'),
      'src.glb',
      await new NodeIO().writeBinary(await sourceDoc()),
    );
    // The full pipeline needs the rig file; the temp repo has none (stages are tested separately).
    const err = await runBuild(parseArgs([], root)).catch(e => e);
    expect(err).toMatchObject({code: 'AST_RIG_MISSING', exitCode: 2});
  });
});
