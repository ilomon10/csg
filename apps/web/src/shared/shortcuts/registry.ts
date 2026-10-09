import type {ShortcutDef, ShortcutScope} from './types';
import {REGION_SCOPES} from './types';

const def = (
  commandId: string,
  keys: readonly string[],
  scope: ShortcutScope,
  extra: Partial<Pick<ShortcutDef, 'allowInInput' | 'shadows' | 'when'>> = {},
): ShortcutDef => ({commandId, keys, scope, ...extra});

/** One row of the table in several scopes. */
const inScopes = (
  commandId: string,
  keys: readonly string[],
  scopes: readonly ShortcutScope[],
): ShortcutDef[] => scopes.map(scope => def(commandId, keys, scope));

/**
 * The canonical default shortcuts of spec 009 (*Default shortcuts*), row for row
 * (AC-UX-011.2). A row bound in several scopes is one entry per scope. Chord names follow
 * `KeyboardEvent.key` (`ArrowLeft`, `Escape`); Alt chords match on `code` (PM decision).
 */
export const DEFAULT_SHORTCUTS: readonly ShortcutDef[] = [
  def('app.commandPalette', ['Mod+K', 'Mod+Shift+P'], 'global', {
    allowInInput: true,
  }),
  ...inScopes('app.help', ['?'], REGION_SCOPES),
  def('app.help', ['F1'], 'global', {allowInInput: true}),
  def('app.undo', ['Mod+Z'], 'global'),
  def('app.redo', ['Mod+Shift+Z', 'Mod+Y'], 'global'),
  def('project.save', ['Mod+S'], 'global', {allowInInput: true}),
  def('project.exportFile', ['Mod+Shift+S'], 'global'),
  def('project.open', ['Mod+O'], 'global'),
  def('project.new', ['Mod+Alt+N'], 'global'),
  def('app.toggleWorkspace', ['Mod+Alt+P'], 'global'),
  def('wizard.exit', ['Escape'], 'wizard', {allowInInput: true}),
  def('export.open', ['Mod+E'], 'global'),
  def('app.focusNextRegion', ['F6'], 'global'),
  def('app.focusPrevRegion', ['Shift+F6'], 'global'),
  def('app.closeOverlay', ['Escape'], 'modal', {allowInInput: true}),
  def('dock.toggle', ['Mod+J'], 'global'),
  def('dock.timeline', ['Mod+Shift+L'], 'global'),
  def('dock.materialGraph', ['Mod+Shift+G'], 'global'),
  def('dock.postGraph', ['Mod+Shift+O'], 'global'),
  def('dock.maximize', ['Mod+Shift+M'], 'global'),
  def('inspector.tab1', ['Alt+Shift+1'], 'global'),
  def('inspector.tab2', ['Alt+Shift+2'], 'global'),
  def('inspector.tab3', ['Alt+Shift+3'], 'global'),
  def('inspector.tab4', ['Alt+Shift+4'], 'global'),
  def('inspector.tab5', ['Alt+Shift+5'], 'global'),
  ...inScopes(
    'composer.randomize',
    ['R'],
    ['library', 'viewport', 'inspector'],
  ),
  ...inScopes(
    'composer.randomizeReroll',
    ['Shift+R'],
    ['library', 'viewport', 'inspector'],
  ),
  def('composer.clearSlot', ['Delete', 'Backspace'], 'library', {
    when: 'slot-focused',
  }),
  ...inScopes('animation.togglePlay', ['Space'], ['viewport', 'timeline']),
  ...inScopes(
    'animation.prevFrame',
    ['ArrowLeft', ','],
    ['timeline', 'viewport'],
  ),
  ...inScopes(
    'animation.nextFrame',
    ['ArrowRight', '.'],
    ['timeline', 'viewport'],
  ),
  def('animation.firstFrame', ['Home'], 'timeline'),
  def('animation.lastFrame', ['End'], 'timeline'),
  def('viewport.toggleMode', ['V'], 'viewport'),
  def('viewport.frame', ['F'], 'viewport'),
  def('viewport.prevDir', ['['], 'viewport'),
  def('viewport.nextDir', [']'], 'viewport'),
  def('viewport.zoomIn', ['+'], 'viewport'),
  def('viewport.zoomOut', ['-'], 'viewport'),
  def('graph.search', ['Shift+A'], 'graph'),
  def('graph.search', ['Space'], 'graph', {when: 'tap'}),
  def('graph.zoomIn', ['+'], 'graph'),
  def('graph.zoomOut', ['-'], 'graph'),
  def('graph.mute', ['M'], 'graph'),
  def('graph.hideUnused', ['Alt+Shift+H'], 'graph'),
  def('graph.frameSelection', ['F'], 'graph'),
  def('graph.frameAll', ['Home'], 'graph'),
  def('graph.frameBox', ['J'], 'graph'),
  def('graph.toggleSubgraph', ['Tab'], 'graph', {when: 'group-enter-or-exit'}),
  def('graph.exitSubgraph', ['Escape'], 'graph', {when: 'inside-group-idle'}),
  def('graph.copy', ['Mod+C'], 'graph'),
  def('graph.cut', ['Mod+X'], 'graph'),
  def('graph.paste', ['Mod+V'], 'graph'),
  def('graph.duplicate', ['Mod+D', 'Shift+D'], 'graph'),
  def('graph.delete', ['Delete', 'Backspace'], 'graph'),
  def('graph.selectAll', ['A', 'Mod+A'], 'graph'),
  def('graph.deselectAll', ['Alt+A'], 'graph'),
  def('graph.group', ['Mod+G'], 'graph'),
  def('graph.ungroup', ['Mod+Alt+G'], 'graph'),
  def('graph.togglePreview', ['Shift+H'], 'graph'),
  def('graph.collapse', ['H'], 'graph'),
  def(
    'graph.nudge',
    ['Mod+ArrowLeft', 'Mod+ArrowRight', 'Mod+ArrowUp', 'Mod+ArrowDown'],
    'graph',
  ),
  def('graph.connect', ['C'], 'graph', {when: 'socket-focused'}),
  def('graph.toggleSnap', ['Shift+S'], 'graph'),
  def('graph.alignLeft', ['Alt+Shift+ArrowLeft'], 'graph'),
  def('graph.alignRight', ['Alt+Shift+ArrowRight'], 'graph'),
  def('graph.alignTop', ['Alt+Shift+ArrowUp'], 'graph'),
  def('graph.alignBottom', ['Alt+Shift+ArrowDown'], 'graph'),
  def('graph.find', ['Mod+F'], 'graph'),
  def('graph.contextMenu', ['Shift+F10', 'ContextMenu'], 'graph'),
  def('fit.translate', ['W'], 'prop-fitting'),
  def('fit.rotate', ['E'], 'prop-fitting'),
  def('fit.scale', ['R'], 'prop-fitting', {shadows: 'composer.randomize'}),
  def('fit.confirm', ['Enter'], 'prop-fitting'),
  def('fit.cancel', ['Escape'], 'prop-fitting'),
];
