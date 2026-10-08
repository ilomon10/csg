import {z} from 'zod';
import {ANATOMY_PARAM_KEYS} from './body';
import type {AnatomyParamKey} from './body';

/** Range, default, step and randomize range of one anatomy parameter (spec 002 REQ-ANA-001). */
export interface AnatomyParamSpec {
  min: number;
  max: number;
  default: number;
  step: number;
  randomize: readonly [number, number];
}

/** The table of spec 002 REQ-ANA-001, keyed by parameter. */
export const ANATOMY_PARAM_SPECS: Readonly<
  Record<AnatomyParamKey, AnatomyParamSpec>
> = {
  height: {
    min: 0.8,
    max: 1.25,
    default: 1,
    step: 0.01,
    randomize: [0.92, 1.08],
  },
  head: {min: 0.8, max: 2, default: 1, step: 0.01, randomize: [0.95, 1.15]},
  torsoWidth: {
    min: 0.8,
    max: 1.4,
    default: 1,
    step: 0.01,
    randomize: [0.9, 1.15],
  },
  shoulders: {
    min: 0.8,
    max: 1.4,
    default: 1,
    step: 0.01,
    randomize: [0.9, 1.15],
  },
  armLength: {
    min: 0.75,
    max: 1.25,
    default: 1,
    step: 0.01,
    randomize: [0.95, 1.05],
  },
  legLength: {
    min: 0.7,
    max: 1.3,
    default: 1,
    step: 0.01,
    randomize: [0.92, 1.08],
  },
  hands: {min: 0.75, max: 1.75, default: 1, step: 0.01, randomize: [0.95, 1.1]},
  feet: {min: 0.75, max: 1.75, default: 1, step: 0.01, randomize: [0.95, 1.1]},
  limbThickness: {
    min: 0.75,
    max: 1.75,
    default: 1,
    step: 0.01,
    randomize: [0.9, 1.15],
  },
};

/** Quantizes an anatomy value to 0.01 (AC-ANA-001.2): `1.234` becomes `1.23`. */
export function quantizeAnatomy(value: number): number {
  return Math.round(value * 100) / 100;
}

function paramSchema(key: AnatomyParamKey) {
  const {min, max} = ANATOMY_PARAM_SPECS[key];
  return z
    .number()
    .finite()
    .transform(quantizeAnatomy)
    .refine(value => value >= min && value <= max, {
      error: `${key} must be between ${min} and ${max}`,
    });
}

/**
 * `CharacterSpec.anatomy` (spec 002): unitless multipliers, quantized to 0.01 on parse and
 * range-checked after quantizing (AC-ANA-001.1). Every key is required.
 */
export const anatomyParamsSchema = z.object({
  height: paramSchema('height'),
  head: paramSchema('head'),
  torsoWidth: paramSchema('torsoWidth'),
  shoulders: paramSchema('shoulders'),
  armLength: paramSchema('armLength'),
  legLength: paramSchema('legLength'),
  hands: paramSchema('hands'),
  feet: paramSchema('feet'),
  limbThickness: paramSchema('limbThickness'),
});

/** Inferred type of {@link anatomyParamsSchema}. */
export type AnatomyParams = z.infer<typeof anatomyParamsSchema>;

/** Anatomy of a new character: every value at its default, 1.00 (AC-ANA-001.3). */
export function defaultAnatomy(): AnatomyParams {
  return Object.fromEntries(
    ANATOMY_PARAM_KEYS.map(key => [key, ANATOMY_PARAM_SPECS[key].default]),
  ) as AnatomyParams;
}
