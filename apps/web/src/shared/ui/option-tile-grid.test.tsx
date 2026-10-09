// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {OptionTileGrid, type OptionTile} from './option-tile-grid';
import {axeViolations, focused} from './test-utils';

afterEach(cleanup);

const hair: OptionTile[] = Array.from({length: 12}, (_, i) => ({
  id: `h${i + 1}`,
  label: i === 5 ? 'Ponytail' : `Hair ${i + 1}`,
}));

function Harness({
  follows = false,
  row = false,
}: {
  follows?: boolean;
  row?: boolean;
}) {
  const [v, setV] = useState<string | null>('h1');
  return (
    <>
      <OptionTileGrid
        label="Hair"
        options={hair}
        value={v}
        onChange={setV}
        columns={row ? undefined : 4}
        selectionFollowsFocus={follows}
        row={row}
      />
      <output data-testid="v">{v}</output>
    </>
  );
}

describe('OptionTileGrid', () => {
  it('AC-UX-061.1: Down then Right moves focus to tile 6 without selecting; one tab stop', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('option', {name: 'Hair 1'}).focus();
    await user.keyboard('{ArrowDown}{ArrowRight}');
    const ponytail = screen.getByRole('option', {name: 'Ponytail'});
    expect(focused()).toBe(ponytail);
    const stops = screen.getAllByRole('option').filter(o => o.tabIndex === 0);
    expect(stops).toEqual([ponytail]);
    expect(screen.getByTestId('v').textContent).toBe('h1');
  });

  it('AC-UX-061.2: Space selects the focused tile and sets aria-selected', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('option', {name: 'Hair 1'}).focus();
    await user.keyboard('{ArrowDown}{ArrowRight} ');
    expect(
      screen
        .getByRole('option', {name: 'Ponytail'})
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.getAllByRole('option', {selected: true})).toHaveLength(1);
  });

  it('AC-UX-061.1: Home and End jump to the first and last tile', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('option', {name: 'Hair 1'}).focus();
    await user.keyboard('{End}');
    expect(focused()).toBe(screen.getByRole('option', {name: 'Hair 12'}));
    await user.keyboard('{Home}');
    expect(focused()).toBe(screen.getByRole('option', {name: 'Hair 1'}));
  });

  it('AC-UX-075.1: with selectionFollowsFocus the arrow selects and Enter activates', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    function Strip() {
      const [v, setV] = useState<string | null>('h3');
      return (
        <OptionTileGrid
          label="Characters"
          row
          selectionFollowsFocus
          options={hair.map((o, i) => ({
            ...o,
            label: `${o.label}, ${i + 1} of 12, saved`,
          }))}
          value={v}
          onChange={setV}
          onActivate={onActivate}
        />
      );
    }
    render(<Strip />);
    screen.getByRole('option', {name: /3 of 12/}).focus();
    await user.keyboard('{ArrowRight}');
    expect(
      screen
        .getByRole('option', {name: 'Hair 4, 4 of 12, saved'})
        .getAttribute('aria-selected'),
    ).toBe('true');
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith('h4');
  });

  it('AC-UX-075.1: optionName builds the accessible name', () => {
    render(
      <OptionTileGrid
        label="Characters"
        options={hair.slice(0, 3)}
        value="h2"
        onChange={() => {}}
        optionName={(o, i, n) => `${o.label}, ${i + 1} of ${n}, saved`}
      />,
    );
    expect(
      screen.getByRole('option', {name: 'Hair 2, 2 of 3, saved'}),
    ).toBeTruthy();
  });

  it('marks busy tiles and exposes disabled tiles', () => {
    render(
      <OptionTileGrid
        label="Hair"
        options={[
          {id: 'a', label: 'A', busy: true},
          {id: 'b', label: 'B', disabled: true},
        ]}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('option', {name: 'A'}).getAttribute('aria-busy'),
    ).toBe('true');
    expect(
      screen.getByRole('option', {name: 'B'}).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(<Harness />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('AC-UX-061.1: a tile description is linked with aria-describedby, not the name', () => {
    render(
      <OptionTileGrid
        label="T"
        value={null}
        onChange={() => undefined}
        options={[{id: 'a', label: 'A', description: 'Needs a taller body'}]}
      />,
    );
    const option = screen.getByRole('option', {name: 'A'});
    expect(option.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      screen.getByRole('option', {description: 'Needs a taller body'}),
    ).toBeTruthy();
  });
});
