import {createDefaultCharacterSpec} from '@csg/parts-schema';
import {beforeAll, describe, expect, it} from 'vitest';
import type {Catalog} from '../../../shared/catalog';
import {createDraftTarget} from '../../../shared/document';
import {WIZARD_STEPS, randomizeStep, skipStep} from './wizard-steps';
import {loadWizardCatalog} from './wizard-test-support';

let catalog: Catalog;
beforeAll(async () => {
  catalog = await loadWizardCatalog();
});
const step = (id: string) => WIZARD_STEPS.find(s => s.id === id)!;

describe('wizard steps', () => {
  it('AC-UX-089.1: lists the eight steps in order', () => {
    expect(WIZARD_STEPS.map(s => s.id)).toEqual([
      'style',
      'species',
      'body',
      'face',
      'hair',
      'outfit',
      'colors',
      'name',
    ]);
  });

  it('AC-UX-096.1: randomizing the outfit step only changes outfit slots and tints', () => {
    const start = createDefaultCharacterSpec();
    const draft = createDraftTarget(start, () => catalog);
    for (let seed = 1; seed <= 20; seed++) {
      randomizeStep(draft, catalog, step('outfit'), seed);
      const now = draft.getSpec();
      const outfit = new Set(['headwear', 'torso', 'arms', 'legs', 'feet']);
      for (const slot of Object.keys({...start.parts, ...now.parts})) {
        if (outfit.has(slot)) continue;
        expect(now.parts[slot]).toEqual(start.parts[slot]);
      }
      expect(now.body).toEqual(start.body);
      expect(now.anatomy).toEqual(start.anatomy);
      expect(now.style).toBe(start.style);
      for (const ch of ['skin', 'hair', 'eyes', 'metal', 'leather'] as const) {
        expect(now.tints[ch]).toEqual(start.tints[ch]);
      }
    }
  });

  it('AC-UX-096.2: randomizing the style step only picks enabled styles', () => {
    const draft = createDraftTarget(
      createDefaultCharacterSpec(),
      () => catalog,
    );
    for (let seed = 0; seed < 100; seed++) {
      randomizeStep(draft, catalog, step('style'), seed);
      expect(['realistic', 'chibi']).toContain(draft.getSpec().style);
    }
  });

  it('AC-UX-095.2: skip resets the step to the starting values', () => {
    const start = createDefaultCharacterSpec();
    const draft = createDraftTarget(start, () => catalog);
    randomizeStep(draft, catalog, step('hair'), 7);
    skipStep(draft, catalog, step('hair'), start);
    expect(draft.getSpec().parts['hair']).toEqual(start.parts['hair']);
    expect(draft.getSpec().tints.hair).toEqual(start.tints.hair);
    randomizeStep(draft, catalog, step('body'), 3);
    skipStep(draft, catalog, step('body'), start);
    expect(draft.getSpec().anatomy).toEqual(start.anatomy);
    expect(draft.isPristine()).toBe(true);
  });
});
