// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
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
import {
  createDefaultCharacterSpec,
  createProjectDocument,
} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {
  createProjectRepository,
  openCsgDatabase,
} from '../../shared/persistence';
import {resetAnnouncer} from '../../shared/ui';
import {createShellServices} from '../shell/services';
import type {ShellServices} from '../shell/services';
import {Shell} from '../shell/shell';
import {loadWizardCatalog} from '../views/wizard/wizard-test-support';
import {warmViews} from '../shell/warm-views';

vi.mock('../viewport', () => ({
  CharacterViewport: () => <div data-testid="viewport" />,
  createPreviewSettings: () => ({}),
  useBusyRefs: () => new Set<string>(),
  sharedViewportStore: {
    getState: () => ({
      previewClip: 'x',
      playing: false,
      mode: 'pixel',
      direction: 0,
      zoom: 'fit',
    }),
    subscribe: () => () => undefined,
    setPlaying: () => undefined,
    setPreviewClip: () => undefined,
  },
  engineHost: {registry: async () => ({}), lease: async () => ({ok: false})},
}));
vi.mock('../trusted-types', () => ({
  EXPORT_WORKER_URL: 'x',
  createWorkerScriptUrl: (s: string) => s,
}));

let services: ShellServices | null = null;
let catalog: Catalog;

async function openProject(
  workspace: 'easy' | 'pro',
  tint?: string,
): Promise<ShellServices> {
  window.localStorage.setItem(
    'csg.prefs',
    JSON.stringify({format: 'sprite-ui-prefs', version: 2, workspace}),
  );
  const idb = new IDBFactory();
  const opened = await openCsgDatabase(idb);
  if (!opened.ok) throw new Error('db');
  const repo = createProjectRepository({
    database: opened.value,
    estimate: async () => ({}),
  });
  const spec = createDefaultCharacterSpec();
  const doc = createProjectDocument(
    tint ? {...spec, tints: {...spec.tints, hair: tint}} : spec,
  );
  await repo.saveDocument('ws-test', doc);
  window.history.replaceState(null, '', '/#p=ws-test');
  services = createShellServices({
    win: window,
    idb,
    loadCatalog: false,
    claimWait: () => new Promise(r => setTimeout(r, 0)),
  });
  services.catalog.set({catalog});
  render(<Shell services={services} />);
  return services;
}

beforeEach(async () => {
  window.localStorage.clear();
  catalog ??= await loadWizardCatalog();
});
afterEach(() => {
  cleanup();
  services?.dispose();
  services = null;
  resetAnnouncer();
});

vi.setConfig({testTimeout: 30_000});

beforeAll(async () => {
  await warmViews();
}, 60_000);

describe('workspaces', () => {
  it('AC-UX-056.1 / AC-UX-060.1: Easy has the three landmarks and the category tabs; arrows move to Hair', async () => {
    await openProject('easy');
    await screen.findByRole('region', {name: 'Customize'}, {timeout: 20_000});
    expect(screen.getByRole('region', {name: 'Preview'})).toBeTruthy();
    expect(screen.getByRole('region', {name: 'Actions'})).toBeTruthy();
    const tabs = within(screen.getByRole('tablist', {name: 'Categories'}))
      .getAllByRole('tab')
      .map(t => t.textContent);
    expect(tabs).toEqual([
      'Body',
      'Skin',
      'Face',
      'Hair',
      'Outfit',
      'Accessories',
      'Colors',
    ]);
    screen.getByRole('tab', {name: 'Body'}).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(
      screen.getByRole('tab', {name: 'Hair'}).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('AC-UX-063.1 / AC-UX-064.1: no sliders in any Easy tab; undo and redo start disabled', async () => {
    await openProject('easy');
    await screen.findByRole('region', {name: 'Customize'}, {timeout: 20_000});
    for (const name of [
      'Body',
      'Skin',
      'Face',
      'Hair',
      'Outfit',
      'Accessories',
      'Colors',
    ]) {
      await userEvent.click(screen.getByRole('tab', {name}));
      expect(
        document.querySelector(
          '[role=slider],[role=spinbutton],input[type=range],input[type=number],input[type=color]',
        ),
      ).toBeNull();
    }
    const bar = screen.getByRole('region', {name: 'Actions'});
    expect(
      (within(bar).getByRole('button', {name: 'Undo'}) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(bar).getByRole('button', {name: 'Redo'}) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      within(bar).queryByRole('radiogroup', {name: 'Workspace'}),
    ).toBeNull();
  });

  it('AC-UX-055.2: a custom hair tint shows a checked Custom swatch; Edit in Pro opens Colors', async () => {
    await openProject('easy', '#123456');
    await screen.findByRole('region', {name: 'Customize'}, {timeout: 20_000});
    await userEvent.click(screen.getByRole('tab', {name: 'Hair'}));
    expect(
      screen
        .getByRole('radio', {name: /Custom color #123456/})
        .getAttribute('aria-checked'),
    ).toBe('true');
    await userEvent.click(screen.getByRole('button', {name: 'Edit in Pro'}));
    await screen.findByRole(
      'complementary',
      {name: 'Inspector'},
      {timeout: 20_000},
    );
    expect(
      screen.getByRole('tab', {name: 'Colors'}).getAttribute('aria-selected'),
    ).toBe('true');
    await waitFor(() =>
      expect(document.activeElement?.id).toBe('cmp-tint-hair'),
    );
    expect(services?.store.getState().historyLength).toBe(0);
  });

  it('AC-UX-051.3: undoing a hair tint made in Easy, with the Body tab active, returns to Hair and focuses the changed swatch', async () => {
    const user = userEvent.setup();
    await openProject('easy');
    await screen.findByRole('region', {name: 'Customize'}, {timeout: 20_000});
    await user.click(screen.getByRole('tab', {name: 'Hair'}));
    const swatches = screen
      .getAllByRole('radio')
      .filter(r => r.classList.contains('csg-swatch'));
    const target = swatches.find(
      r => r.getAttribute('aria-checked') !== 'true',
    );
    expect(target).toBeDefined();
    await user.click(target as HTMLElement);
    expect(services?.store.getState().historyLength).toBe(1);
    await user.click(screen.getByRole('tab', {name: 'Body'}));
    expect(
      screen.getByRole('tab', {name: 'Body'}).getAttribute('aria-selected'),
    ).toBe('true');
    await user.click(
      within(screen.getByRole('region', {name: 'Actions'})).getByRole(
        'button',
        {
          name: /^Undo/,
        },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('tab', {name: 'Hair'}).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    await waitFor(() => {
      const active = document.activeElement;
      expect(active?.getAttribute('role')).toBe('radio');
      expect(active?.getAttribute('aria-checked')).toBe('true');
      expect(active?.getAttribute('data-focus-key')).toBe('easy.swatch.hair');
    });
  });

  it('AC-UX-001.2 / AC-UX-005.1: Pro lists its landmarks and the graph tabs show the notice', async () => {
    window.innerWidth = 1440;
    await openProject('pro');
    await screen.findByRole(
      'complementary',
      {name: 'Inspector'},
      {timeout: 20_000},
    );
    for (const name of ['Part library', 'Viewport', 'Dock']) {
      expect(screen.getAllByLabelText(name).length).toBeGreaterThan(0);
    }
    await userEvent.click(screen.getByRole('tab', {name: 'Material graph'}));
    expect(screen.getByTestId('graph-notice')).toBeTruthy();
  });

  it('AC-UX-002.1: the library splitter moves 3 steps of 16 px by keyboard', async () => {
    window.innerWidth = 1440;
    await openProject('pro');
    const split = await screen.findByRole('separator', {
      name: 'Resize part library',
    });
    split.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(split.getAttribute('aria-valuenow')).toBe('328');
  });

  it('AC-UX-006.1: at 1100 px the library is a drawer, the inspector stays docked', async () => {
    window.innerWidth = 1100;
    await openProject('pro');
    await screen.findByRole(
      'complementary',
      {name: 'Inspector'},
      {timeout: 20_000},
    );
    expect(
      document.getElementById('pro-library')?.getAttribute('data-drawer'),
    ).toBe('true');
    expect(
      document.getElementById('pro-inspector')?.getAttribute('data-drawer'),
    ).toBe('false');
  });
});
