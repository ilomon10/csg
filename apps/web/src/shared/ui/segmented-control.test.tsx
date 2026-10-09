// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {SegmentedControl} from './segmented-control';
import {axeViolations, focused} from './test-utils';

afterEach(cleanup);

const segments = [
  {id: 'easy', label: 'Easy'},
  {id: 'pro', label: 'Pro'},
];

function Seg({mode}: {mode: 'radio' | 'pressed'}) {
  const [v, setV] = useState('easy');
  return (
    <SegmentedControl
      mode={mode}
      label="Workspace"
      segments={segments}
      value={v}
      onChange={setV}
    />
  );
}

describe('SegmentedControl', () => {
  it('AC-UX-036.2: radio mode is a radiogroup with one tab stop; arrows move and check', async () => {
    const user = userEvent.setup();
    render(<Seg mode="radio" />);
    expect(screen.getByRole('radiogroup', {name: 'Workspace'})).toBeTruthy();
    expect(screen.getByRole('radio', {name: 'Pro'}).tabIndex).toBe(-1);
    screen.getByRole('radio', {name: 'Easy'}).focus();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe(screen.getByRole('radio', {name: 'Pro'}));
    expect(
      screen.getByRole('radio', {name: 'Pro'}).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('AC-UX-036.2: pressed mode uses aria-pressed buttons that are each tab stops', async () => {
    const user = userEvent.setup();
    render(<Seg mode="pressed" />);
    const pro = screen.getByRole('button', {name: 'Pro'});
    expect(
      screen.getByRole('button', {name: 'Easy'}).getAttribute('aria-pressed'),
    ).toBe('true');
    await user.tab();
    await user.tab();
    expect(focused()).toBe(pro);
    await user.keyboard(' ');
    expect(pro.getAttribute('aria-pressed')).toBe('true');
  });

  for (const mode of ['radio', 'pressed'] as const) {
    it(`AC-UX-036.1: ${mode} mode has no axe violations`, async () => {
      const {container} = render(<Seg mode={mode} />);
      expect(await axeViolations(container)).toEqual([]);
    });
  }
});
