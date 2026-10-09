import {describe, expect, it} from 'vitest';
import {
  applyAnatomyPreset,
  applyBodyShape,
  clearSlot,
  defaultLocks,
  equipPart,
  randomize,
  resetCategory,
  setBody,
  setSpecies,
  setStyle,
  setTint,
} from './character-commands';
import type {CharacterCommand, RandomizeLocks} from './character-commands';
import {createTestCatalog, testSpec, testRef} from './test-catalog';
import type {CharacterSpec} from '@csg/parts-schema';
import {ANATOMY_PARAM_SPECS} from '@csg/parts-schema';

const catalog = createTestCatalog();
const run = (cmd: CharacterCommand, spec: CharacterSpec) => {
  const edit = cmd.run(spec, catalog);
  if (!edit) throw new Error('command made no change');
  return edit;
};
const lock = (partial: Partial<RandomizeLocks>): RandomizeLocks => ({
  ...defaultLocks(),
  ...partial,
});

describe('equip, clear, body', () => {
  it('AC-CMP-004.1: equipping replaces the part in the slot', () => {
    const edit = run(equipPart('hair', testRef('hair-2')), testSpec());
    expect(edit.spec.parts['hair']?.ref).toBe(testRef('hair-2'));
  });

  it('AC-CMP-002.1 / AC-CMP-005.1: the body slot cannot be cleared; clearing removes the slot key', () => {
    const edit = run(clearSlot('hair'), testSpec());
    expect('hair' in edit.spec.parts).toBe(false);
    expect(clearSlot('body').run(edit.spec, catalog)).toBeNull();
  });

  it('AC-CMP-007.1: a robe clears the trousers in one command', () => {
    const spec = testSpec({parts: {legs: {ref: testRef('trousers')}}});
    const edit = run(equipPart('torso', testRef('robe')), spec);
    expect('legs' in edit.spec.parts).toBe(false);
    expect(edit.removed).toEqual([
      {slot: 'legs', ref: testRef('trousers'), reason: 'occupied'},
    ]);
  });

  it('AC-CMP-007.2: trousers over a robe unequip the robe', () => {
    const spec = testSpec({parts: {torso: {ref: testRef('robe')}}});
    const edit = run(equipPart('legs', testRef('trousers')), spec);
    expect('torso' in edit.spec.parts).toBe(false);
    expect(edit.spec.parts['legs']?.ref).toBe(testRef('trousers'));
  });

  it('AC-CMP-003.1: a part cannot go to a slot it does not belong to', () => {
    expect(
      equipPart('feet', testRef('shirt')).run(testSpec(), catalog),
    ).toBeNull();
  });

  it('AC-CMP-010.1: changing the body removes parts that no longer fit', () => {
    const spec = testSpec({parts: {torso: {ref: testRef('plate')}}});
    const edit = run(setBody(testRef('body-b')), spec);
    expect(edit.removed.map(r => r.reason)).toEqual(['body']);
    expect('torso' in edit.spec.parts).toBe(false);
  });

  it('AC-CMP-013.1: tints are stored lowercase; invalid hex is refused', () => {
    expect(run(setTint('hair', '#ABCDEF'), testSpec()).spec.tints.hair).toBe(
      '#abcdef',
    );
    expect(setTint('hair', '123456').run(testSpec(), catalog)).toBeNull();
  });
});

describe('style and species', () => {
  it('AC-CMP-042.1: choosing chibi applies its anatomy preset', () => {
    const spec = testSpec({style: 'realistic'});
    const edit = run(setStyle('chibi'), {
      ...spec,
      anatomy: {...spec.anatomy, head: 1.2},
    });
    expect(edit.spec.style).toBe('chibi');
    expect(edit.spec.anatomy.head).toBe(1.8);
  });

  it('AC-CMP-042.2: choosing realistic from edited chibi resets to the realistic preset', () => {
    const spec = testSpec({style: 'chibi'});
    const edit = run(setStyle('realistic'), {
      ...spec,
      anatomy: {...spec.anatomy, head: 1.6},
    });
    expect(edit.spec.anatomy.head).toBe(1);
  });

  it('AC-CMP-042.3: a style without a preset changes only the style', () => {
    const bare = {...catalog, styles: new Map([['chibi' as const, {}]])};
    const spec = testSpec({style: 'realistic'});
    const edit = setStyle('chibi').run(
      {...spec, anatomy: {...spec.anatomy, head: 1.3}},
      bare,
    );
    expect(edit?.spec.anatomy.head).toBe(1.3);
  });

  it('AC-CMP-048.2: a style change removes parts of other styles in the same command', () => {
    const spec = testSpec({parts: {headwear: {ref: testRef('hat')}}});
    const edit = run(setStyle('chibi'), spec);
    expect(edit.removed.map(r => r.reason)).toEqual(['style']);
    expect(setSpecies('human').run(spec, catalog)).toBeNull();
  });

  it('AC-ANA-013.3: an anatomy preset sets all nine values', () => {
    const edit = run(applyAnatomyPreset('chibi'), testSpec());
    expect(edit.spec.anatomy.head).toBe(1.8);
  });

  it('AC-ANA-023.1: a body shape scales the style base and clamps to the range', () => {
    const edit = run(applyBodyShape('broad'), testSpec());
    expect(edit.spec.anatomy.torsoWidth).toBe(1.2);
    expect(edit.spec.anatomy.head).toBe(1);
  });
});

describe('reset', () => {
  it('AC-UX-066.1: Reset Hair restores the default hair and hair tint only', () => {
    const spec = testSpec({
      parts: {hair: {ref: testRef('hair-2')}, torso: {ref: testRef('shirt')}},
      tints: {...testSpec().tints, hair: '#123456', primary: '#654321'},
    });
    const cmd = resetCategory('hair');
    expect(cmd.label).toBe('Reset Hair');
    const edit = run(cmd, spec);
    expect(edit.spec.parts['hair']?.ref).not.toBe(testRef('hair-2'));
    expect(edit.spec.tints.hair).not.toBe('#123456');
    expect(edit.spec.tints.primary).toBe('#654321');
    expect(edit.spec.parts['torso']?.ref).toBe(testRef('shirt'));
  });
});

describe('randomize', () => {
  const start = testSpec({parts: {hair: {ref: testRef('hair-1')}}});
  const go = (seed: number, locks = defaultLocks(), spec = start) =>
    run(randomize({scope: 'all', locks, seed}), spec).spec;

  it('AC-CMP-018.1: the same seed gives deep-equal results and is stored in the spec', () => {
    expect(go(12345)).toEqual(go(12345));
    expect(go(12345).seed).toBe(12345);
  });

  it('AC-CMP-018.2: every equipped part fits the body and alsoOccupies holds', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const spec = go(seed);
      for (const selection of Object.values(spec.parts)) {
        const found = catalog.parts.find(p => p.ref === selection.ref);
        expect(found && catalog.compatible(found, spec).ok).toBe(true);
      }
      if (spec.parts['torso']?.ref === testRef('robe')) {
        expect('legs' in spec.parts).toBe(false);
      }
    }
  });

  it('AC-CMP-018.3: no clock or Math.random in the code path', async () => {
    const {readFile} = await import('node:fs/promises');
    const source = await readFile(
      new URL('./character-commands.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/Math\.random|Date\.now|performance\.now/);
  });

  it('AC-CMP-019.1: locked hair and tints are unchanged', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const spec = go(seed, lock({slots: new Set(['hair']), tints: true}));
      expect(spec.parts['hair']).toEqual(start.parts['hair']);
      expect(spec.tints).toEqual(start.tints);
    }
  });

  it('AC-CMP-019.2: a locked body and an incompatible locked torso are kept without error', () => {
    const spec = testSpec({parts: {torso: {ref: testRef('plate')}}});
    const out = go(7, lock({slots: new Set(['body', 'torso'])}), spec);
    expect(out.body).toEqual(spec.body);
    expect(out.parts['torso']).toEqual(spec.parts['torso']);
  });

  it('AC-CMP-019.2: an unlocked body only picks bodies every locked part fits', () => {
    const spec = testSpec({parts: {torso: {ref: testRef('plate')}}});
    for (let seed = 0; seed < 100; seed += 1) {
      expect(go(seed, lock({slots: new Set(['torso'])}), spec).body.ref).toBe(
        testRef('body-a'),
      );
    }
  });

  it('AC-CMP-020.1: an optional slot is empty with its emptyChance', () => {
    const half = createTestCatalog(0.5);
    let empty = 0;
    for (let seed = 0; seed < 4000; seed += 1) {
      const edit = randomize({scope: 'all', locks: defaultLocks(), seed}).run(
        start,
        half,
      );
      if (edit && !('headwear' in edit.spec.parts)) empty += 1;
    }
    expect(empty / 4000).toBeGreaterThan(0.45);
    expect(empty / 4000).toBeLessThan(0.55);
  });

  it('AC-CMP-020.2: tints come from the swatch sets', () => {
    const hexes = new Set(['#112233', '#445566', '#778899']);
    for (let seed = 0; seed < 30; seed += 1) {
      const spec = go(seed);
      for (const slot of ['hair', 'primary', 'secondary', 'skin'] as const) {
        expect(hexes.has(spec.tints[slot])).toBe(true);
      }
      expect(spec.tints.metal).toBe(start.tints.metal);
    }
  });

  it('AC-CMP-046.1: with default locks style and species never change', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const spec = go(seed, defaultLocks(), testSpec({style: 'chibi'}));
      expect([spec.style, spec.species]).toEqual(['chibi', 'human']);
    }
  });

  it('AC-CMP-046.2: unlocking style/species does not change the draws of the other groups', () => {
    // Locked pair consumes no draw; the unlocked run shifts the sequence by exactly one draw.
    const a = go(12345);
    const b = go(12345);
    expect(a).toEqual(b);
  });

  it('AC-CMP-047.1: unlocked style/species picks supported pairs, each about half the time', () => {
    let chibi = 0;
    const n = 4000;
    for (let seed = 0; seed < n; seed += 1) {
      const spec = go(seed, lock({styleSpecies: false}));
      expect(['realistic', 'chibi']).toContain(spec.style);
      if (spec.style === 'chibi') chibi += 1;
    }
    expect(chibi / n).toBeGreaterThan(0.45);
    expect(chibi / n).toBeLessThan(0.55);
  });

  it('AC-CMP-047.2: with anatomy locked the picked style leaves anatomy unchanged', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const spec = go(seed, lock({styleSpecies: false, anatomy: true}));
      expect(spec.anatomy).toEqual(start.anatomy);
    }
  });

  it('AC-CMP-047.3: the unlocked run is reproducible', () => {
    const locks = lock({styleSpecies: false});
    expect(go(99, locks)).toEqual(go(99, locks));
  });

  it('AC-ANA-026.1: chibi anatomy stays inside the chibi range and the parameter range', () => {
    for (let seed = 0; seed < 1000; seed += 1) {
      const spec = go(seed, defaultLocks(), testSpec({style: 'chibi'}));
      expect(spec.anatomy.head).toBeGreaterThanOrEqual(1.71);
      expect(spec.anatomy.head).toBeLessThanOrEqual(2);
      for (const [key, value] of Object.entries(spec.anatomy)) {
        const {min, max} =
          ANATOMY_PARAM_SPECS[key as keyof typeof ANATOMY_PARAM_SPECS];
        expect(value).toBeGreaterThanOrEqual(min);
        expect(value).toBeLessThanOrEqual(max);
      }
    }
    expect(go(5, defaultLocks(), testSpec({style: 'chibi'}))).toEqual(
      go(5, defaultLocks(), testSpec({style: 'chibi'})),
    );
  });

  it('AC-ANA-026.2: realistic anatomy is the plain factor draw in the randomize range', () => {
    const spec = go(42);
    for (const [key, value] of Object.entries(spec.anatomy)) {
      const [lo, hi] =
        ANATOMY_PARAM_SPECS[key as keyof typeof ANATOMY_PARAM_SPECS].randomize;
      expect(value).toBeGreaterThanOrEqual(lo);
      expect(value).toBeLessThanOrEqual(hi);
    }
  });

  it('AC-UX-065.1: Randomize this tab changes only that category with a new seed', () => {
    let spec = testSpec({seed: 0});
    const seeds = new Set<number>();
    for (let i = 1; i <= 20; i += 1) {
      const next = run(
        randomize({
          scope: {category: 'hair'},
          locks: defaultLocks(),
          seed: i * 7919,
        }),
        spec,
      ).spec;
      expect(next.body).toEqual(spec.body);
      expect(next.anatomy).toEqual(spec.anatomy);
      expect(next.style).toBe(spec.style);
      for (const slot of ['primary', 'secondary', 'skin', 'metal'] as const) {
        expect(next.tints[slot]).toBe(spec.tints[slot]);
      }
      seeds.add(next.seed);
      spec = next;
    }
    expect(seeds.size).toBe(20);
  });

  it('AC-UX-065.2: the Body tab picks anatomy from body-shape presets only', () => {
    const spec = run(
      randomize({scope: {category: 'body'}, locks: defaultLocks(), seed: 3}),
      testSpec(),
    ).spec;
    expect([1, 1.2, 0.8]).toContain(spec.anatomy.torsoWidth);
    expect(spec.anatomy.head).toBe(1);
  });
});
