import type {PartEntry, PartManifest, RigDefinition} from './index';

/** Small in-code rig: root, spine, Head, one arm. Source joint names are kept (`Head`). */
export function makeRig(): RigDefinition {
  const bones = ['root', 'pelvis', 'spine_03', 'Head', 'hand_r', 'hand_l'];
  const parents = [null, 'root', 'pelvis', 'spine_03', 'spine_03', 'spine_03'];
  return {
    id: 'test-rig',
    bones,
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
    parents: Object.fromEntries(bones.map((b, i) => [b, parents[i] ?? null])),
    defaultSkeletonGroup: 'g-a',
    skeletonGroups: ['g-a', 'g-b'].map(id => ({
      id,
      restPose: Object.fromEntries(
        bones.map((b, i) => [
          b,
          {
            t: [0, i + (id === 'g-b' ? 0.05 : 0), 0],
            r: [0, 0, 0, 1],
            s: [1, 1, 1],
          },
        ]),
      ),
    })),
  };
}

/** A valid skinned body part. */
export function makePart(overrides: Partial<PartEntry> = {}): PartEntry {
  return {
    id: 'superhero-m',
    name: 'Superhero (male)',
    slot: 'body',
    kind: 'skinned',
    file: 'parts/superhero-m.glb',
    rig: 'test-rig',
    bodyType: 'superhero',
    hides: [],
    tintSlots: [{material: 'Body', slot: 'skin', mode: 'multiply'}],
    sha256: 'a'.repeat(64),
    stats: {triangles: 100, textures: 1},
    tags: [],
    ...overrides,
  };
}

/** A valid manifest with one body part. */
export function makeManifest(
  overrides: Partial<PartManifest> = {},
): PartManifest {
  return {
    format: 'sprite-parts-manifest',
    version: 1,
    packId: 'test-pack',
    name: 'Test pack',
    license: {
      license: 'CC0-1.0',
      author: 'Quaternius',
      sourceUrl: 'https://quaternius.com',
      commercialUse: 'yes',
      attributionRequired: false,
    },
    rigs: [makeRig()],
    parts: [makePart()],
    ...overrides,
  };
}
