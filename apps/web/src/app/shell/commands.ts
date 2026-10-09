import {t} from '../../shared/i18n';
import type {CommandDef} from '../../shared/shortcuts';
import {announce} from '../../shared/ui';
import {focusRegion} from './focus-regions';
import type {OverlayState, ShellServices} from './services';

const CLOSE_ORDER: ReadonlyArray<keyof OverlayState> = [
  'palette',
  'help',
  'diagnostics',
  'settings',
];

/** Closes the topmost open overlay. Returns false when none was open. */
export function closeTopOverlay(services: ShellServices): boolean {
  const open = CLOSE_ORDER.find(name => services.overlays.get()[name]);
  if (open === undefined) return false;
  services.overlays.update({[open]: false});
  return true;
}

/**
 * The commands the shell itself owns (REQ-UX-018). Features register their own through the
 * same registry; the palette, the shortcut dispatcher and the buttons all run these.
 */
export function buildCommands(services: ShellServices): CommandDef[] {
  const {overlays, store, prefs, router, win} = services;
  const open = (name: keyof OverlayState) => () =>
    overlays.update({[name]: true});
  const inProject = () =>
    router.current().view === 'project' ? null : 'reason.noProject';
  const historyReason = (side: 'undo' | 'redo') => () => {
    const s = store.getState();
    if (s.readOnly) return 'reason.readOnly';
    return (side === 'undo' ? s.undo : s.redo) === null
      ? side === 'undo'
        ? 'reason.nothingToUndo'
        : 'reason.nothingToRedo'
      : null;
  };
  return [
    {
      id: 'app.commandPalette',
      titleKey: 'cmd.app.commandPalette',
      category: 'app',
      synonyms: ['search', 'commands', 'actions'],
      run: open('palette'),
    },
    {
      id: 'app.help',
      titleKey: 'cmd.app.help',
      category: 'app',
      synonyms: ['shortcuts', 'keys', 'help'],
      run: () => overlays.update({help: !overlays.get().help}),
    },
    {
      id: 'app.settings',
      titleKey: 'cmd.app.settings',
      category: 'app',
      synonyms: ['preferences', 'theme', 'options'],
      run: open('settings'),
    },
    {
      id: 'app.diagnostics',
      titleKey: 'cmd.app.diagnostics',
      category: 'app',
      synonyms: ['renderer', 'webgpu', 'report'],
      run: open('diagnostics'),
    },
    {
      id: 'app.home',
      titleKey: 'cmd.app.home',
      category: 'app',
      synonyms: ['characters', 'lineup'],
      disabledReason: () =>
        router.current().view === 'home' ? 'reason.noProject' : null,
      run: async () => {
        await router.navigate({view: 'home'});
      },
    },
    {
      id: 'app.undo',
      titleKey: 'cmd.app.undo',
      category: 'project',
      disabledReason: historyReason('undo'),
      run: () => services.stepHistory('undo'),
    },
    {
      id: 'app.redo',
      titleKey: 'cmd.app.redo',
      category: 'project',
      disabledReason: historyReason('redo'),
      run: () => services.stepHistory('redo'),
    },
    {
      id: 'app.toggleWorkspace',
      titleKey: 'cmd.app.toggleWorkspace',
      category: 'app',
      synonyms: ['easy', 'pro', 'mode', 'workspace'],
      disabledReason: inProject,
      run: () => {
        const next = prefs.get().workspace === 'easy' ? 'pro' : 'easy';
        prefs.set({workspace: next});
        announce(t(next === 'easy' ? 'bar.easy' : 'bar.pro'));
      },
    },
    {
      id: 'app.focusNextRegion',
      titleKey: 'cmd.app.focusNextRegion',
      category: 'app',
      run: () => focusRegion(win.document, 1),
    },
    {
      id: 'app.focusPrevRegion',
      titleKey: 'cmd.app.focusPrevRegion',
      category: 'app',
      run: () => focusRegion(win.document, -1),
    },
    {
      id: 'app.closeOverlay',
      titleKey: 'cmd.app.closeOverlay',
      category: 'app',
      run: () => {
        closeTopOverlay(services);
      },
    },
    {
      id: 'project.save',
      titleKey: 'cmd.project.save',
      category: 'project',
      synonyms: ['autosave'],
      disabledReason: () =>
        store.getState().doc === null
          ? 'reason.noProject'
          : store.getState().readOnly
            ? 'reason.readOnly'
            : null,
      run: async () => {
        if (await services.saveNow()) announce(t('toast.saved'));
      },
    },
    {
      id: 'project.new',
      titleKey: 'cmd.project.new',
      category: 'project',
      synonyms: ['create', 'wizard'],
      run: async () => {
        await router.navigate({view: 'wizard'});
      },
    },
  ];
}
