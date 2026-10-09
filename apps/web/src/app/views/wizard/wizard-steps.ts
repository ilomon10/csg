import type {MessageKey} from '../../../shared/i18n';
import {CHARACTER_SPECIES, CHARACTER_STYLES} from '@csg/parts-schema';
import type {CharacterSpec, EasyCategoryId, TintSlot} from '@csg/parts-schema';
import {isPairAvailable} from '../../../features/composer';
import type {Catalog} from '../../../shared/catalog';
import {
  applyBodyShape,
  defaultLocks,
  mulberry32,
  randomize,
  setSpecies,
  setStyle,
  setTint,
} from '../../../shared/document';
import type {
  CharacterCommand,
  CharacterTarget,
  DraftTarget,
} from '../../../shared/document';

/** The wizard step IDs, in order (REQ-UX-089). */
export type WizardStepId =
  'style' | 'species' | 'body' | 'face' | 'hair' | 'outfit' | 'colors' | 'name';

/** One wizard step: its copy and, for the Easy-derived steps, the category it is built from. */
export interface WizardStep {
  readonly id: WizardStepId;
  readonly title: MessageKey;
  readonly subtitle: MessageKey;
  /** Easy category whose tile groups and swatch row the step reuses (REQ-UX-094). */
  readonly category?: EasyCategoryId;
}

/** The eight steps in the order of REQ-UX-089. */
export const WIZARD_STEPS: readonly WizardStep[] = [
  {id: 'style', title: 'wiz.step.style', subtitle: 'wiz.sub.style'},
  {id: 'species', title: 'wiz.step.species', subtitle: 'wiz.sub.species'},
  {id: 'body', title: 'wiz.step.body', subtitle: 'wiz.sub.body'},
  {
    id: 'face',
    title: 'wiz.step.face',
    subtitle: 'wiz.sub.face',
    category: 'face',
  },
  {
    id: 'hair',
    title: 'wiz.step.hair',
    subtitle: 'wiz.sub.hair',
    category: 'hair',
  },
  {
    id: 'outfit',
    title: 'wiz.step.outfit',
    subtitle: 'wiz.sub.outfit',
    category: 'outfit',
  },
  {
    id: 'colors',
    title: 'wiz.step.colors',
    subtitle: 'wiz.sub.colors',
    category: 'colors',
  },
  {id: 'name', title: 'wiz.step.name', subtitle: 'wiz.sub.name'},
];

/** Number of steps. */
export const WIZARD_STEP_COUNT = WIZARD_STEPS.length;

/** Sets the character name (the wizard's name field commits it at Finish; REQ-UX-099). */
export function setCharacterName(name: string): CharacterCommand {
  return {
    label: 'Name character',
    feature: 'composer',
    run(spec) {
      return spec.name === name ? null : {spec: {...spec, name}, removed: []};
    },
  };
}

function categoryOf(catalog: Catalog, id: EasyCategoryId | undefined) {
  return id === undefined
    ? undefined
    : catalog.easyCategories.find(c => c.id === id);
}

/**
 * Skip (REQ-UX-095): resets the step's fields to their values at wizard start. Style also
 * restores the style's base anatomy, which `setStyle` wrote.
 */
export function skipStep(
  draft: DraftTarget,
  catalog: Catalog,
  step: WizardStep,
  start: CharacterSpec,
): void {
  switch (step.id) {
    case 'style':
      draft.reset(['style', 'anatomy']);
      return;
    case 'species':
      draft.reset(['species']);
      return;
    case 'body':
      draft.reset(['anatomy']);
      return;
    case 'colors':
      draft.reset(['tints', 'seed']);
      return;
    case 'face':
    case 'hair':
    case 'outfit': {
      const def = categoryOf(catalog, step.category);
      // Category randomize also stores its seed in the spec (REQ-CMP-018).
      draft.reset(['seed', ...(def?.slots ?? []).map(slot => `parts.${slot}`)]);
      for (const channel of def?.tintChannels ?? []) {
        const hex = start.tints[channel as TintSlot];
        if (hex !== undefined) draft.apply(setTint(channel as TintSlot, hex));
      }
      return;
    }
    case 'name':
      return;
  }
}

/**
 * Randomize (REQ-UX-096): touches only the step's own fields. Style and species pick among the
 * options the single gating rule enables (REQ-UX-092); body shape picks one of the cards;
 * the Easy-derived steps run the category-scoped randomize. Deterministic for a seed.
 */
export function randomizeStep(
  target: CharacterTarget,
  catalog: Catalog,
  step: WizardStep,
  seed: number,
): void {
  const rng = mulberry32(seed);
  const spec = target.getSpec();
  const pick = <T>(list: readonly T[]): T | undefined =>
    list[Math.floor(rng() * list.length)];
  switch (step.id) {
    case 'style': {
      const style = pick(
        CHARACTER_STYLES.filter(s => isPairAvailable(catalog, s, spec.species)),
      );
      if (style) target.apply(setStyle(style));
      return;
    }
    case 'species': {
      const species = pick(
        CHARACTER_SPECIES.filter(s => isPairAvailable(catalog, spec.style, s)),
      );
      if (species) target.apply(setSpecies(species));
      return;
    }
    case 'body': {
      const shape = pick(catalog.bodyShapes);
      if (shape) target.apply(applyBodyShape(shape.id));
      return;
    }
    case 'face':
    case 'hair':
    case 'outfit':
    case 'colors':
      if (step.category) {
        target.apply(
          randomize({
            scope: {category: step.category},
            locks: defaultLocks(),
            seed,
          }),
        );
      }
      return;
    case 'name':
      return;
  }
}
