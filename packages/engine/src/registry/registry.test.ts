import {describe, expect, it} from 'vitest';
import type {
  ClipEntry,
  ClipManifest,
  PartEntry,
  PartManifest,
  RigDefinition,
} from '@csg/parts-schema';
import {createGlbLoader} from '../loaders/glb-loader';
import {buildTestGlb, createTestFetch} from '../loaders/test-glb';
import {
  characterSkeletonGroupOf,
  checkCompatibility,
  createAssetRegistry,
  parseClipManifestJson,
  parsePartManifestJson,
  restPoseOf,
} from './index';

// Spec ACs say `g-a`/`g-b`; the M1 fixtures use `fixture-a`/`fixture-b` (same meaning).
const LICENSE = {
  license: 'CC0-1.0',
  author: 'Quaternius',
  sourceUrl: 'https://quaternius.com',
  commercialUse: 'yes',
  attributionRequired: false,
} as const;

function makeRig(id = 'quaternius-ue5-65'): RigDefinition {
  const bones = ['root', 'pelvis', 'spine_03', 'Head', 'hand_r', 'hand_l'];
  const parents = [null, 'root', 'pelvis', 'spine_03', 'spine_03', 'spine_03'];
  return {
    id,
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
      feet: ['root'],
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
    defaultSkeletonGroup: 'fixture-a',
    skeletonGroups: ['fixture-a', 'fixture-b'].map(group => ({
      id: group,
      restPose: Object.fromEntries(
        bones.map((b, i) => [
          b,
          {
            // fixture-b: pelvis 0.05 m higher (AC-AST-026.1 shape).
            t: [0, i + (group === 'fixture-b' && b === 'pelvis' ? 0.05 : 0), 0],
            r: [0, 0, 0, 1],
            s: [1, 1, 1],
          },
        ]),
      ),
    })),
  };
}

function part(overrides: Partial<PartEntry>): PartEntry {
  return {
    id: 'part',
    name: 'Part',
    slot: 'torso',
    kind: 'skinned',
    file: 'parts/part.glb',
    rig: 'quaternius-ue5-65',
    hides: [],
    tintSlots: [],
    sha256: 'a'.repeat(64),
    stats: {triangles: 1, textures: 0},
    tags: [],
    ...overrides,
  };
}

const BODY_A = part({
  id: 'body-a',
  slot: 'body',
  file: 'parts/body-a.glb',
  bodyType: 'superhero',
  skeletonGroup: 'fixture-a',
});

function partManifest(
  packId: string,
  parts: PartEntry[],
  rigs = [makeRig()],
): PartManifest {
  return {
    format: 'sprite-parts-manifest',
    version: 1,
    packId,
    name: packId,
    license: LICENSE,
    rigs,
    parts,
  };
}

function clip(overrides: Partial<ClipEntry>): ClipEntry {
  return {
    id: 'walk',
    name: 'Walk',
    category: 'locomotion',
    file: 'clips.glb',
    sourceName: 'Walk',
    rig: 'quaternius-ue5-65',
    durationSec: 1,
    loop: true,
    defaultFrameCount: 8,
    hasRootMotion: false,
    tags: [],
    sha256: 'c'.repeat(64),
    skeletonGroup: 'fixture-b',
    ...overrides,
  };
}

function clipManifest(packId: string, clips: ClipEntry[]): ClipManifest {
  return {
    format: 'sprite-clips-manifest',
    version: 1,
    packId,
    name: packId,
    license: LICENSE,
    clips,
  };
}

describe('registry: compatibility (REQ-CMP-008)', () => {
  it('AC-CMP-008.1: outfit for bodyTypes [superhero] on a regular body → body-type', () => {
    const body = part({id: 'regular-f', slot: 'body', bodyType: 'regular'});
    const outfit = part({id: 'outfit', bodyTypes: ['superhero']});
    expect(checkCompatibility(outfit, body)).toEqual({
      ok: false,
      reason: 'body-type',
    });
  });

  it('AC-CMP-008.2: skinned part on other-rig vs a quaternius-ue5-65 body → rig', () => {
    const shirt = part({id: 'shirt', rig: 'other-rig'});
    expect(checkCompatibility(shirt, BODY_A)).toEqual({
      ok: false,
      reason: 'rig',
    });
  });

  it('AC-CMP-008.3: static prop without bodies/bodyTypes is compatible with any body', () => {
    const sword = part({
      id: 'sword',
      slot: 'prop-main-hand',
      kind: 'static',
      rig: undefined,
      socket: {
        bone: 'hand_r',
        offset: {position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1]},
      },
    });
    for (const body of [
      BODY_A,
      part({id: 'x', slot: 'body', rig: 'other-rig', bodyType: 'regular'}),
    ]) {
      expect(checkCompatibility(sword, body)).toEqual({ok: true});
    }
  });

  it('REQ-CMP-008 (b): bodies not containing the body ID → body', () => {
    const outfit = part({id: 'outfit', bodies: ['superhero-f']});
    expect(checkCompatibility(outfit, BODY_A)).toEqual({
      ok: false,
      reason: 'body',
    });
    expect(
      checkCompatibility(part({id: 'o2', bodies: ['body-a']}), BODY_A),
    ).toEqual({ok: true});
  });

  it('AC-CMP-008.4: a part restricted with bodies [superhero-m] is incompatible with superhero-f (reason body) and compatible with superhero-m', () => {
    const m = part({id: 'superhero-m', slot: 'body', bodyType: 'superhero'});
    const f = part({id: 'superhero-f', slot: 'body', bodyType: 'superhero'});
    const torso = part({id: 'male-ranger-torso', bodies: ['superhero-m']});
    expect(checkCompatibility(torso, f)).toEqual({ok: false, reason: 'body'});
    expect(checkCompatibility(torso, m)).toEqual({ok: true});
  });

  it('AC-CMP-008.5: differing skeletonGroup on the same rig without bodies/bodyTypes restriction is compatible', () => {
    const body = part({
      id: 'superhero-m',
      slot: 'body',
      skeletonGroup: 'superhero-m',
    });
    const outfit = part({id: 'female-outfit', skeletonGroup: 'female'});
    expect(checkCompatibility(outfit, body)).toEqual({ok: true});
  });

  it('AC-CMP-008.6: rig mismatch is reported before the bodies restriction', () => {
    const outfit = part({
      id: 'o',
      rig: 'other-rig',
      bodies: ['superhero-f'],
    });
    expect(checkCompatibility(outfit, BODY_A)).toEqual({
      ok: false,
      reason: 'rig',
    });
  });

  it('REQ-CMP-008/REQ-CMP-037: a fixture-b (g-b) part on a fixture-a (g-a) body stays compatible (bind pose does not affect compatibility)', () => {
    const shirt = part({id: 'shirt', skeletonGroup: 'fixture-b'});
    expect(checkCompatibility(shirt, BODY_A)).toEqual({ok: true});
  });
});

describe('registry: character skeleton group and rest poses (REQ-CMP-037)', () => {
  const rig = makeRig();

  it('AC-CMP-037.1: characterSkeletonGroup wins over the body own group', () => {
    const body = part({
      id: 'b',
      slot: 'body',
      skeletonGroup: 'fixture-a',
      characterSkeletonGroup: 'fixture-b',
    });
    expect(characterSkeletonGroupOf(body, rig)).toBe('fixture-b');
    expect(
      characterSkeletonGroupOf(
        part({id: 'b', slot: 'body', skeletonGroup: 'fixture-b'}),
        rig,
      ),
    ).toBe('fixture-b');
  });

  it('AC-CMP-037.4: neither field → rig.defaultSkeletonGroup', () => {
    const body = part({id: 'b', slot: 'body', skeletonGroup: undefined});
    expect(characterSkeletonGroupOf(body, rig)).toBe('fixture-a');
  });

  it('AC-CMP-037.1: restPoseOf returns the group rest TRS in bones order, cached', () => {
    const result = restPoseOf(rig, 'fixture-b');
    if (!result.ok) throw new Error(result.error.message);
    const pose = result.value;
    expect(pose.id).toBe('fixture-b');
    expect(pose.joints.map(j => j.name)).toEqual(rig.bones);
    expect(pose.joints.map(j => j.parent)).toEqual(
      rig.bones.map(b => rig.parents[b]),
    );
    const pelvis = pose.joints[1];
    expect(pelvis?.translation[1]).toBeCloseTo(1.05, 12);
    const again = restPoseOf(rig, 'fixture-b');
    expect(again.ok && again.value === pose).toBe(true);
  });

  it('REQ-CMP-037: unknown skeleton group → AST_RIG_MISMATCH', () => {
    const result = restPoseOf(rig, 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AST_RIG_MISMATCH');
  });
});

describe('registry: listing (REQ-AST-022, REQ-ANM-002)', () => {
  it('AC-AST-022.1: a new community pack registered from JSON data lists its hat in headwear', () => {
    const registry = createAssetRegistry({
      loader: createGlbLoader({fetch: createTestFetch(new Map()).fetch}),
    });
    registry.registerPack(partManifest('quaternius-ubc', [BODY_A]), '/packs/q');
    const text = JSON.stringify(
      partManifest('community-hats', [
        part({id: 'top-hat', slot: 'headwear', file: 'parts/top-hat.glb'}),
      ]),
    );
    const parsed = parsePartManifestJson(text);
    if (!parsed.ok) throw new Error(parsed.issues[0]?.message);
    registry.registerPack(parsed.value, '/assets/packs/community-hats');
    const hats = registry.list({slot: 'headwear'});
    expect(hats.map(h => h.ref)).toEqual(['builtin:community-hats/top-hat']);
    expect(hats[0]?.source).toBe('builtin');
    expect(registry.list().length).toBe(2);
    expect(registry.licenseOf('builtin:community-hats/top-hat')).toEqual(
      LICENSE,
    );
    expect(registry.rigOf('builtin:community-hats/top-hat')?.id).toBe(
      'quaternius-ue5-65',
    );
  });

  it('AC-CMP-037.3: a body characterSkeletonGroup missing from the embedded rig fails validation naming the part', () => {
    const text = JSON.stringify(
      partManifest('p', [
        part({id: 'body-x', slot: 'body', characterSkeletonGroup: 'nope'}),
      ]),
    );
    const parsed = parsePartManifestJson(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues[0]?.entryId).toBe('body-x');
    expect(parsed.issues[0]?.field).toBe('characterSkeletonGroup');
  });

  it('REQ-GEN-011: manifest JSON with a __proto__ key is rejected', () => {
    expect(parsePartManifestJson('{"__proto__": {}}').ok).toBe(false);
    expect(parseClipManifestJson('{"a": {"constructor": 1}}').ok).toBe(false);
  });

  it('AC-ANM-002.1: clips on rig "other" are filtered out; same rig, any skeleton group, is listed', () => {
    const registry = createAssetRegistry({
      loader: createGlbLoader({fetch: createTestFetch(new Map()).fetch}),
    });
    const text = JSON.stringify(
      clipManifest('ual', [
        clip({id: 'walk', skeletonGroup: 'fixture-b'}),
        clip({id: 'idle', skeletonGroup: 'fixture-a', sourceName: 'Idle'}),
        clip({id: 'alien', rig: 'other', sourceName: 'Alien'}),
      ]),
    );
    const parsed = parseClipManifestJson(text);
    if (!parsed.ok) throw new Error(parsed.issues[0]?.message);
    registry.registerClips(parsed.value, '/packs/ual');
    expect(
      registry.listClips({rig: 'quaternius-ue5-65'}).map(c => c.ref),
    ).toEqual(['builtin:ual/walk', 'builtin:ual/idle']);
    expect(registry.listClips().length).toBe(3);
  });

  it('M1: user-asset methods throw not implemented (M5)', () => {
    const registry = createAssetRegistry();
    expect(() => registry.registerUserAsset({})).toThrow(
      'not implemented (M5)',
    );
    expect(() => registry.unregisterUserAsset('x')).toThrow(
      'not implemented (M5)',
    );
  });
});

describe('registry: resolve and resolveClip (REQ-ANM-021, REQ-ANM-022, REQ-AST-028/029)', () => {
  function setup() {
    const files = new Map<string, ArrayBuffer>([
      ['/packs/q/parts/body-a.glb', buildTestGlb({region: [0, 1, 2]})],
      ['/packs/q/parts/shirt.glb', buildTestGlb()],
      [
        '/packs/q/parts/basisu.glb',
        buildTestGlb({extensions: ['KHR_texture_basisu']}),
      ],
      ['/packs/ual/clips.glb', buildTestGlb({animations: ['Walk', 'Idle']})],
      ['/packs/ual/broken.glb', buildTestGlb().slice(0, 40)],
    ]);
    const stub = createTestFetch(files);
    const loader = createGlbLoader({fetch: stub.fetch, origin: undefined});
    const registry = createAssetRegistry({loader});
    registry.registerPack(
      partManifest('q', [
        BODY_A,
        part({
          id: 'shirt',
          file: 'parts/shirt.glb',
          skeletonGroup: 'fixture-b',
        }),
        part({id: 'basisu', file: 'parts/basisu.glb'}),
      ]),
      '/packs/q/',
    );
    registry.registerClips(
      clipManifest('ual', [
        clip({id: 'walk', durationSec: 1.0333333}),
        clip({id: 'idle', sourceName: 'Idle', skeletonGroup: 'fixture-a'}),
        clip({id: 'ghost', sourceName: 'Ghost'}),
        clip({id: 'gone', file: 'missing.glb'}),
        clip({id: 'broken', file: 'broken.glb'}),
      ]),
      '/packs/ual',
    );
    return {registry, loader, stub};
  }

  it('AC-AST-028.1: a resolved body has Float32 regionId and its rig', async () => {
    const {registry} = setup();
    const result = await registry.resolve('builtin:q/body-a');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.rig.id).toBe('quaternius-ue5-65');
    expect(result.value.entry.id).toBe('body-a');
    let found = false;
    result.value.scene.traverse(o => {
      const geometry = (o as {geometry?: {getAttribute(n: string): unknown}})
        .geometry;
      if (geometry?.getAttribute('regionId') !== undefined) found = true;
    });
    expect(found).toBe(true);
    // Non-body parts need no _REGION.
    expect((await registry.resolve('builtin:q/shirt')).ok).toBe(true);
  });

  it('AC-AST-029.2: a bundled part declaring KHR_texture_basisu → CMP_PART_LOAD_FAILED extension-not-allowed', async () => {
    const {registry} = setup();
    const result = await registry.resolve('builtin:q/basisu');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CMP_PART_LOAD_FAILED');
    expect(result.error.details).toMatchObject({
      ref: 'builtin:q/basisu',
      reason: 'extension-not-allowed',
    });
  });

  it('REQ-CMP-008/REQ-AST-028: an unregistered part → CMP_PART_LOAD_FAILED not-registered', async () => {
    const {registry} = setup();
    const result = await registry.resolve('builtin:q/nope');
    expect(!result.ok && result.error.details).toMatchObject({
      ref: 'builtin:q/nope',
      reason: 'not-registered',
    });
  });

  it('AC-ANM-021.1: resolveClip returns the entry, durationSec and the fixture-b source rest pose', async () => {
    const {registry} = setup();
    const result = await registry.resolveClip('builtin:ual/walk');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.entry.id).toBe('walk');
    expect(result.value.durationSec).toBeCloseTo(1.0333333, 6);
    expect(result.value.clip.name).toBe('Walk');
    expect(result.value.source.id).toBe('fixture-b');
    expect(result.value.rig.id).toBe('quaternius-ue5-65');
  });

  it('AC-ANM-021.2: resolving again makes no fetch and returns the same cached clip data', async () => {
    const {registry, loader} = setup();
    const first = await registry.resolveClip('builtin:ual/walk');
    const count = loader.fetchCount;
    const second = await registry.resolveClip('builtin:ual/walk');
    expect(loader.fetchCount).toBe(count);
    expect(
      first.ok && second.ok && first.value.clip === second.value.clip,
    ).toBe(true);
    // A second clip of the same file (same URL + sha256) is served from the GLB cache.
    const idle = await registry.resolveClip('builtin:ual/idle');
    expect(idle.ok).toBe(true);
    expect(loader.fetchCount).toBe(count);
  });

  it('AC-ANM-022.1: HTTP 404 → ANM_CLIP_LOAD_FAILED network with the ref', async () => {
    const {registry} = setup();
    const result = await registry.resolveClip('builtin:ual/gone');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ANM_CLIP_LOAD_FAILED');
    expect(result.error.details).toMatchObject({
      ref: 'builtin:ual/gone',
      reason: 'network',
    });
  });

  it('AC-ANM-022.2: animation-missing, not-registered and parse reasons', async () => {
    const {registry} = setup();
    const cases: Array<[string, string]> = [
      ['builtin:ual/ghost', 'animation-missing'],
      ['builtin:ual/nope', 'not-registered'],
      ['builtin:ual/broken', 'parse'],
    ];
    for (const [ref, reason] of cases) {
      const result = await registry.resolveClip(ref);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('ANM_CLIP_LOAD_FAILED');
      expect(result.error.details).toMatchObject({ref, reason});
    }
  });
});
