/**
 * Anatomy feature (spec 002): the Pro Anatomy panel and the body-shape cards that the Easy
 * Shape group and wizard step 3 reuse. Bound to a `CharacterTarget`; never imports another
 * feature.
 */
export {AnatomyPanel, type AnatomyPanelProps} from './anatomy-panel';
export {BodyShapeCards, type BodyShapeCardsProps} from './body-shape-cards';
export {
  ReadabilityHint,
  readabilityIssue,
  type ReadabilityEstimate,
  type ReadabilityHintProps,
} from './readability-hint';
export type {AnatomyGesture} from './anatomy-slider';
export {
  matchingBodyShape,
  resolvePreset,
  setAnatomyValue,
  type AnatomyCatalog,
  type PresetState,
} from './anatomy-model';
