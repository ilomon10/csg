// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
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
import {characterSpecSchema} from '@csg/parts-schema';
import type {Catalog} from '../../../shared/catalog';
import {
  createProjectRepository,
  openCsgDatabase,
} from '../../../shared/persistence';
import {resetAnnouncer} from '../../../shared/ui';
import {createShellServices} from '../../shell/services';
import type {ShellServices} from '../../shell/services';
import {Shell} from '../../shell/shell';
import {loadWizardCatalog} from './wizard-test-support';
import {warmViews} from '../../shell/warm-views';

vi.mock('../../viewport', async () => ({
  CharacterViewport: () => <div data-testid="viewport" />,
  createPreviewSettings: () => ({}),
  createNewProjectDocument: (await import('../../viewport/default-character'))
    .createNewProjectDocument,
}));

let services: ShellServices | null = null;
let idb: IDBFactory;
let catalog: Catalog;

async function open(
  cat: Catalog = catalog,
  hash = '#new',
): Promise<ShellServices> {
  window.history.replaceState(null, '', `/${hash}`);
  services = createShellServices({
    win: window,
    idb,
    loadCatalog: false,
    claimWait: () => new Promise(r => setTimeout(r, 0)),
  });
  services.catalog.set({catalog: cat});
  render(<Shell services={services} />);
  await screen.findByRole('heading', {name: /^Step 1 of 8/});
  return services;
}

const heading = (n: number, title: string) =>
  screen.findByRole('heading', {name: `Step ${n} of 8: ${title}`});

beforeEach(async () => {
  window.localStorage.clear();
  idb = new IDBFactory();
  catalog ??= await loadWizardCatalog();
});
afterEach(() => {
  cleanup();
  services?.dispose();
  services = null;
  resetAnnouncer();
});

beforeAll(async () => {
  await warmViews();
}, 60_000);

describe('wizard view', () => {
  it('AC-UX-089.1 / AC-UX-095.1: shows the heading, the eight titles and moves focus to the heading', async () => {
    await open();
    const h = await heading(1, 'Style');
    expect(document.activeElement).toBe(h);
    const list = screen.getByRole('navigation', {name: 'Wizard progress'});
    expect(list.querySelectorAll('li')).toHaveLength(8);
    expect(screen.queryByRole('button', {name: 'Back'})).toBeNull();
    expect(
      screen.getByRole('button', {name: 'Randomize this step'}),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', {name: 'Next'}));
    expect(document.activeElement).toBe(await heading(2, 'Species'));
    expect(
      screen
        .getByRole('button', {name: /Step 2: Species/})
        .getAttribute('aria-current'),
    ).toBe('step');
  });

  it('AC-UX-092.1 / AC-UX-092.3: Stickman is disabled, reachable by arrows, not selectable', async () => {
    await open();
    const chibi = screen.getByRole('radio', {name: /Chibi/});
    await userEvent.click(chibi);
    expect(chibi.getAttribute('aria-checked')).toBe('true');
    const stick = screen.getByRole('radio', {name: /Stickman/});
    expect(stick.getAttribute('aria-disabled')).toBe('true');
    expect(stick.textContent).toContain('Coming soon');
    chibi.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(stick);
    await userEvent.keyboard(' ');
    expect(stick.getAttribute('aria-checked')).toBe('false');
  });

  it('AC-UX-093.1: the body step shows six body-shape cards and no slider', async () => {
    await open();
    await userEvent.click(
      screen.getByRole('button', {name: /Step 3: Body shape/}),
    );
    await heading(3, 'Body shape');
    const radios = screen.getAllByRole('radio');
    expect(radios.map(r => r.textContent ?? '').slice(0, 6)).toEqual(
      ['Average', 'Slim', 'Athletic', 'Stocky', 'Tall', 'Petite'].map(n =>
        expect.stringContaining(n),
      ),
    );
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
  });

  it('AC-UX-095.1: Back keeps the choices', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', {name: /Step 5: Hair/}));
    await heading(5, 'Hair');
    const tiles = screen.getAllByRole('option');
    const pick = tiles.find(t => t.getAttribute('aria-selected') !== 'true')!;
    await userEvent.click(pick);
    const label = pick.textContent;
    await userEvent.click(screen.getByRole('button', {name: 'Back'}));
    await userEvent.click(screen.getByRole('button', {name: 'Back'}));
    await userEvent.click(screen.getByRole('button', {name: 'Next'}));
    await userEvent.click(screen.getByRole('button', {name: 'Next'}));
    await heading(5, 'Hair');
    const again = screen
      .getAllByRole('option')
      .find(t => t.textContent === label)!;
    expect(again.getAttribute('aria-selected')).toBe('true');
  });

  it('AC-UX-095.2: Skip resets the step and focuses the next heading', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', {name: /Step 5: Hair/}));
    await heading(5, 'Hair');
    const before = screen
      .getAllByRole('option')
      .find(t => t.getAttribute('aria-selected') === 'true')?.textContent;
    const other = screen
      .getAllByRole('option')
      .find(t => t.getAttribute('aria-selected') !== 'true')!;
    await userEvent.click(other);
    await userEvent.click(screen.getByRole('button', {name: 'Skip'}));
    expect(document.activeElement).toBe(await heading(6, 'Outfit'));
    await userEvent.click(screen.getByRole('button', {name: 'Back'}));
    await heading(5, 'Hair');
    const after = screen
      .getAllByRole('option')
      .find(t => t.getAttribute('aria-selected') === 'true')?.textContent;
    expect(after).toBe(before);
  });

  it('AC-UX-096.2: Randomize on the style step keeps an enabled style', async () => {
    let n = 0;
    await open();
    for (let i = 0; i < 10; i++) {
      await userEvent.click(
        screen.getByRole('button', {name: 'Randomize this step'}),
      );
      n++;
      const checked = screen
        .getAllByRole('radio')
        .find(r => r.getAttribute('aria-checked') === 'true')!;
      expect(checked.textContent).toMatch(/Realistic|Chibi/);
    }
    expect(n).toBe(10);
  });

  it('AC-UX-098.1: Escape on an unchanged draft goes home without a dialog', async () => {
    const s = await open();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(s.router.current().view).toBe('home'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('AC-UX-098.2: Escape asks to discard; Keep editing stays, Discard goes home', async () => {
    const s = await open();
    await userEvent.click(screen.getByRole('radio', {name: /Chibi/}));
    await userEvent.keyboard('{Escape}');
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Discard this character?',
    });
    expect(screen.getByRole('button', {name: 'Keep editing'}));
    await userEvent.click(screen.getByRole('button', {name: 'Keep editing'}));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(s.router.current().view).toBe('wizard');
    expect(
      screen.getByRole('radio', {name: /Chibi/}).getAttribute('aria-checked'),
    ).toBe('true');
    expect(dialog).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', {name: 'Discard'}));
    await waitFor(() => expect(s.router.current().view).toBe('home'));
    const opened = await openCsgDatabase(idb);
    if (!opened.ok) throw new Error('db');
    expect(
      await createProjectRepository({database: opened.value}).list(),
    ).toHaveLength(0);
  });

  it('AC-UX-098.2: a hand-edited fragment with changes keeps the wizard, restores #new and asks', async () => {
    const s = await open();
    await userEvent.click(screen.getByRole('radio', {name: /Chibi/}));
    act(() => {
      window.location.hash = '#home';
    });
    await screen.findByRole('alertdialog');
    expect(s.router.current().view).toBe('wizard');
    await waitFor(() => expect(window.location.hash).toBe('#new'));
  });

  it('AC-UX-099.1 / AC-UX-090.1 / AC-UX-100.1: Finish saves a trimmed-name project and opens it with no history', async () => {
    const s = await open();
    await userEvent.click(screen.getByRole('radio', {name: /Chibi/}));
    await userEvent.click(
      screen.getByRole('button', {name: /Step 8: Name and finish/}),
    );
    await heading(8, 'Name and finish');
    expect(screen.queryByText(/minecraft/i)).toBeNull();
    expect(screen.queryByRole('button', {name: 'Skip'})).toBeNull();
    await userEvent.type(screen.getByLabelText('Name'), '  Mira  ');
    const t0 = Date.now();
    await userEvent.click(screen.getByRole('button', {name: 'Finish'}));
    await waitFor(() => expect(s.router.current().view).toBe('project'));
    expect(Date.now() - t0).toBeLessThan(500);
    const opened = await openCsgDatabase(idb);
    if (!opened.ok) throw new Error('db');
    const list = await createProjectRepository({database: opened.value}).list();
    expect(list.map(m => m.name)).toEqual(['Mira']);
    const rec = await createProjectRepository({database: opened.value}).get(
      list[0]!.projectId,
    );
    if (!rec.ok) throw new Error('get');
    expect(rec.value.doc.character.style).toBe('chibi');
    // A new project exports idle then walk (spec 001 default clips, REQ-ANM-004).
    expect(rec.value.doc.render.animations.map(a => a.clipId)).toEqual([
      'builtin:quaternius-ual/idle',
      'builtin:quaternius-ual/walk',
    ]);
    expect(characterSpecSchema.safeParse(rec.value.doc.character).success).toBe(
      true,
    );
    await waitFor(() =>
      expect(s.store.getState().projectId).toBe(list[0]!.projectId),
    );
    expect(s.store.getState().undo).toBeNull();
    expect(window.location.hash).toBe(`#p=${list[0]!.projectId}`);
  });

  it('AC-UX-091.1: choosing Human on the Species step stores species "human" in the draft and the saved spec', async () => {
    const s = await open();
    await userEvent.click(
      screen.getByRole('button', {name: /Step 2: Species/}),
    );
    await heading(2, 'Species');
    const human = screen.getByRole('radio', {name: /Human/});
    await userEvent.click(human);
    expect(human.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(
      screen.getByRole('button', {name: /Step 8: Name and finish/}),
    );
    await heading(8, 'Name and finish');
    await userEvent.click(screen.getByRole('button', {name: 'Finish'}));
    await waitFor(() => expect(s.router.current().view).toBe('project'));
    const opened = await openCsgDatabase(idb);
    if (!opened.ok) throw new Error('db');
    const repo = createProjectRepository({database: opened.value});
    const [first] = await repo.list();
    const rec = await repo.get(first?.projectId ?? '');
    expect(rec.ok && rec.value.doc.character.species).toBe('human');
  });

  it('AC-UX-092.2: a fixture pack plus a supported pair enables Stickman', async () => {
    const base = '/packs/quaternius-ubc/presets';
    const {readFile} = await import('node:fs/promises');
    const {resolve} = await import('node:path');
    const index = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          '../../../../../../assets/packs/quaternius-ubc/presets/index.json',
        ),
        'utf8',
      ),
    ) as {files: Array<{kind: string; path: string}>};
    index.files.push({kind: 'style', path: 'presets/styles/stickman.json'});
    const cat = await loadWizardCatalog(
      [
        ['realistic', 'human'],
        ['chibi', 'human'],
        ['stickman', 'human'],
      ],
      {
        [`${base}/index.json`]: JSON.stringify(index),
        [`${base}/styles/stickman.json`]: JSON.stringify({
          format: 'sprite-style',
          version: 1,
          style: 'stickman',
          excludedClips: [],
        }),
      },
    );
    await open(cat);
    expect(
      screen
        .getByRole('radio', {name: /Stickman/})
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });
});
