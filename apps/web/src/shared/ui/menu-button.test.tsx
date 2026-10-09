// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {MenuButton} from './menu-button';
import {axeViolations, focused} from './test-utils';

afterEach(cleanup);

function Menu({onPick = () => {}}: {onPick?: (id: string) => void}) {
  return (
    <MenuButton
      items={[
        {id: 'all', label: 'Randomize all', onSelect: () => onPick('all')},
        {
          id: 'colors',
          label: 'Randomize colors',
          onSelect: () => onPick('colors'),
        },
        {
          id: 'locked',
          label: 'Reset locks',
          disabled: true,
          separatorBefore: true,
          onSelect: () => onPick('locked'),
        },
      ]}
    >
      Randomize
    </MenuButton>
  );
}

describe('MenuButton', () => {
  it('AC-UX-036.3: Enter opens on the first item, arrows wrap, Escape closes and returns focus', async () => {
    const user = userEvent.setup();
    render(<Menu />);
    const trigger = screen.getByRole('button', {name: 'Randomize'});
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(focused()).toBe(
      screen.getByRole('menuitem', {name: 'Randomize all'}),
    );
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe(screen.getByRole('menuitem', {name: 'Reset locks'}));
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe(
      screen.getByRole('menuitem', {name: 'Randomize all'}),
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it('AC-UX-036.3: Up opens on the last item; Home/End and type-ahead move', async () => {
    const user = userEvent.setup();
    render(<Menu />);
    screen.getByRole('button', {name: 'Randomize'}).focus();
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe(screen.getByRole('menuitem', {name: 'Reset locks'}));
    await user.keyboard('{Home}');
    expect(focused()).toBe(
      screen.getByRole('menuitem', {name: 'Randomize all'}),
    );
    await user.keyboard('{End}');
    expect(focused()).toBe(screen.getByRole('menuitem', {name: 'Reset locks'}));
    await user.keyboard('{Home}');
    await user.keyboard('res');
    expect(focused()).toBe(screen.getByRole('menuitem', {name: 'Reset locks'}));
  });

  it('AC-UX-036.3: Enter activates, closes and returns focus; disabled items do not activate', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Menu onPick={onPick} />);
    const trigger = screen.getByRole('button', {name: 'Randomize'});
    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith('colors');
    expect(focused()).toBe(trigger);
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('AC-UX-036.3: Tab closes the menu', async () => {
    const user = userEvent.setup();
    render(<Menu />);
    screen.getByRole('button', {name: 'Randomize'}).focus();
    await user.keyboard('{Enter}{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('AC-UX-036.1: has no axe violations open', async () => {
    const user = userEvent.setup();
    const {container} = render(<Menu />);
    await user.click(screen.getByRole('button', {name: 'Randomize'}));
    expect(await axeViolations(container)).toEqual([]);
  });
});
