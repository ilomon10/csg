import {readFileSync} from 'node:fs';
import {Bone, Group, Quaternion, Skeleton} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {describe, expect, it} from 'vitest';
import {
  clipManifestSchema,
  rigDefinitionSchema,
  type ClipEntry,
  type ClipRef,
  type RigDefinition,
} from '@csg/parts-schema';
import type {BodySkeleton} from '../contracts/composition';
import type {LoadedClip} from '../contracts/registry';
import type {RestPose} from '../retarget';
import {
  RETARGET_CACHE_SIZE,
  computeSampleTimes,
  createClipPlayer,
  defaultFps,
  inPlaceVariantRef,
  playbackSpeed,
  retargetClip,
} from './index';

const FIXTURES = new URL('../../test/fixtures/', import.meta.url);
const bytes = (path: string): Uint8Array =>
  readFileSync(new URL(path, FIXTURES));
const text = (url: URL): string => new TextDecoder().decode(readFileSync(url));

const rig: RigDefinition = rigDefinitionSchema.parse(
  JSON.parse(text(new URL('rigs/fixture-ue5-22.json', FIXTURES))),
);
const clipEntry: ClipEntry = clipManifestSchema.parse(
  JSON.parse(text(new URL('pack/clips.json', FIXTURES))),
).clips[0] as ClipEntry;
const CLIP_REF: ClipRef = 'builtin:fixture-pack/fixture-clip';

function restOf(groupId: string): RestPose {
  const group = rig.skeletonGroups.find(g => g.id === groupId);
  if (group === undefined) throw new Error(groupId);
  return {
    id: groupId,
    joints: rig.bones.map(name => {
      const r = group.restPose[name];
      if (r === undefined) throw new Error(name);
      return {
        name,
        parent: rig.parents[name] ?? null,
        translation: [r.t[0], r.t[1], r.t[2]],
        rotation: [r.r[0], r.r[1], r.r[2], r.r[3]],
        scale: [r.s[0], r.s[1], r.s[2]],
      };
    }),
  };
}

/** A character skeleton from rig rest data (what M1-21 builds). */
function makeBody(groupId: string): BodySkeleton {
  const rest = restOf(groupId);
  const bones = new Map<string, Bone>();
  const root = new Group();
  for (const j of rest.joints) {
    const bone = new Bone();
    bone.name = j.name;
    bone.position.fromArray(j.translation);
    bone.quaternion.fromArray(j.rotation);
    bone.scale.fromArray(j.scale);
    bones.set(j.name, bone);
    (j.parent === null ? root : (bones.get(j.parent) as Bone)).add(bone);
  }
  return {
    rig,
    skeletonGroupId: groupId,
    rest,
    root,
    bones,
    skeleton: new Skeleton([...bones.values()]),
  };
}

let fixtureClip: LoadedClip | undefined;
async function loadFixtureClip(): Promise<LoadedClip> {
  if (fixtureClip !== undefined) return fixtureClip;
  const bin = bytes('pack/clips/fixture-clip.glb');
  const buffer = bin.buffer.slice(
    bin.byteOffset,
    bin.byteOffset + bin.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const clip = gltf.animations.find(a => a.name === clipEntry.sourceName);
  if (clip === undefined) throw new Error('fixture clip missing');
  fixtureClip = {
    ref: CLIP_REF,
    entry: clipEntry,
    durationSec: clipEntry.durationSec,
    clip,
    rig,
    source: restOf('fixture-b'),
  };
  return fixtureClip;
}

const K = 174 / 215;
const FRAMES = computeSampleTimes({frameCount: 8, fps: 8, loop: true}, 1).times;

/** Rotation angle between two quaternions; atan2 form, accurate near zero. */
function angle(a: Quaternion, b: Quaternion): number {
  const d = a.clone().multiply(b.clone().invert());
  return 2 * Math.atan2(Math.hypot(d.x, d.y, d.z), Math.abs(d.w));
}

describe('animation: sample times (REQ-ANM-007)', () => {
  it('AC-ANM-007.1: fit + loop, N = 8 gives i/8 exactly', () => {
    const {times, warnings} = computeSampleTimes(
      {frameCount: 8, fps: 8, loop: true, timing: 'fit'},
      1,
    );
    expect(times).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
    expect(warnings).toEqual([]);
  });

  it('AC-ANM-007.2: fit without loop includes first and last pose', () => {
    expect(
      computeSampleTimes({frameCount: 5, fps: 5, loop: false}, 1).times,
    ).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(
      computeSampleTimes({frameCount: 1, fps: 5, loop: false}, 1).times,
    ).toEqual([0]);
  });

  it('AC-ANM-007.3: fixed-fps clamps to the end and warns', () => {
    const {times, warnings} = computeSampleTimes(
      {frameCount: 15, fps: 10, loop: true, timing: 'fixed-fps'},
      1,
    );
    expect(times.slice(0, 10)).toEqual(
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((_, i) => i / 10),
    );
    expect(times.slice(10)).toEqual([1, 1, 1, 1, 1]);
    expect(warnings).toEqual([
      {code: 'ANM_FIXED_FPS_CLAMPED', frames: [10, 11, 12, 13, 14]},
    ]);
  });

  it('REQ-ANM-007: honors the range start and end', () => {
    const {times} = computeSampleTimes(
      {
        frameCount: 4,
        fps: 4,
        loop: true,
        range: {startSec: 0.5, endSec: 1.5},
      },
      2,
    );
    expect(times).toEqual([0.5, 0.75, 1, 1.25]);
  });

  it('AC-ANM-007.4: the sampler reads no wall clock, random or mixer time', () => {
    for (const file of ['sample-times.ts', 'clip-player.ts']) {
      const source = text(new URL(file, import.meta.url));
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code).not.toMatch(
        /Date\.now|performance\.now|Math\.random|AnimationMixer/,
      );
    }
  });
});

describe('animation: default fps (REQ-ANM-009)', () => {
  it('AC-ANM-009.1: D = 1.2 s, N = 8 gives 7 fps and 14 fps plays at 2.1x', () => {
    expect(defaultFps(8, 1.2)).toBe(7);
    expect(playbackSpeed(14, 1.2, 8)).toBe(2.1);
  });

  it('REQ-ANM-009: clamps to 1-60', () => {
    expect(defaultFps(64, 0.5)).toBe(60);
    expect(defaultFps(1, 10)).toBe(1);
  });
});

describe('animation: retarget adapter (REQ-ANM-023)', () => {
  it('AC-ANM-023.2: k from the spec leg length (pelvis above lowest foot) is 174/215', () => {
    const height = (groupId: string): number => {
      const rest = restOf(groupId);
      const byName = new Map(rest.joints.map(j => [j.name, j]));
      const worldY = (name: string): number => {
        let y = 0;
        for (
          let j = byName.get(name);
          j !== undefined;
          j = j.parent === null ? undefined : byName.get(j.parent)
        ) {
          // Leg chains have identity rest rotations, so translations add up.
          expect(j.rotation).toEqual([0, 0, 0, 1]);
          y += j.translation[1];
        }
        return y;
      };
      const feet = rig.anatomyBones.feet.map(worldY);
      return worldY(rig.socketBones.pelvis as string) - Math.min(...feet);
    };
    expect(height('fixture-a')).toBeCloseTo(0.87, 12);
    expect(height('fixture-b')).toBeCloseTo(1.075, 12);
    expect(height('fixture-a') / height('fixture-b')).toBeCloseTo(K, 12);
  });

  it('AC-ANM-023.3: same group, or an identity plan, returns the same AnimationClip', async () => {
    const clip = await loadFixtureClip();
    const same = retargetClip(clip, makeBody('fixture-b'));
    expect(same.ok && same.value.clip).toBe(clip.clip);
    const renamed: LoadedClip = {
      ...clip,
      entry: {...clip.entry, skeletonGroup: 'other-group'},
    };
    const identity = retargetClip(renamed, makeBody('fixture-b'));
    expect(identity.ok && identity.value.clip).toBe(clip.clip);
  });

  it('AC-ANM-023.3: raw samples equal the documented keyframes on the clip skeleton', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-b');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    player.seek(0.5);
    const elbow = body.bones.get('lowerarm_l') as Bone;
    const documented = new Quaternion(
      0.25783416,
      0.022557566,
      0.084185983,
      0.962250187,
    );
    expect(angle(elbow.quaternion, documented)).toBeLessThan(1e-6);
    expect((body.bones.get('pelvis') as Bone).position.z).toBeCloseTo(0.1, 6);
  });

  it('AC-ANM-023.1: fixture-b clip on fixture-a at t = 0 equals the fixture-a rest', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    player.seek(0);
    for (const [name, bone] of body.bones) {
      expect(angle(bone.quaternion, new Quaternion()), name).toBeLessThan(1e-5);
    }
  });

  it('AC-ANM-023.1: at t = 0.5 the elbow delta of +30 deg about X is preserved', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    player.seek(0.5);
    const elbow = body.bones.get('lowerarm_l') as Bone;
    const expected = new Quaternion().setFromAxisAngle(
      {x: 1, y: 0, z: 0} as never,
      Math.PI / 6,
    );
    expect(angle(elbow.quaternion, expected)).toBeLessThan(1e-4);
  });

  it('AC-ANM-023.2: pelvis travel is scaled by k = L_t / L_s on frames 0-7', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    const pelvis = body.bones.get('pelvis') as Bone;
    for (const t of FRAMES) {
      player.seek(t);
      const source = t <= 0.5 ? 0.2 * t : 0.2 * (1 - t);
      expect(pelvis.position.y).toBeCloseTo(0.87, 6);
      expect(pelvis.position.z).toBeCloseTo(source * K, 6);
    }
  });
});

describe('animation: clip player (REQ-ANM-008, 013, 014)', () => {
  it('AC-ANM-008.1: frame 3 is bit-identical sampled forward or backward', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'in-place');
    const snapshot = (): number[] =>
      [...body.bones.values()].flatMap(b => [
        ...b.position.toArray(),
        ...b.quaternion.toArray(),
        ...b.scale.toArray(),
      ]);
    for (const t of FRAMES) player.seek(t);
    player.seek(FRAMES[3] as number);
    const forward = snapshot();
    for (const t of [...FRAMES].reverse()) player.seek(t);
    player.seek(FRAMES[3] as number);
    expect(snapshot()).toEqual(forward);
  });

  it('AC-ANM-013.3: in-place keeps root X/Z at frame 0 and Y on the keyframes', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'in-place');
    const root = body.bones.get('root') as Bone;
    player.seek(FRAMES[0] as number);
    const [x0, , z0] = root.position.toArray();
    for (const t of FRAMES) {
      player.seek(t);
      expect(Math.abs(root.position.x - (x0 as number))).toBeLessThan(1e-6);
      expect(Math.abs(root.position.z - (z0 as number))).toBeLessThan(1e-6);
      expect(Math.abs(root.position.y)).toBeLessThan(1e-6);
    }
    // The hip is not root motion: its forward travel stays.
    player.seek(0.5);
    expect((body.bones.get('pelvis') as Bone).position.z).toBeGreaterThan(0.05);
  });

  it('AC-ANM-013.1: metadata mode keeps the retargeted root travel', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    player.seek(0.5);
    expect((body.bones.get('root') as Bone).position.z).toBeCloseTo(0.5 * K, 6);
  });

  it('AC-ANM-013.2: stripping is applied after retarget and keeps Y of a jump', async () => {
    const clip = await loadFixtureClip();
    // A clip with root Y travel: stripped X/Z, Y scaled by k like any root translation.
    const jump = clip.clip.clone();
    const root = jump.tracks.find(t => t.name === 'root.position');
    if (root === undefined) throw new Error('no root track');
    root.values.set([0.3, 0, 0.1, 0.3, 0.2, 0.4, 0.3, 0, 0.9]);
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip({...clip, clip: jump}, 'in-place');
    player.seek(0.5);
    const p = (body.bones.get('root') as Bone).position;
    expect(p.x).toBeCloseTo(0.3 * K, 6);
    expect(p.z).toBeCloseTo(0.1 * K, 6);
    expect(p.y).toBeCloseTo(0.2 * K, 6);
  });

  it('AC-ANM-014.1: the in-place variant ref is the source the player logs', async () => {
    const clip = await loadFixtureClip();
    const ref = inPlaceVariantRef(CLIP_REF, {
      inPlaceVariant: 'fixture-clip-ip',
    });
    expect(ref).toBe('builtin:fixture-pack/fixture-clip-ip');
    expect(inPlaceVariantRef(CLIP_REF, {})).toBeUndefined();
    const player = createClipPlayer(makeBody('fixture-a'));
    player.setClip({...clip, ref: ref as ClipRef}, 'in-place');
    expect(player.log.at(-1)).toBe(`source:${ref}`);
  });

  it('REQ-ANM-023: second setClip hits the cache; the 17th clip evicts the first', async () => {
    const clip = await loadFixtureClip();
    const player = createClipPlayer(makeBody('fixture-a'));
    player.setClip(clip, 'in-place');
    player.setClip(clip, 'in-place');
    expect(player.log.filter(l => l.startsWith('retarget:'))).toEqual([
      'retarget:miss',
      'retarget:hit',
    ]);
    for (let i = 0; i < RETARGET_CACHE_SIZE; i++) {
      player.setClip({...clip, ref: `builtin:fixture-pack/c${i}`}, 'in-place');
    }
    player.setClip(clip, 'in-place');
    expect(player.log.filter(l => l.startsWith('retarget:')).at(-1)).toBe(
      'retarget:miss',
    );
  });

  it('REQ-ANM-022: a clip that cannot be retargeted keeps the previous clip', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    player.seek(0.5);
    const before = (body.bones.get('pelvis') as Bone).position.toArray();
    const broken: LoadedClip = {
      ...clip,
      ref: 'builtin:fixture-pack/broken',
      source: {
        id: 'fixture-b',
        joints: clip.source.joints.filter(j => j.name !== 'pelvis'),
      },
    };
    player.setClip(broken, 'metadata');
    expect(player.log.at(-1)).toBe('retarget:error:AST_RIG_MISMATCH');
    player.seek(0.5);
    expect((body.bones.get('pelvis') as Bone).position.toArray()).toEqual(
      before,
    );
  });

  it('REQ-ANM-013: setClip(null) restores the rest pose', async () => {
    const clip = await loadFixtureClip();
    const body = makeBody('fixture-a');
    const player = createClipPlayer(body);
    player.setClip(clip, 'metadata');
    player.seek(0.5);
    player.setClip(null, 'metadata');
    const pelvis = body.bones.get('pelvis') as Bone;
    expect(pelvis.position.toArray()).toEqual([0, 0.87, 0]);
    expect(
      angle(
        (body.bones.get('lowerarm_l') as Bone).quaternion,
        new Quaternion(),
      ),
    ).toBeLessThan(1e-7);
  });

  it('REQ-ANM-008: seek allocates nothing per call', async () => {
    const clip = await loadFixtureClip();
    const player = createClipPlayer(makeBody('fixture-a'));
    player.setClip(clip, 'in-place');
    const gc = (globalThis as {gc?: () => void}).gc;
    for (let i = 0; i < 1000; i++) player.seek((i % 100) / 100);
    gc?.();
    const heap = () =>
      (process as unknown as {memoryUsage(): {heapUsed: number}}).memoryUsage()
        .heapUsed;
    const before = heap();
    for (let i = 0; i < 200_000; i++) player.seek((i % 100) / 100);
    expect(heap() - before).toBeLessThan(8 * 1024 * 1024);
  });
});
