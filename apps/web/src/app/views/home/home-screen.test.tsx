// @vitest-environment jsdom
import {act, cleanup, render, screen, within} from '@testing-library/react';
import {useState} from 'react';
import userEvent from '@testing-library/user-event';
import {beforeAll, afterEach, describe, expect, it, vi} from 'vitest';
import {HomeScreen} from './home-screen';
import type {HomeItemActions, HomeScreenProps} from './home-screen';
import type {HomeItem} from './lineup-model';
import {warmViews} from '../../shell/warm-views';

afterEach(cleanup);

const saved = (id: string, name: string, at: number): HomeItem => ({
  id,
  kind: 'saved',
  name,
  editedAt: at,
  pinned: false,
});
const preset = (id: string, name: string): HomeItem => ({
  id: `preset:${id}`,
  kind: 'preset',
  name,
  editedAt: null,
  pinned: false,
});

function actions(): HomeItemActions {
  return {
    open: vi.fn(),
    duplicate: vi.fn(),
    rename: vi.fn(),
    exportProject: vi.fn(),
    togglePin: vi.fn(),
    remove: vi.fn(),
  };
}

function Harness(props: Partial<HomeScreenProps> & {items: HomeItem[]}) {
  const [id, setId] = useState<string | null>(props.selectedId ?? null);
  return (
    <HomeScreen
      savedLoaded
      catalogReady
      frames={null}
      reducedMotion={false}
      autoFocusNew
      locale="en-US"
      onPrimary={vi.fn()}
      onNew={vi.fn()}
      onRandom={vi.fn()}
      onOpenFile={vi.fn()}
      actions={actions()}
      {...props}
      selectedId={id}
      onSelect={setId}
    />
  );
}
const THREE = [
  saved('a', 'Ann', Date.UTC(2026, 0, 5)),
  saved('b', 'Bob', 0),
  preset('p', 'Ranger'),
];

beforeAll(async () => {
  await warmViews();
}, 60_000);

describe('HomeScreen', () => {
  it('AC-UX-071.1: shows lineup, details with the edit date, strip, New tile and primary action', () => {
    render(<Harness items={THREE} />);
    expect(screen.getByTestId('home-lineup')).toBeTruthy();
    expect(screen.getByTestId('home-details').textContent).toContain('Ann');
    expect(screen.getByTestId('home-details').textContent).toContain(
      'Jan 5, 2026',
    );
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByTestId('home-new')).toBeTruthy();
    expect(screen.getByTestId('home-primary').textContent).toBe('Edit');
    expect(
      screen.getByRole('button', {name: /More actions for Ann/}),
    ).toBeTruthy();
  });

  it('AC-UX-075.1 / AC-UX-074.1: arrows move selection and focus; names carry the position', async () => {
    const user = userEvent.setup();
    render(<Harness items={THREE} />);
    const options = screen.getAllByRole('option');
    expect(options[0]?.getAttribute('aria-label')).toBe('Ann, 1 of 3, saved');
    expect(options[2]?.getAttribute('aria-label')).toBe(
      'Ranger, 3 of 3, preset',
    );
    options[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getAllByRole('option')[1]?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(document.activeElement).toBe(screen.getAllByRole('option')[1]);
    await user.keyboard('{End}');
    expect(
      screen.getAllByRole('option')[2]?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getByTestId('home-primary').textContent).toBe(
      'Start from this preset',
    );
    await user.keyboard('{Home}');
    expect(
      screen.getAllByRole('option')[0]?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('AC-UX-075.1: Enter runs the primary action', async () => {
    const user = userEvent.setup();
    const onPrimary = vi.fn();
    render(<Harness items={THREE} onPrimary={onPrimary} />);
    screen.getAllByRole('option')[0]?.focus();
    await user.keyboard('{Enter}');
    expect(onPrimary).toHaveBeenCalledWith(expect.objectContaining({id: 'a'}));
  });

  it('AC-UX-079.1: no menu button for a preset', () => {
    render(<Harness items={THREE} selectedId="preset:p" />);
    expect(screen.queryByRole('button', {name: /More actions/})).toBeNull();
  });

  it('AC-UX-079.2: Delete asks first, defaults to Cancel, and Cancel removes nothing', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<Harness items={THREE} actions={a} />);
    await user.click(screen.getByRole('button', {name: /More actions/}));
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));
    const dialog = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', {name: 'Cancel'}),
    );
    await user.click(within(dialog).getByRole('button', {name: 'Cancel'}));
    expect(a.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', {name: /More actions/}));
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    expect(a.remove).toHaveBeenCalledWith(expect.objectContaining({id: 'a'}));
  });

  it('AC-UX-076.1: the New tile is a button that creates', async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    render(<Harness items={THREE} onNew={onNew} />);
    screen.getByTestId('home-new').focus();
    await user.keyboard('{Enter}');
    expect(onNew).toHaveBeenCalled();
  });

  it('AC-UX-085.1: with no saved characters the empty text shows and New is focused', () => {
    render(<Harness items={[preset('p', 'Ranger')]} />);
    expect(screen.getByTestId('home-empty').textContent).toBe(
      'No saved characters yet. Create one or start from a preset.',
    );
    expect(document.activeElement).toBe(screen.getByTestId('home-new'));
  });

  it('AC-UX-081.1 / AC-UX-075.3: without frames every position shows a skeleton and nothing animates', () => {
    render(<Harness items={THREE} />);
    expect(
      document.querySelectorAll('[data-testid="home-lineup"] .home-skeleton')
        .length,
    ).toBe(2); // no layout in jsdom: the selected slot and one neighbour
    expect(document.querySelectorAll('canvas').length).toBe(0);
  });

  it('AC-UX-074.1: clicking a lineup character selects it in the strip', async () => {
    const user = userEvent.setup();
    render(<Harness items={THREE} />);
    const slot = document.querySelector(
      '[data-id="b"].home-slot',
    ) as HTMLElement;
    await act(async () => {
      await user.click(slot);
    });
    expect(
      screen.getAllByRole('option')[1]?.getAttribute('aria-selected'),
    ).toBe('true');
  });
});
