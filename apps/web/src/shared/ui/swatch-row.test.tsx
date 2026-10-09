// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {SwatchRow} from './swatch-row';
import {axeViolations} from './test-utils';

afterEach(cleanup);

const swatches = [
  {id: 'chestnut', name: 'Chestnut brown', color: '#6b3f27'},
  {id: 'auburn', name: 'Auburn', color: '#8c3b1f'},
  {id: 'black', name: 'Black', color: '#111111'},
];

function Row({onPick}: {onPick?: (id: string) => void}) {
  const [v, setV] = useState<string | null>('chestnut');
  return (
    <SwatchRow
      label="Color: Ponytail"
      swatches={swatches}
      value={v}
      onChange={id => {
        setV(id);
        onPick?.(id);
      }}
    />
  );
}

describe('SwatchRow', () => {
  it('AC-UX-062.1: arrow checks the next swatch, which has a spoken name and a check mark', async () => {
    const user = userEvent.setup();
    const picked: string[] = [];
    render(<Row onPick={id => picked.push(id)} />);
    screen.getByRole('radio', {name: 'Chestnut brown'}).focus();
    await user.keyboard('{ArrowRight}');
    const auburn = screen.getByRole('radio', {name: 'Auburn'});
    expect(auburn.getAttribute('aria-checked')).toBe('true');
    expect(auburn.querySelector('svg')).not.toBeNull();
    expect(
      screen.getByRole('radio', {name: 'Chestnut brown'}).querySelector('svg'),
    ).toBeNull();
    expect(picked).toEqual(['auburn']);
  });

  it('AC-UX-062.2: each keyboard step is one onChange so the caller can coalesce bursts', async () => {
    const user = userEvent.setup();
    const picked: string[] = [];
    render(<Row onPick={id => picked.push(id)} />);
    screen.getByRole('radio', {name: 'Chestnut brown'}).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(picked).toEqual(['auburn', 'black', 'chestnut']);
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(<Row />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
