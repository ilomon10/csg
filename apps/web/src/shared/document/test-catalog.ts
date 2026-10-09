import {
  createDefaultCharacterSpec,
  createProjectDocument,
} from '@csg/parts-schema';
import type {
  AnatomyParams,
  AssetRef,
  CharacterSpec,
  ProjectDocument,
} from '@csg/parts-schema';
import type {CommandCatalog, CommandPart} from './catalog-port';

interface TestPart extends CommandPart {
  readonly bodies?: readonly string[];
  readonly styles?: readonly string[];
}

const ref = (id: string) => `builtin:test/${id}` as AssetRef;
const part = (
  id: string,
  slot: string,
  extra: Partial<TestPart> = {},
): TestPart => ({
  ref: ref(id),
  slot,
  name: id,
  ...extra,
});

/** Small synthetic catalog for command tests (no bundled packs). */
export const TEST_PARTS: readonly TestPart[] = [
  part('body-a', 'body'),
  part('body-b', 'body'),
  part('hair-1', 'hair'),
  part('hair-2', 'hair'),
  part('robe', 'torso', {alsoOccupies: ['legs']}),
  part('shirt', 'torso'),
  part('trousers', 'legs'),
  part('plate', 'torso', {bodies: ['body-a']}),
  part('hat', 'headwear', {styles: ['realistic']}),
];

const chibiValues = {
  height: 1,
  head: 1.8,
  torsoWidth: 1,
  shoulders: 1,
  armLength: 1,
  legLength: 1,
  hands: 1,
  feet: 1,
  limbThickness: 1,
} as AnatomyParams;
const realisticValues = {...chibiValues, head: 1} as AnatomyParams;

export function createTestCatalog(emptyChance = 0.3): CommandCatalog {
  const slotIds = ['body', 'hair', 'headwear', 'torso', 'legs'];
  return {
    slots: {
      slots: slotIds.map((id, order) => ({
        id,
        order,
        required: id === 'body',
        randomize: {emptyChance: id === 'body' ? 0 : emptyChance},
      })),
    },
    parts: TEST_PARTS,
    anatomyPresets: new Map([
      ['realistic', {values: realisticValues}],
      ['chibi', {values: chibiValues}],
    ]),
    bodyShapes: [
      {id: 'broad', factors: {torsoWidth: 1.2, shoulders: 1.2}},
      {id: 'slim', factors: {torsoWidth: 0.8}},
    ],
    styles: new Map([
      ['realistic', {anatomyPreset: 'realistic'}],
      ['chibi', {anatomyPreset: 'chibi'}],
    ]),
    easyCategories: [
      {
        id: 'hair',
        slots: ['hair'],
        tintChannels: ['hair'],
        anatomyPresets: false,
      },
      {
        id: 'body',
        slots: ['body'],
        tintChannels: ['skin'],
        anatomyPresets: true,
      },
    ],
    swatchSets: [
      {
        channels: ['hair', 'primary', 'secondary', 'skin'],
        swatches: [{hex: '#112233'}, {hex: '#445566'}, {hex: '#778899'}],
      },
    ],
    availableCombos: [
      ['realistic', 'human'],
      ['chibi', 'human'],
    ],
    compatible(p, spec) {
      const t = p as TestPart;
      if (t.bodies && !t.bodies.includes(spec.body.ref.split('/')[1] ?? '')) {
        return {ok: false, reason: 'body'};
      }
      if (t.styles && !t.styles.includes(spec.style))
        return {ok: false, reason: 'style'};
      return {ok: true};
    },
  };
}

/** Default character with the synthetic body and a few parts equipped. */
export function testSpec(
  overrides: Partial<CharacterSpec> = {},
): CharacterSpec {
  const base = createDefaultCharacterSpec();
  return {
    ...base,
    body: {ref: ref('body-a')},
    parts: {hair: {ref: ref('hair-1')}},
    ...overrides,
  };
}

export function testDocument(
  spec: CharacterSpec = testSpec(),
): ProjectDocument {
  return createProjectDocument(spec);
}

export const testRef = ref;
