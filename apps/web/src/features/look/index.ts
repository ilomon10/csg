/**
 * Look feature (spec 003 and 006): the simplified Look panel with the preset picker, and the
 * Pro Render tab. Both edit the open project's render settings through `render` commands;
 * they never import another feature.
 */
export {LookPanel, type LookCatalog, type LookPanelProps} from './look-panel';
export {ProRenderTab, type ProRenderTabProps} from './pro-render-tab';
export {
  createFrameTiming,
  measureStructural,
  STRUCTURAL_BUDGET_MS,
  type StructuralSample,
  type StructuralTiming,
} from './structural-timing';
export {
  dispatchRenderPatch,
  lookPatch,
  presetMatches,
  renderCommand,
  resolveRenderPatch,
  type RenderEdit,
  type RenderIssue,
  type RenderPatch,
} from './render-model';
