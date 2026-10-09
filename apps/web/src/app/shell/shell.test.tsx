// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {IDBFactory} from 'fake-indexeddb';
import {
  beforeAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {Catalog} from '../../shared/catalog';
import type {CommandCatalog} from '../../shared/document';
import {DEFAULT_SHORTCUTS} from '../../shared/shortcuts';
import {
  createProjectRepository,
  openCsgDatabase,
  PREFS_KEY,
  RECOVERY_KEY,
} from '../../shared/persistence';
import {canonicalProjectJson} from '@csg/parts-schema';
import {sampleDoc} from '../../shared/persistence/test-helpers';
import {toastQueue} from '../../shared/ui';
import {TEST_CRASH_EVENT, clearCrash} from './crash-hooks';
import {createShellServices} from './services';
import {createTabLock} from './tab-lock';
import {hub} from './test-channel';
import type {ShellServices} from './services';
import {SESSION_KEY} from './session-marker';
import {Shell} from './shell';
import {warmViews} from './warm-views';

// Compile-time check: the real catalog satisfies the command port (M3-07 integration note).
type CatalogSatisfiesPort = Catalog extends CommandCatalog ? true : never;
const catalogSatisfiesPort: CatalogSatisfiesPort = true;

let services: ShellServices | null = null;

/** Dispatches a key with its `code`, as a real keyboard does (user-event has no F-key codes). */
function press(code: string, init: KeyboardEventInit = {}): void {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: code,
        code,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

async function seed(idb: IDBFactory, ids: string[]): Promise<void> {
  const opened = await openCsgDatabase(idb);
  if (!opened.ok) throw new Error(opened.error.message);
  const repo = createProjectRepository({database: opened.value});
  let t = 1000;
  for (const id of ids) {
    const doc = sampleDoc(`Hero ${id}`);
    await repo.put({
      format: 'sprite-project-record',
      version: 1,
      meta: {
        projectId: id,
        name: `Hero ${id}`,
        lastEditedAt: (t += 1000),
        pinned: false,
      },
      doc,
    });
  }
}

interface Boot {
  idb: IDBFactory;
  services: ShellServices;
}

async function boot(
  options: {
    seeded?: string[];
    hash?: string;
    estimate?: () => Promise<{quota?: number; usage?: number}>;
    prefs?: Record<string, unknown>;
    channelFactory?: ReturnType<typeof hub>;
  } = {},
): Promise<Boot> {
  const idb = new IDBFactory();
  if (options.seeded) await seed(idb, options.seeded);
  window.history.replaceState(null, '', options.hash ?? '/');
  if (options.prefs) {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({format: 'sprite-ui-prefs', version: 2, ...options.prefs}),
    );
  }
  services = createShellServices({
    win: window,
    idb,
    loadCatalog: false,
    claimWait: () => new Promise(r => setTimeout(r, 0)),
    ...(options.channelFactory ? {channelFactory: options.channelFactory} : {}),
    ...(options.estimate ? {estimate: options.estimate} : {}),
  });
  render(<Shell services={services} />);
  await waitFor(() => expect(services?.state.get().phase).toBe('ready'));
  return {idb, services};
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-theme');
  for (const t of toastQueue.visible()) toastQueue.dismiss(t.id);
});
afterEach(() => {
  cleanup();
  clearCrash('root');
  clearCrash('region');
  services?.dispose();
  services = null;
});

beforeAll(async () => {
  await warmViews();
}, 60_000);

describe('shell', () => {
  it('AC-UX-070.1: a fresh profile with no fragment shows home, sets #home and opens no dialog', async () => {
    await boot();
    expect(window.location.hash).toBe('#home');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Character Sprite Generator',
      }),
    ).toBeTruthy();
    expect(catalogSatisfiesPort).toBe(true);
  });

  it('AC-UX-087.1: with the startup setting off the most recent project opens, else home', async () => {
    await boot({seeded: ['a', 'b'], prefs: {showHomeOnStartup: false}});
    await waitFor(() => expect(window.location.hash).toBe('#p=b'));
    cleanup();
    services?.dispose();
    await boot({prefs: {showHomeOnStartup: false}});
    expect(window.location.hash).toBe('#home');
  });

  it('AC-UX-069.1: an unknown project id shows home and a UX_PROJECT_NOT_FOUND warning toast', async () => {
    await boot({hash: '#p=does-not-exist'});
    await waitFor(() => expect(window.location.hash).toBe('#home'));
    expect(
      toastQueue
        .visible()
        .some(t => t.code === 'UX_PROJECT_NOT_FOUND' && t.tone === 'warning'),
    ).toBe(true);
  });

  it('AC-UX-053.1: Mod+Alt+P switches workspace and the top-bar radio reflects it', async () => {
    const user = userEvent.setup();
    await boot({seeded: ['a'], hash: '#p=a', prefs: {workspace: 'pro'}});
    const group = await screen.findByRole('radiogroup', {name: 'Workspace'});
    expect(
      within(group)
        .getByRole('radio', {name: 'Pro'})
        .getAttribute('aria-checked'),
    ).toBe('true');
    await user.keyboard('{Control>}{Alt>}p{/Alt}{/Control}');
    await waitFor(() =>
      expect(
        within(group)
          .getByRole('radio', {name: 'Easy'})
          .getAttribute('aria-checked'),
      ).toBe('true'),
    );
  });

  it('AC-UX-053.2 / AC-UX-019.1 / AC-UX-019.3: the palette lists "Switch workspace" with its chord and returns focus on close', async () => {
    const user = userEvent.setup();
    await boot();
    // Home focuses its "new" tile once loaded (REQ-UX-070); wait for that before moving focus.
    const tile = await screen.findByTestId('home-new');
    await waitFor(() => expect(document.activeElement).toBe(tile));
    const search = screen.getByRole('button', {name: /Search/});
    search.focus();
    await user.keyboard('{Control>}k{/Control}');
    const box = await screen.findByRole('combobox', {name: 'Command palette'});
    await user.type(box, 'workspace');
    const option = await screen.findByRole('option', {
      name: /Switch workspace/,
    });
    expect(option.textContent).toMatch(/Ctrl\+Alt\+P|⌘/);
    // Unavailable without a project: listed disabled with the reason; Enter does nothing (AC-UX-019.2).
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toMatch(/No project is open/);
    await user.keyboard('{Enter}');
    expect(
      screen.queryByRole('combobox', {name: 'Command palette'}),
    ).not.toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('combobox', {name: 'Command palette'}),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(search);
  });

  it('AC-UX-020.1: the help overlay lists every registry entry exactly once', async () => {
    await boot();
    press('F1');
    const dialog = await screen.findByRole('dialog', {
      name: 'Keyboard shortcuts',
    });
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(
      DEFAULT_SHORTCUTS.length,
    );
  });

  it('AC-UX-037.1: Escape closes a dialog opened from the top bar and focus returns to its button', async () => {
    const user = userEvent.setup();
    await boot();
    const gear = screen.getByRole('button', {name: 'Settings'});
    await user.click(gear);
    expect(await screen.findByRole('dialog', {name: 'Settings'})).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(gear);
  });

  it('AC-UX-012.1: Escape with focus outside the open overlay still closes it (app.closeOverlay in the modal scope)', async () => {
    await boot();
    act(() => services?.overlays.update({help: true}));
    await screen.findByRole('dialog', {name: 'Keyboard shortcuts'});
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
        }),
      );
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('AC-UX-014.1 / AC-UX-016.1: typing in the project-name field runs no shortcut; M on a button does nothing', async () => {
    const user = userEvent.setup();
    await boot({seeded: ['a'], hash: '#p=a'});
    const name = (await screen.findByRole('textbox', {
      name: 'Project name',
    })) as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'mr');
    expect(name.value).toBe('mr');
    expect(services?.registry.recent()).toEqual([]);
    const search = screen.getByRole('button', {name: /Search/});
    search.focus();
    await user.keyboard('m');
    expect(services?.registry.recent()).toEqual([]);
  });

  it('AC-UX-034.1: a stored Light theme is applied to the document, a new profile gets Dark', async () => {
    await boot();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    cleanup();
    services?.dispose();
    await boot({prefs: {theme: 'light'}});
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('AC-UX-038.1: the in-app reduce-motion setting is written to the document', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', {name: 'Settings'}));
    await user.click(await screen.findByRole('radio', {name: 'On'}));
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe(
      'true',
    );
    expect(
      JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}').reduceMotion,
    ).toBe(true);
  });

  it('AC-UX-013.1: F6 and Shift+F6 cycle focus through the regions', async () => {
    // A seeded profile: an empty one focuses the "New character" tile (REQ-UX-085).
    await boot({seeded: ['a']});
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    press('F6');
    const first = document.activeElement?.getAttribute('data-region');
    press('F6');
    const second = document.activeElement?.getAttribute('data-region');
    expect(first).toBe('Top bar');
    expect(second).not.toBe(first);
    press('F6', {shiftKey: true});
    expect(document.activeElement?.getAttribute('data-region')).toBe('Top bar');
  });

  it('AC-UX-030.1: beforeunload asks only while an autosave is pending or failed', async () => {
    const user = userEvent.setup();
    await boot({seeded: ['a'], hash: '#p=a'});
    await screen.findByRole('textbox', {name: 'Project name'});
    const clean = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    act(() => {
      services?.store.dispatch({
        label: 'Edit',
        feature: 'composer',
        apply: doc => ({
          ...doc,
          character: {...doc.character, name: 'Changed'},
        }),
      });
    });
    const dirty = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    await user.click(document.body);
    await act(async () => {
      await services?.saveNow();
    });
    const saved = new Event('beforeunload', {cancelable: true});
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });

  it('AC-UX-027.1: a failing save shows "Save failed — Retry" and one error toast', async () => {
    await boot({
      seeded: ['a'],
      hash: '#p=a',
      estimate: () => Promise.resolve({quota: 10, usage: 10}),
    });
    await screen.findByRole('textbox', {name: 'Project name'});
    act(() => {
      services?.store.dispatch({
        label: 'Edit',
        feature: 'composer',
        apply: doc => ({
          ...doc,
          character: {...doc.character, name: 'Changed'},
        }),
      });
    });
    await act(async () => {
      await services?.saveNow();
    });
    expect(
      await screen.findByRole('button', {name: /Save failed — Retry/}),
    ).toBeTruthy();
    expect(
      toastQueue.visible().filter(t => t.code === 'UX_SAVE_FAILED'),
    ).toHaveLength(1);
  });

  it('AC-UX-022.3: undoing a graph change that is not on screen shows a polite toast "Undid: Add node Toon Ramp"', async () => {
    await boot({seeded: ['a'], hash: '#p=a'});
    await screen.findByRole('textbox', {name: 'Project name'});
    act(() => {
      services?.store.dispatch({
        label: 'Add node Toon Ramp',
        feature: 'graph',
        apply: doc => ({...doc, graphs: {...doc.graphs}}),
      });
    });
    act(() => services?.stepHistory('undo'));
    const toast = toastQueue
      .visible()
      .find(t => t.message === 'Undid: Add node Toon Ramp');
    expect(toast).toBeDefined();
    expect(toast?.tone).toBe('info');
  });

  describe('open project file from home (REQ-UX-028)', () => {
    const upload = async (text: string) => {
      await screen.findByTestId('home-open-file');
      const input = document.querySelector('input[type="file"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('no input');
      const file = new File([text], 'p.sprite-project.json', {
        type: 'application/json',
      });
      fireEvent.change(input, {target: {files: [file]}});
    };

    it('AC-UX-028.2: a malformed project file shows UX_PROJECT_INVALID with the first schema path and changes no stored project', async () => {
      const {services: s} = await boot({seeded: ['a']});
      const before = await s.repo()?.list();
      const bad = JSON.parse(canonicalProjectJson(sampleDoc())) as {
        character: Record<string, unknown>;
      };
      bad.character['name'] = 42;
      await upload(JSON.stringify(bad));
      await waitFor(() =>
        expect(
          toastQueue.visible().some(t => t.code === 'UX_PROJECT_INVALID'),
        ).toBe(true),
      );
      const toast = toastQueue
        .visible()
        .find(t => t.code === 'UX_PROJECT_INVALID');
      expect(toast?.message).toContain('character');
      expect(await s.repo()?.list()).toEqual(before);
      expect(window.location.hash).toBe('#home');
      // Not JSON at all: the same code, still nothing stored.
      for (const t of toastQueue.visible()) toastQueue.dismiss(t.id);
      await upload('{not json');
      await waitFor(() =>
        expect(
          toastQueue.visible().some(t => t.code === 'UX_PROJECT_INVALID'),
        ).toBe(true),
      );
      expect(await s.repo()?.list()).toEqual(before);
    });

    it('AC-UX-028.1: a downloaded project file opens in a fresh profile as a project deep-equal to the original', async () => {
      const {services: s} = await boot();
      const original = sampleDoc('Round trip');
      await upload(canonicalProjectJson(original));
      await waitFor(() => expect(window.location.hash).toMatch(/^#p=/));
      const id = window.location.hash.slice('#p='.length);
      const got = await s.repo()?.get(id);
      expect(got?.ok && got.value.doc).toEqual(original);
    });
  });

  describe('diagnostics (REQ-UX-042)', () => {
    it('AC-UX-042.1: a webgl2 renderer report makes the badge read "WebGL2" and diagnostics show backend webgl2 and three r186 (shell part; the forceWebGL launch is covered end to end)', async () => {
      const user = userEvent.setup();
      const {services: s} = await boot();
      act(() => s.diagnostics.reportRenderer({backend: 'webgl2'}));
      const badge = await screen.findByRole('button', {name: /WebGL2/});
      expect(badge.textContent).toContain('WebGL2');
      expect(badge.getAttribute('data-backend')).toBe('webgl2');
      await user.click(badge);
      const dialog = await screen.findByRole('dialog', {name: 'Diagnostics'});
      expect(dialog.textContent).toContain('Renderer: WebGL2');
      expect(dialog.textContent).toContain('three.js: r186');
    });

    it('AC-UX-042.2: "Copy report" copies a plain-text report with no project content and makes no network request', async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.fn(() => Promise.reject(new Error('network')));
      vi.stubGlobal('fetch', fetchSpy);
      const {services: s} = await boot({seeded: ['a'], hash: '#p=a'});
      await screen.findByRole('textbox', {name: 'Project name'});
      act(() => {
        s.diagnostics.reportRenderer({backend: 'webgl2'});
        s.diagnostics.recordError('UX_SAVE_FAILED');
      });
      const copied: string[] = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => (copied.push(text), Promise.resolve()),
        },
      });
      await user.click(await screen.findByRole('button', {name: /WebGL2/}));
      await user.click(
        await screen.findByRole('button', {name: 'Copy report'}),
      );
      await waitFor(() => expect(copied).toHaveLength(1));
      const report = copied[0] ?? '';
      expect(report).toContain('Renderer: WebGL2');
      expect(report).toContain('Last error codes: UX_SAVE_FAILED');
      // No project content: neither the project name nor the character appear.
      expect(report).not.toContain('Hero a');
      expect(report).not.toContain('{');
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  it('AC-UX-029.1: a project locked by another tab is read-only with a takeover banner; taking over frees editing and makes the other tab read-only', async () => {
    const user = userEvent.setup();
    const channelFactory = hub();
    const other = createTabLock({
      tabId: 'other-tab',
      channelFactory,
      wait: () => new Promise(r => setTimeout(r, 0)),
    });
    await other.claim('a');
    await boot({seeded: ['a'], hash: '#p=a', channelFactory});
    const banner = await screen.findByTestId('tab-lock-banner');
    expect(banner.textContent).toMatch(/Open in another tab/);
    expect(services?.store.getState().readOnly).toBe(true);
    await user.click(screen.getByRole('button', {name: 'Take over editing'}));
    await waitFor(() =>
      expect(screen.queryByTestId('tab-lock-banner')).toBeNull(),
    );
    expect(services?.store.getState().readOnly).toBe(false);
    await waitFor(() => expect(other.state()).toBe('read-only'));
    other.dispose();
  });

  it('AC-UX-043.1: a crash in a region shows the panel fallback and Reload panel restores it', async () => {
    const user = userEvent.setup();
    await boot();
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEST_CRASH_EVENT, {
          detail: {scope: 'region', name: 'Content'},
        }),
      );
    });
    const fallback = await screen.findByTestId('region-fallback');
    expect(fallback.textContent).toMatch(/This panel stopped working/);
    expect(fallback.textContent).toMatch(/UX_PANEL_CRASHED/);
    expect(fallback.textContent).not.toMatch(/at .*\.tsx/);
    // The shell around it keeps working.
    expect(screen.getByRole('banner')).toBeTruthy();
    await user.click(screen.getByRole('button', {name: 'Reload panel'}));
    await waitFor(() =>
      expect(screen.queryByTestId('region-fallback')).toBeNull(),
    );
  });

  it('AC-UX-044.1: a crash that escapes every region shows the full-window fallback with a project backup', async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(b => {
      created.push(b as Blob);
      return 'blob:test';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    await boot({seeded: ['a'], hash: '#p=a'});
    await screen.findByRole('textbox', {name: 'Project name'});
    act(() => {
      window.dispatchEvent(
        new CustomEvent(TEST_CRASH_EVENT, {detail: {scope: 'root'}}),
      );
    });
    expect(await screen.findByTestId('root-fallback')).toBeTruthy();
    await user.click(
      screen.getByRole('button', {name: 'Download project backup'}),
    );
    await waitFor(() => expect(created).toHaveLength(1));
    const json = JSON.parse(await created[0]!.text());
    expect(json.format).toBe('sprite-project');
    expect(json.character.name).toBe('Hero a');
    vi.restoreAllMocks();
  });

  describe('restore prompt', () => {
    async function unclean(extra: {inProgress?: boolean; hash?: string} = {}) {
      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({format: 'sprite-session', version: 1, projectId: 'a'}),
      );
      if (extra.inProgress) {
        window.localStorage.setItem(
          RECOVERY_KEY,
          JSON.stringify({
            format: 'sprite-recovery',
            version: 1,
            restoreInProgress: {projectId: 'a'},
          }),
        );
      }
      return boot({seeded: ['a'], hash: extra.hash ?? '/'});
    }

    it('AC-UX-045.1 / AC-UX-045.2: the prompt names the project, loads nothing until answered, Restore opens the autosave', async () => {
      const user = userEvent.setup();
      await unclean();
      const dialog = await screen.findByRole('alertdialog', {
        name: 'Restore your last session?',
      });
      expect(dialog.textContent).toMatch(/Hero a/);
      expect(services?.store.getState().doc).toBeNull();
      expect(document.querySelector('.preview-stage')).toBeNull();
      await user.click(within(dialog).getByRole('button', {name: 'Restore'}));
      await waitFor(() => expect(window.location.hash).toBe('#p=a'));
      expect(services?.store.getState().doc?.character.name).toBe('Hero a');
      expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    });

    it('AC-UX-045.4: after an interrupted restore "Start without restoring" is the default-focused action', async () => {
      await unclean({inProgress: true});
      const skip = await screen.findByRole('button', {
        name: 'Start without restoring',
      });
      await waitFor(() => expect(document.activeElement).toBe(skip));
    });

    it('AC-UX-086.1: an unclean start on #p=<id> shows the dialog over home; skipping shows home with #home', async () => {
      const user = userEvent.setup();
      await unclean({hash: '#p=a'});
      const dialog = await screen.findByRole('alertdialog');
      expect(services?.store.getState().doc).toBeNull();
      await user.click(
        within(dialog).getByRole('button', {name: 'Start without restoring'}),
      );
      await waitFor(() => expect(window.location.hash).toBe('#home'));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(services?.store.getState().doc).toBeNull();
    });
  });
});
