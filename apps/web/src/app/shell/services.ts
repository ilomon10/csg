import {MESSAGES, t} from '../../shared/i18n';
import {SLOT_REGISTRY, canonicalProjectJson} from '@csg/parts-schema';
import {loadCatalog} from '../../shared/catalog';
import type {Catalog} from '../../shared/catalog';
import type {MessageKey} from '../../shared/i18n';
import {createDocumentStore} from '../../shared/document';
import type {DocumentStore, HistoryEntry} from '../../shared/document';
import {
  createAutosaver,
  createProjectRepository,
  emptyRecovery,
  openCsgDatabase,
  readRecovery,
  writeRecovery,
} from '../../shared/persistence';
import type {
  Autosaver,
  ChannelFactory,
  ProjectRepository,
  SaveStatus,
  StorageEstimateLike,
  UxError,
} from '../../shared/persistence';
import {
  DEFAULT_SHORTCUTS,
  appScopeStack,
  createCommandRegistry,
  createShortcutDispatcher,
} from '../../shared/shortcuts';
import type {CommandRegistry, ScopeStack} from '../../shared/shortcuts';
import {announce, toastQueue} from '../../shared/ui';
import {buildCommands} from './commands';
import {createMiniStore} from './mini-store';
import type {MiniStore} from './mini-store';
import {createPrefsStore, safeLocalStorage} from './prefs-store';
import type {PrefsStore} from './prefs-store';
import {createDiagnostics} from './renderer-status';
import type {Diagnostics} from './renderer-status';
import {createRouter} from './router';
import type {Router} from './router';
import {createSessionMarker} from './session-marker';
import {createTabLock} from './tab-lock';
import type {LockState, TabLock} from './tab-lock';

/** The previous session ended unclean (REQ-UX-045). */
export interface RestoreOffer {
  readonly projectId: string;
  readonly name: string;
  /** Epoch ms of the autosave. */
  readonly savedAt: number;
  /** A restore was already under way when the tab died: "Start without restoring" is the default. */
  readonly inProgress: boolean;
  /** Code of a failed restore attempt. */
  readonly error: string | null;
}

/** Serializable shell state. */
export interface ShellState {
  readonly phase: 'booting' | 'ready';
  readonly storageAvailable: boolean;
  readonly restore: RestoreOffer | null;
  readonly saveStatus: SaveStatus;
  readonly lock: LockState;
  /** Name of the open project (list metadata). */
  readonly projectName: string | null;
  /** A project route is being loaded. */
  readonly loadingProject: boolean;
}

/** Which overlays are open (REQ-UX-019, REQ-UX-020, REQ-UX-037). */
export interface OverlayState {
  readonly palette: boolean;
  readonly help: boolean;
  readonly settings: boolean;
  readonly diagnostics: boolean;
}

/**
 * A button a view contributes to the top bar (REQ-UX-006: the library drawer toggle lives in
 * the top bar at 1024 to 1279 px). The shell renders it; the view owns the behavior.
 */
export interface TopBarAction {
  readonly id: string;
  /** Visible text and accessible name. */
  readonly label: string;
  /** Drawer toggles: whether the drawer is open. */
  readonly expanded?: boolean;
  /** Id of the element the button controls. */
  readonly controls?: string;
  readonly onClick: () => void;
}

/** Everything the shell builds from the outside world, injectable for tests. */
export interface ShellDeps {
  readonly win: Window;
  readonly idb?: IDBFactory;
  readonly fetchText?: (url: string) => Promise<string>;
  readonly channelFactory?: ChannelFactory;
  readonly tabId?: string;
  readonly claimWait?: (ms: number) => Promise<void>;
  readonly estimate?: () => Promise<StorageEstimateLike>;
  /** Set false to skip the background catalog load (tests). */
  readonly loadCatalog?: boolean;
  readonly packs?: readonly string[];
}

/** Bundled packs the catalog reads (spec 011). */
export const BUNDLED_PACKS: readonly string[] = [
  'quaternius-ubc',
  'quaternius-outfits',
  'quaternius-ual',
];

/** The shell's long-lived objects. Created once by the root component. */
export interface ShellServices {
  readonly win: Window;
  readonly prefs: PrefsStore;
  readonly router: Router;
  readonly registry: CommandRegistry;
  readonly scopes: ScopeStack;
  readonly store: DocumentStore;
  readonly diagnostics: Diagnostics;
  readonly state: MiniStore<ShellState>;
  readonly overlays: MiniStore<OverlayState>;
  readonly catalog: MiniStore<{readonly catalog: Catalog | null}>;
  /** Buttons the open view registers in the top bar; it clears them when it unmounts. */
  readonly topBarActions: MiniStore<{
    readonly actions: readonly TopBarAction[];
  }>;
  readonly lock: TabLock;
  repo(): ProjectRepository | null;
  autosaver(): Autosaver | null;
  start(): Promise<void>;
  /** Attaches the one global keyboard listener (REQ-UX-011). */
  attachShortcuts(): () => void;
  /** Mod+S. */
  saveNow(): Promise<boolean>;
  retrySave(): Promise<boolean>;
  renameProject(name: string): Promise<void>;
  takeOver(): Promise<void>;
  acceptRestore(): Promise<void>;
  declineRestore(): Promise<void>;
  /** Undo or redo, restoring the UI context of the entry (REQ-UX-024). */
  stepHistory(direction: 'undo' | 'redo'): void;
  /** Canonical project JSON of the open project, else of the latest autosave. */
  backupJson(): Promise<{name: string; json: string} | null>;
  downloadBackup(): Promise<boolean>;
  /** Shows a shell error as a toast with its code and records it for diagnostics. */
  reportError(code: string, tone?: 'warning' | 'error'): void;
  dispose(): void;
}

function randomTabId(): string {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === 'function'
    ? c.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;
}

/** Creates the shell services. Nothing here touches the engine or the preview. */
export function createShellServices(deps: ShellDeps): ShellServices {
  const {win} = deps;
  const prefs = createPrefsStore(win);
  const router = createRouter(win);
  const registry = createCommandRegistry();
  const scopes = appScopeStack;
  const store = createDocumentStore();
  const diagnostics = createDiagnostics();
  const storage = safeLocalStorage(win);
  const session = createSessionMarker(storage);
  const lock = createTabLock({
    tabId: deps.tabId ?? randomTabId(),
    ...(deps.channelFactory ? {channelFactory: deps.channelFactory} : {}),
    ...(deps.claimWait ? {wait: deps.claimWait} : {}),
  });
  const state = createMiniStore<ShellState>({
    phase: 'booting',
    storageAvailable: true,
    restore: null,
    saveStatus: 'saved',
    lock: 'free',
    projectName: null,
    loadingProject: false,
  });
  const overlays = createMiniStore<OverlayState>({
    palette: false,
    help: false,
    settings: false,
    diagnostics: false,
  });
  const topBarActions = createMiniStore<{
    readonly actions: readonly TopBarAction[];
  }>({actions: []});
  const catalogStore = createMiniStore<{readonly catalog: Catalog | null}>({
    catalog: null,
  });
  const estimate =
    deps.estimate ??
    (() =>
      win.navigator.storage?.estimate?.() ??
      Promise.resolve<StorageEstimateLike>({}));
  let repo: ProjectRepository | null = null;
  let autosaver: Autosaver | null = null;
  const disposers: Array<() => void> = [];

  const reportError = (code: string, tone: 'warning' | 'error' = 'warning') => {
    diagnostics.recordError(code);
    const key = `error.${code}`;
    toastQueue.push({
      message: Object.hasOwn(MESSAGES, key) ? t(key as MessageKey) : code,
      tone,
      code,
    });
  };

  const fail = (error: UxError) => reportError(error.code);

  // ---- document bookkeeping -------------------------------------------------
  let trackedProject: string | null = null;
  let trackedRevision = 0;
  let dirtyMarked = false;
  disposers.push(
    store.subscribe(() => {
      const s = store.getState();
      if (s.projectId !== trackedProject) {
        trackedProject = s.projectId;
        trackedRevision = s.revision;
        dirtyMarked = false;
        return;
      }
      if (s.projectId !== null && s.revision > trackedRevision && !s.readOnly) {
        trackedRevision = s.revision;
        if (!dirtyMarked) {
          session.set(s.projectId);
          dirtyMarked = true;
        }
      }
    }),
  );
  disposers.push(
    lock.subscribe(() => {
      state.update({lock: lock.state()});
      store.setReadOnly(lock.state() === 'read-only');
    }),
  );

  // ---- project loading ------------------------------------------------------
  let loadToken = 0;
  async function openRoute(): Promise<void> {
    const route = router.current();
    const token = ++loadToken;
    if (route.view !== 'project') {
      lock.release();
      state.update({loadingProject: false, projectName: null});
      return;
    }
    if (state.get().restore !== null || state.get().phase !== 'ready') return;
    const id = route.projectId;
    if (
      store.getState().projectId === id &&
      store.getState().doc !== null &&
      lock.projectId() === id &&
      lock.state() !== 'free'
    ) {
      state.update({loadingProject: false});
      return;
    }
    state.update({loadingProject: true});
    if (repo === null) {
      reportError('UX_STORAGE_UNAVAILABLE');
      state.update({loadingProject: false});
      await router.navigate({view: 'home'}, {replace: true});
      return;
    }
    await lock.claim(id);
    const result = await repo.get(id);
    if (token !== loadToken) return;
    if (!result.ok) {
      fail(result.error);
      lock.release();
      state.update({loadingProject: false});
      await router.navigate({view: 'home'}, {replace: true});
      return;
    }
    store.open(id, result.value.doc);
    store.setReadOnly(lock.state() === 'read-only');
    state.update({loadingProject: false, projectName: result.value.meta.name});
  }

  disposers.push(
    router.subscribe(() => {
      void openRoute();
    }),
  );
  disposers.push(
    router.addGuard(async from => {
      if (from.view === 'project' && autosaver !== null) {
        await autosaver.saveNow();
      }
    }),
  );

  // ---- save ----------------------------------------------------------------
  const saveNow = async (): Promise<boolean> => {
    if (autosaver === null) return false;
    const ok = await autosaver.saveNow();
    if (ok) {
      session.clear();
      dirtyMarked = false;
    }
    return ok;
  };

  // ---- backup ----------------------------------------------------------------
  const safeName = (name: string) =>
    name.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 64) || 'project';
  async function backupJson(): Promise<{name: string; json: string} | null> {
    const doc = store.getState().doc;
    if (doc !== null) {
      return {
        name: safeName(state.get().projectName ?? doc.character.name),
        json: canonicalProjectJson(doc),
      };
    }
    const id =
      router.current().view === 'project'
        ? (router.current() as {projectId: string}).projectId
        : session.read();
    if (repo === null || id === null) return null;
    const rec = await repo.get(id);
    if (!rec.ok) return null;
    return {
      name: safeName(rec.value.meta.name),
      json: canonicalProjectJson(rec.value.doc),
    };
  }
  async function downloadBackup(): Promise<boolean> {
    const backup = await backupJson();
    if (backup === null) return false;
    const url = URL.createObjectURL(
      new Blob([backup.json], {type: 'application/json'}),
    );
    const a = win.document.createElement('a');
    a.href = url;
    a.download = `${backup.name}.sprite-project.json`;
    win.document.body.append(a);
    a.click();
    a.remove();
    win.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  }

  // ---- history ---------------------------------------------------------------
  const TABS = ['parts', 'colors', 'anatomy', 'render', 'animation'] as const;
  const DOCKS = ['timeline', 'material-graph', 'post-graph'] as const;
  function restoreContext(entry: HistoryEntry): void {
    const c = entry.context;
    const patch: Parameters<PrefsStore['set']>[0] = {};
    const tab = TABS.find(t => t === c.inspectorTab);
    const dock = DOCKS.find(d => d === c.dock);
    if (tab) patch.inspectorTab = tab;
    if (dock) patch.dockTab = dock;
    if (c.easyCategory) patch.easyTab = c.easyCategory;
    if (Object.keys(patch).length > 0) prefs.set(patch);
    if (c.focusKey !== undefined) {
      const key = c.focusKey;
      win.requestAnimationFrame(() => {
        Array.from(
          win.document.querySelectorAll<HTMLElement>('[data-focus-key]'),
        )
          .find(el => el.dataset['focusKey'] === key)
          ?.focus();
      });
    }
  }
  function stepHistory(direction: 'undo' | 'redo'): void {
    const entry = direction === 'undo' ? store.undo() : store.redo();
    if (entry === null) return;
    restoreContext(entry);
    const message = t(direction === 'undo' ? 'toast.undid' : 'toast.redid', {
      label: entry.label,
    });
    announce(message);
    // A change in a region that is not on screen needs a visible trace (AC-UX-022.3).
    if (entry.feature === 'graph') toastQueue.push({message, tone: 'info'});
  }

  // ---- restore -----------------------------------------------------------------
  async function acceptRestore(): Promise<void> {
    const offer = state.get().restore;
    if (offer === null || repo === null) return;
    writeRecovery(storage, {
      ...emptyRecovery(),
      restoreInProgress: {projectId: offer.projectId},
    });
    const result = await repo.get(offer.projectId);
    if (!result.ok) {
      writeRecovery(storage, emptyRecovery());
      diagnostics.recordError(result.error.code);
      state.update({restore: {...offer, error: result.error.code}});
      return;
    }
    await lock.claim(offer.projectId);
    store.open(offer.projectId, result.value.doc);
    store.setReadOnly(lock.state() === 'read-only');
    state.update({
      restore: null,
      projectName: result.value.meta.name,
      phase: 'ready',
    });
    session.clear();
    writeRecovery(storage, emptyRecovery());
    await router.navigate(
      {view: 'project', projectId: offer.projectId},
      {replace: true},
    );
  }
  async function declineRestore(): Promise<void> {
    session.clear();
    writeRecovery(storage, emptyRecovery());
    state.update({restore: null});
    await router.navigate({view: 'home'}, {replace: true});
  }

  // ---- start --------------------------------------------------------------------
  async function runStart(): Promise<void> {
    const recovery = readRecovery(storage);
    const unclean = recovery.restoreInProgress?.projectId ?? session.read();
    const opened = await openCsgDatabase(deps.idb);
    if (opened.ok) {
      repo = createProjectRepository({
        database: opened.value,
        estimate,
        ...(deps.channelFactory ? {channelFactory: deps.channelFactory} : {}),
      });
      autosaver = createAutosaver({store, repo, estimate});
      let wasFailed = false;
      disposers.push(
        autosaver.subscribe(() => {
          const status = autosaver?.status() ?? 'saved';
          state.update({saveStatus: status});
          if (status === 'failed' && !wasFailed) {
            announce(t('save.failed'));
            reportError('UX_SAVE_FAILED', 'error');
          }
          wasFailed = status === 'failed';
        }),
      );
    } else {
      state.update({storageAvailable: false});
      reportError(opened.error.code);
    }

    const list = repo === null ? [] : await repo.list();
    if (repo !== null && unclean !== null) {
      const meta = list.find(m => m.projectId === unclean);
      if (meta !== undefined) {
        state.update({
          restore: {
            projectId: meta.projectId,
            name: meta.name,
            savedAt: meta.lastEditedAt,
            inProgress: recovery.restoreInProgress !== undefined,
            error: null,
          },
        });
      } else {
        session.clear();
        writeRecovery(storage, emptyRecovery());
      }
    }

    if (router.current().view === 'startup') {
      const p = prefs.get();
      const recent = list[0];
      await router.navigate(
        !p.showHomeOnStartup &&
          recent !== undefined &&
          state.get().restore === null
          ? {view: 'project', projectId: recent.projectId}
          : {view: 'home'},
        {replace: true},
      );
    }
    state.update({phase: 'ready'});
    await openRoute();

    if (deps.loadCatalog !== false) {
      const fetchText =
        deps.fetchText ??
        (async (url: string) => {
          const res = await win.fetch(url);
          if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
          return res.text();
        });
      void loadCatalog(fetchText, deps.packs ?? BUNDLED_PACKS, {
        slotRegistry: SLOT_REGISTRY,
      }).then(result => {
        if (result.ok) catalogStore.set({catalog: result.value});
        else {
          diagnostics.recordError(result.error.code);
          toastQueue.push({
            message: t('toast.catalogFailed'),
            tone: 'warning',
            code: result.error.code,
          });
        }
      });
    }
  }

  let started: Promise<void> | null = null;
  /** Idempotent: StrictMode runs effects twice in development. */
  const start = (): Promise<void> => (started ??= runStart());

  // ---- page lifecycle -----------------------------------------------------------
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (autosaver?.needsConfirmOnUnload()) {
      e.preventDefault();
      e.returnValue = t('unsaved.leave');
    }
  };
  const onPageHide = () => {
    if (!(autosaver?.needsConfirmOnUnload() ?? false)) session.clear();
  };
  win.addEventListener('beforeunload', onBeforeUnload);
  win.addEventListener('pagehide', onPageHide);

  const services: ShellServices = {
    win,
    prefs,
    router,
    registry,
    scopes,
    store,
    diagnostics,
    state,
    overlays,
    catalog: catalogStore,
    topBarActions,
    lock,
    repo: () => repo,
    autosaver: () => autosaver,
    start,
    attachShortcuts() {
      const dispatcher = createShortcutDispatcher({
        registry,
        shortcuts: DEFAULT_SHORTCUTS,
        activeScopes: () => scopes.active(),
        singleKeyEnabled: () => prefs.get().singleKeyShortcuts,
        onError: () => reportError('UX_COMMAND_FAILED', 'error'),
      });
      return dispatcher.attach(win);
    },
    saveNow,
    retrySave: async () => (await autosaver?.retry()) ?? false,
    async renameProject(name) {
      const trimmed = name.trim().slice(0, 64);
      const id = store.getState().projectId;
      if (trimmed === '' || id === null || repo === null) return;
      const result = await repo.updateMeta(id, {name: trimmed});
      if (result.ok) state.update({projectName: trimmed});
      else fail(result.error);
    },
    async takeOver() {
      lock.takeOver();
      const id = lock.projectId();
      if (id === null || repo === null) return;
      const result = await repo.get(id);
      if (result.ok) store.open(id, result.value.doc);
      store.setReadOnly(false);
    },
    acceptRestore,
    declineRestore,
    stepHistory,
    backupJson,
    downloadBackup,
    reportError,
    dispose() {
      win.removeEventListener('beforeunload', onBeforeUnload);
      win.removeEventListener('pagehide', onPageHide);
      for (const d of disposers) d();
      autosaver?.dispose();
      lock.dispose();
      router.dispose();
    },
  };
  disposers.push(registry.register(buildCommands(services)));
  return services;
}
