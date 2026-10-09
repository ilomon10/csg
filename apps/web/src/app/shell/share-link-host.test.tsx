// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {createDefaultCharacterSpec} from '@csg/parts-schema';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {IDBFactory} from 'fake-indexeddb';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type * as ShareModuleType from '../../shared/share';
import {toastQueue} from '../../shared/ui';
import {clearCrash} from './crash-hooks';
import {createShellServices} from './services';
import type {ShellServices} from './services';
import {Shell} from './shell';
import {warmViews} from './warm-views';

type ShareModule = typeof ShareModuleType;
const shared = {...createDefaultCharacterSpec(), name: 'Shared Hero'};

// jsdom has no Blob.stream(); the real codec round-trip is covered by share-codec.test.ts and
// the share-link e2e. Only the valid payload is stubbed, errors go through the real decoder.
vi.mock('../../shared/share', async importOriginal => {
  const real = await importOriginal<ShareModule>();
  return {
    ...real,
    decodeShareFragment: async (payload: string, limits?: never) =>
      payload === 'VALIDSHARE'
        ? {ok: true as const, value: shared}
        : real.decodeShareFragment(payload, limits),
  };
});

let services: ShellServices | null = null;

async function boot(hash: string): Promise<ShellServices> {
  window.history.replaceState(null, '', hash);
  const s = createShellServices({
    win: window,
    idb: new IDBFactory(),
    loadCatalog: false,
    claimWait: () => new Promise(r => setTimeout(r, 0)),
  });
  services = s;
  render(<Shell services={s} />);
  await waitFor(() => expect(s.state.get().phase).toBe('ready'));
  return s;
}

beforeAll(async () => {
  await warmViews();
}, 60_000);
beforeEach(() => {
  window.localStorage.clear();
  for (const t of toastQueue.visible()) toastQueue.dismiss(t.id);
});
afterEach(() => {
  cleanup();
  clearCrash('root');
  clearCrash('region');
  services?.dispose();
  services = null;
});

describe('share link host', () => {
  it('AC-CMP-035.1: confirming opens the shared character as a NEW project and clears the fragment', async () => {
    const s = await boot('/#c=VALIDSHARE');
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Shared Hero');
    await userEvent.click(
      screen.getByRole('button', {name: 'Open as new project'}),
    );
    await waitFor(() => expect(window.location.hash).toMatch(/^#p=/));
    const id = /^#p=(.+)$/.exec(window.location.hash)?.[1] ?? '';
    const stored = await s.repo()?.get(id);
    expect(stored?.ok && stored.value.doc.character.name).toBe('Shared Hero');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('AC-CMP-035.2: Cancel has the initial focus, creates no project and clears the fragment', async () => {
    const s = await boot('/#c=VALIDSHARE');
    const cancel = await screen.findByRole('button', {name: 'Cancel'});
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await userEvent.click(cancel);
    await waitFor(() => expect(window.location.hash).toBe('#home'));
    expect(await s.repo()?.list()).toEqual([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('AC-CMP-034.4: a payload that is not deflate data shows CMP_SPEC_INVALID and goes home', async () => {
    await boot('/#c=AAAA_bbbb-cccc');
    await waitFor(() =>
      expect(
        toastQueue.visible().some(t => t.code === 'CMP_SPEC_INVALID'),
      ).toBe(true),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.location.hash).not.toMatch(/^#c=/);
  });

  it('AC-CMP-034.1: an oversized payload names the limit and no dialog opens', async () => {
    await boot(`/#c=${'A'.repeat(70_000)}`);
    await waitFor(() =>
      expect(
        toastQueue
          .visible()
          .some(t => t.code === 'CMP_SPEC_INVALID' && /65,536/.test(t.message)),
      ).toBe(true),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(window.location.hash).not.toMatch(/^#c=/);
  });
});
