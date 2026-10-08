import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  parsePartManifest,
  partEntrySchema,
  validatePartsAgainstRig,
  validatePartsAgainstSlots,
} from './part-manifest';
import {loadSlotRegistry} from './slots';
import {makeManifest, makePart} from './test-fixtures';

const registryJson = JSON.parse(
  readFileSync(new URL('../data/slots.json', import.meta.url), 'utf8'),
);
const registry = (() => {
  const r = loadSlotRegistry(registryJson);
  if (!r.ok) throw new Error('slots.json invalid');
  return r.value;
})();

describe('part manifest', () => {
  it('REQ-CMP-001: a valid manifest parses', () => {
    expect(parsePartManifest(makeManifest()).ok).toBe(true);
  });

  it('AC-GEN-008.1: a manifest without a license fails naming the entry and field', () => {
    const manifest: Record<string, unknown> = {...makeManifest()};
    delete manifest['license'];
    const result = parsePartManifest(manifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find(i => i.field === 'license');
      expect(issue?.entryId).toBe('test-pack');
    }
  });

  it('AC-GEN-008.1: a part license missing sourceUrl names the part and field', () => {
    const license = {
      license: 'CC0-1.0',
      author: 'A',
      commercialUse: 'yes',
      attributionRequired: false,
    };
    const result = parsePartManifest(
      makeManifest({parts: [makePart({license} as never)]}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        entryId: 'superhero-m',
        field: 'sourceUrl',
      });
    }
  });

  it('AC-AST-017.2: a part license override lacking author names the part and author', () => {
    const license = {
      license: 'CC-BY-4.0',
      sourceUrl: 'https://example.com/x',
      commercialUse: 'yes',
      attributionRequired: true,
    };
    const result = parsePartManifest(
      makeManifest({parts: [makePart({license} as never)]}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        entryId: 'superhero-m',
        field: 'author',
      });
      expect(result.issues[0]?.message).toContain('superhero-m');
    }
  });

  it('AC-AST-017.1: CC-BY-SA-4.0 is not bundlable', () => {
    const license = {
      ...makeManifest().license,
      license: 'CC-BY-SA-4.0',
    } as never;
    expect(parsePartManifest(makeManifest({license})).ok).toBe(false);
  });

  it('REQ-AST-013: skinned needs rig, static needs socket, sha256 is hex', () => {
    expect(partEntrySchema.safeParse(makePart({rig: undefined})).success).toBe(
      false,
    );
    expect(
      partEntrySchema.safeParse(
        makePart({kind: 'static', slot: 'prop-main-hand', bodyType: undefined}),
      ).success,
    ).toBe(false);
    expect(partEntrySchema.safeParse(makePart({sha256: 'xyz'})).success).toBe(
      false,
    );
    const sword = makePart({
      id: 'sword',
      slot: 'prop-main-hand',
      kind: 'static',
      rig: undefined,
      bodyType: undefined,
      socket: {
        bone: 'hand_r',
        offset: {position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1]},
      },
    });
    expect(partEntrySchema.safeParse(sword).success).toBe(true);
  });

  it('REQ-AST-013: duplicate part ids and unknown rigs fail', () => {
    expect(
      parsePartManifest(makeManifest({parts: [makePart(), makePart()]})).ok,
    ).toBe(false);
    expect(
      parsePartManifest(makeManifest({parts: [makePart({rig: 'other'})]})).ok,
    ).toBe(false);
  });

  it('REQ-CMP-008: bodyTypes, bodies, alsoOccupies, hides and tint modes round-trip', () => {
    const robe = makePart({
      id: 'robe',
      slot: 'torso',
      bodyType: undefined,
      bodyTypes: ['superhero'],
      bodies: ['superhero-m'],
      alsoOccupies: ['legs'],
      hides: ['torso', 'upper-legs'],
      tintSlots: [{material: 'Cloth', slot: 'primary', mode: 'replace'}],
    });
    const result = partEntrySchema.safeParse(robe);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tintSlots[0]?.mode).toBe('replace');
  });

  it('REQ-AST-013: bodyType outside the body slot and unsafe file paths fail', () => {
    expect(partEntrySchema.safeParse(makePart({slot: 'torso'})).success).toBe(
      false,
    );
    expect(
      partEntrySchema.safeParse(makePart({file: '../x.glb'})).success,
    ).toBe(false);
    expect(
      partEntrySchema.safeParse(makePart({file: 'https://x/y.glb'})).success,
    ).toBe(false);
  });

  it('AC-CMP-003.2: a skinned part in prop-main-hand fails naming the part id', () => {
    const bad = makePart({
      id: 'floaty',
      slot: 'prop-main-hand',
      bodyType: undefined,
    });
    const result = validatePartsAgainstSlots({parts: [bad]}, registry);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues[0]).toMatchObject({
        entryId: 'floaty',
        field: 'kind',
      });
  });

  it('AC-CMP-003.2: unknown slots and alsoOccupies are reported; valid parts pass', () => {
    expect(validatePartsAgainstSlots(makeManifest(), registry).ok).toBe(true);
    const unknown = makePart({
      slot: 'wings',
      bodyType: undefined,
      alsoOccupies: ['nope'],
    });
    const result = validatePartsAgainstSlots({parts: [unknown]}, registry);
    expect(result.ok ? 0 : result.issues.length).toBe(2);
  });

  it('AC-CMP-037.3: characterSkeletonGroup on a non-body part fails naming the id and field', () => {
    const shirt = makePart({
      id: 'shirt',
      slot: 'torso',
      bodyType: undefined,
      characterSkeletonGroup: 'g-b',
    });
    const result = parsePartManifest(makeManifest({parts: [shirt]}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]).toMatchObject({
        entryId: 'shirt',
        field: 'characterSkeletonGroup',
      });
      expect(result.issues[0]?.message).toContain('shirt');
    }
  });

  it('AC-CMP-037.3: a body with a known characterSkeletonGroup and computed skeletonGroup parses', () => {
    const body = makePart({
      characterSkeletonGroup: 'g-b',
      skeletonGroup: 'g-a',
    });
    const manifest = makeManifest({parts: [body]});
    expect(parsePartManifest(manifest).ok).toBe(true);
    expect(validatePartsAgainstRig(manifest).ok).toBe(true);
  });

  it('AC-CMP-037.3: an unknown characterSkeletonGroup is reported naming the part and field', () => {
    const body = makePart({characterSkeletonGroup: 'nope'});
    const result = validatePartsAgainstRig(makeManifest({parts: [body]}));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues[0]).toMatchObject({
        entryId: 'superhero-m',
        field: 'characterSkeletonGroup',
      });
  });

  it('AC-AST-026.1: an unknown skeletonGroup is reported', () => {
    const body = makePart({skeletonGroup: 'g-z'});
    const result = validatePartsAgainstRig(makeManifest({parts: [body]}));
    expect(result.ok ? [] : result.issues.map(i => i.field)).toEqual([
      'skeletonGroup',
    ]);
  });

  it('AC-AST-026.1: a skinned part whose rig does not exist is reported', () => {
    const body = makePart({rig: 'ghost-rig'});
    const result = validatePartsAgainstRig(makeManifest({parts: [body]}));
    expect(result.ok ? [] : result.issues.map(i => i.field)).toEqual(['rig']);
  });
});
