/**
 * Test helpers for `assets:check`: a tiny rig, in-code skinned GLBs and a
 * temp pack builder. Never reads `assets-src/`.
 */
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Document, NodeIO} from '@gltf-transform/core';
import type {Node as GltfNode} from '@gltf-transform/core';
import type {RigDefinition} from '@csg/parts-schema';
import {compose, invert, multiply} from '../mat4.js';
import type {Quat, Vec3} from '../mat4.js';

const BONES = ['root', 'pelvis', 'spine_03', 'Head', 'hand_r', 'hand_l'];
const PARENTS = [null, 'root', 'pelvis', 'spine_03', 'spine_03', 'spine_03'];

/** Rest translation of bone `i` in group `group` (fixture-b moves the pelvis by 0.05 m). */
function restT(i: number, group: string): Vec3 {
  return [0, i + (group === 'fixture-b' && i === 1 ? 0.05 : 0), 0];
}

/** Small valid rig with skeleton groups `fixture-a` and `fixture-b`. */
export function makeTestRig(soleOffsetA?: number): RigDefinition {
  return {
    id: 'test-rig',
    bones: BONES,
    rootBone: 'root',
    lengthAxis: 'y',
    anatomyBones: {
      height: ['root'],
      head: ['Head'],
      torsoWidth: ['spine_03'],
      shoulders: ['spine_03'],
      armLength: ['hand_r'],
      legLength: ['pelvis'],
      hands: ['hand_r', 'hand_l'],
      feet: ['pelvis'],
      limbThickness: ['hand_r'],
    },
    regionBones: {
      head: ['Head'],
      hair: [],
      neck: [],
      torso: ['spine_03'],
      'upper-arms': [],
      'lower-arms': [],
      hands: ['hand_r', 'hand_l'],
      pelvis: ['root', 'pelvis'],
      'upper-legs': [],
      'lower-legs': [],
      feet: [],
    },
    socketBones: {
      hand_r: 'hand_r',
      hand_l: 'hand_l',
      head: 'Head',
      spine_03: 'spine_03',
      pelvis: 'pelvis',
    },
    parents: Object.fromEntries(BONES.map((b, i) => [b, PARENTS[i] ?? null])),
    defaultSkeletonGroup: 'fixture-a',
    skeletonGroups: ['fixture-a', 'fixture-b'].map(id => ({
      id,
      ...(id === 'fixture-a' && soleOffsetA !== undefined
        ? {soleOffsetM: soleOffsetA}
        : {}),
      restPose: Object.fromEntries(
        BONES.map((b, i) => [
          b,
          {
            t: [...restT(i, id)] as [number, number, number],
            r: [0, 0, 0, 1] as [number, number, number, number],
            s: [1, 1, 1] as [number, number, number],
          },
        ]),
      ),
    })),
  };
}

/** Options of {@link makeGlb}. */
export interface GlbOptions {
  /** Skeleton group whose rest pose the skin has. */
  group?: string;
  /** Rename a joint node (structural mismatch). */
  renameJoint?: [string, string];
  /** Triangles in the mesh (3 vertices each). */
  triangles?: number;
  /** Non-zero influences on vertex 0 (1..8); other vertices have 1. */
  influences?: number;
  /** Value written to the `_REGION` attribute (u8) of every vertex; omit for no attribute. */
  region?: number;
  /** Added to the Y of every vertex (sole offset tests, REQ-AST-030). */
  yOffset?: number;
  /** No skin (static prop). */
  noSkin?: boolean;
  /** Add an animation targeting the joints (clip file, no skin). */
  clip?: boolean;
}

/** Builds a tiny GLB and returns its bytes. */
export async function makeGlb(options: GlbOptions = {}): Promise<Uint8Array> {
  const group = options.group ?? 'fixture-a';
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const nodes: GltfNode[] = [];
  const worlds: number[][] = [];
  BONES.forEach((name, i) => {
    const t = restT(i, group);
    const node = doc
      .createNode(
        options.renameJoint && options.renameJoint[0] === name
          ? options.renameJoint[1]
          : name,
      )
      .setTranslation([...t]);
    nodes.push(node);
    const parentIndex =
      PARENTS[i] === null ? -1 : BONES.indexOf(PARENTS[i] as string);
    const local = compose(t, [0, 0, 0, 1] as Quat, [1, 1, 1] as Vec3);
    const parentWorld = parentIndex >= 0 ? worlds[parentIndex] : undefined;
    worlds.push(parentWorld ? multiply(parentWorld, local) : local);
    if (parentIndex >= 0) nodes[parentIndex]?.addChild(node);
    else scene.addChild(node);
  });
  if (options.clip) {
    const anim = doc.createAnimation('idle');
    const input = doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer);
    const output = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 0, 0.1, 0]))
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output);
    const ch = doc
      .createAnimationChannel()
      .setTargetNode(nodes[1] as GltfNode)
      .setTargetPath('translation')
      .setSampler(sampler);
    anim.addSampler(sampler).addChannel(ch);
    return new NodeIO().writeBinary(doc);
  }
  const tris = options.triangles ?? 1;
  const verts = tris * 3;
  const pos = new Float32Array(verts * 3);
  for (let v = 0; v < verts; v++)
    pos.set(
      [v % 7, (Math.floor(v / 7) % 5) + (options.yOffset ?? 0), v % 3],
      v * 3,
    );
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer),
    );
  if (!options.noSkin) {
    const n = Math.min(Math.max(options.influences ?? 1, 1), 8);
    const j0 = new Uint8Array(verts * 4);
    const j1 = new Uint8Array(verts * 4);
    const w0 = new Float32Array(verts * 4);
    const w1 = new Float32Array(verts * 4);
    for (let v = 0; v < verts; v++) {
      const count = v === 0 ? n : 1;
      for (let k = 0; k < count; k++) {
        const set = k < 4 ? 0 : 1;
        (set === 0 ? j0 : j1)[v * 4 + (k % 4)] = k % BONES.length;
        (set === 0 ? w0 : w1)[v * 4 + (k % 4)] = 1 / count;
      }
    }
    prim.setAttribute(
      'JOINTS_0',
      doc.createAccessor().setType('VEC4').setArray(j0).setBuffer(buffer),
    );
    prim.setAttribute(
      'WEIGHTS_0',
      doc.createAccessor().setType('VEC4').setArray(w0).setBuffer(buffer),
    );
    if (n > 4) {
      prim.setAttribute(
        'JOINTS_1',
        doc.createAccessor().setType('VEC4').setArray(j1).setBuffer(buffer),
      );
      prim.setAttribute(
        'WEIGHTS_1',
        doc.createAccessor().setType('VEC4').setArray(w1).setBuffer(buffer),
      );
    }
  }
  if (options.region !== undefined) {
    prim.setAttribute(
      '_REGION',
      doc
        .createAccessor()
        .setType('SCALAR')
        .setArray(new Uint8Array(verts).fill(options.region))
        .setBuffer(buffer),
    );
  }
  const meshNode = doc
    .createNode('mesh')
    .setMesh(doc.createMesh('m').addPrimitive(prim));
  if (!options.noSkin) {
    const skin = doc.createSkin('skin');
    const ibm = new Float32Array(BONES.length * 16);
    worlds.forEach((w, i) => ibm.set(invert(w) ?? [], i * 16));
    skin.setInverseBindMatrices(
      doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer),
    );
    nodes.forEach(n => skin.addJoint(n));
    meshNode.setSkin(skin);
  }
  scene.addChild(meshNode);
  return new NodeIO().writeBinary(doc);
}

/** SHA-256 hex of bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const makeLicense = () => ({
  license: 'CC0-1.0',
  author: 'Quaternius',
  sourceUrl: 'https://quaternius.com',
  commercialUse: 'yes',
  attributionRequired: false,
});

/** One part of a test pack. */
export interface TestPart {
  id: string;
  slot?: string;
  kind?: 'skinned' | 'static';
  glb?: GlbOptions;
}

/** Roots of a temp repo layout written by {@link writeTestPack}. */
export interface TestRepo {
  packsDir: string;
  configsDir: string;
  rigsDir: string;
}

/**
 * Writes rig, pack.config.json, manifest.json, GLBs and (optionally) clips
 * for one pack under `root`. Returns the manifest and config objects so tests
 * can mutate and rewrite them.
 */
export async function writeTestPack(
  root: string,
  packId: string,
  parts: TestPart[],
  clips: string[] = [],
  /** `soleOffsetM` stored on group `fixture-a` of the rig and its manifest copy. */
  soleOffsetA?: number,
): Promise<{
  repo: TestRepo;
  manifest: Record<string, unknown>;
  config: Record<string, unknown>;
}> {
  const repo: TestRepo = {
    packsDir: join(root, 'assets/packs'),
    configsDir: join(root, 'tools/packs'),
    rigsDir: join(root, 'rigs'),
  };
  const rig = makeTestRig(soleOffsetA);
  mkdirSync(repo.rigsDir, {recursive: true});
  writeFileSync(join(repo.rigsDir, 'test-rig.json'), JSON.stringify(rig));
  const packDir = join(repo.packsDir, packId);
  mkdirSync(join(packDir, 'parts'), {recursive: true});
  mkdirSync(join(packDir, 'clips'), {recursive: true});
  mkdirSync(join(repo.configsDir, packId), {recursive: true});
  const configParts = parts.map(p => ({
    id: p.id,
    match: {file: `${p.id}.gltf`},
    name: p.id,
    slot: p.slot ?? 'top',
    hides: [],
    tintSlots: [],
    tags: [],
    ...(p.kind === 'static' ? {socket: {socketId: 'hand_r'}} : {}),
  }));
  const config = {
    format: 'sprite-pack-config',
    version: 1,
    packId,
    name: 'Test pack',
    license: makeLicense(),
    rig: 'test-rig',
    parts: configParts,
    clips: clips.map(id => ({
      id,
      match: {file: `${id}.gltf`, animation: 'idle'},
      name: id,
      category: 'locomotion',
      loop: true,
      defaultFrameCount: 8,
      tags: [],
    })),
  };
  const manifestParts: Record<string, unknown>[] = [];
  for (const p of parts) {
    const bytes = await makeGlb(p.glb);
    writeFileSync(join(packDir, `parts/${p.id}.glb`), bytes);
    const c = configParts.find(x => x.id === p.id) as Record<string, unknown>;
    const glb = p.glb ?? {};
    manifestParts.push({
      ...c,
      match: undefined,
      kind: p.kind ?? 'skinned',
      file: `parts/${p.id}.glb`,
      ...(p.kind === 'static'
        ? {}
        : {rig: 'test-rig', skeletonGroup: glb.group ?? 'fixture-a'}),
      sha256: sha256Hex(bytes),
      stats: {triangles: glb.triangles ?? 1, textures: 0},
      thumbnail: `thumbnails/${p.id}.webp`,
    });
    mkdirSync(join(packDir, 'thumbnails'), {recursive: true});
    writeFileSync(join(packDir, `thumbnails/${p.id}.webp`), 'x');
  }
  const manifest = {
    format: 'sprite-parts-manifest',
    version: 1,
    packId,
    name: 'Test pack',
    license: makeLicense(),
    rigs: [rig],
    parts: manifestParts,
  };
  if (clips.length > 0) {
    const bytes = await makeGlb({clip: true});
    const entries = clips.map(id => {
      writeFileSync(join(packDir, `clips/${id}.glb`), bytes);
      return {
        id,
        name: id,
        category: 'locomotion',
        file: `clips/${id}.glb`,
        sourceName: 'idle',
        rig: 'test-rig',
        durationSec: 1,
        loop: true,
        defaultFrameCount: 8,
        hasRootMotion: false,
        tags: [],
        sha256: sha256Hex(bytes),
        skeletonGroup: 'fixture-a',
      };
    });
    writeFileSync(
      join(packDir, 'clips.json'),
      JSON.stringify({
        format: 'sprite-clips-manifest',
        version: 1,
        packId,
        name: 'Test pack',
        license: makeLicense(),
        clips: entries,
      }),
    );
  }
  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(
    join(repo.configsDir, packId, 'pack.config.json'),
    JSON.stringify(config),
  );
  return {repo, manifest, config};
}

/** Rewrites a pack's manifest.json (simulates a hand edit). */
export function rewriteManifest(
  root: string,
  packId: string,
  manifest: unknown,
): void {
  writeFileSync(
    join(root, 'assets/packs', packId, 'manifest.json'),
    JSON.stringify(manifest),
  );
}
