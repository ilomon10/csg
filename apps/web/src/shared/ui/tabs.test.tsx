// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {Tabs} from './tabs';
import {axeViolations, focused} from './test-utils';

afterEach(cleanup);

const tabs = ['Parts', 'Colors', 'Anatomy', 'Render', 'Animation'].map(l => ({
  id: l.toLowerCase(),
  label: l,
}));

function Inspector() {
  const [v, setV] = useState('parts');
  return (
    <Tabs label="Inspector" tabs={tabs} value={v} onChange={setV}>
      {id => <p>{id} panel</p>}
    </Tabs>
  );
}

describe('Tabs', () => {
  it('AC-UX-004.1: arrows activate automatically; Anatomy panel shows after two presses', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    screen.getByRole('tab', {name: 'Parts'}).focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    const anatomy = screen.getByRole('tab', {name: 'Anatomy'});
    expect(focused()).toBe(anatomy);
    expect(anatomy.getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toBe('anatomy panel');
    expect(panel.getAttribute('aria-labelledby')).toBe(anatomy.id);
  });

  it('AC-UX-004.1: only the selected tab is a tab stop and Tab enters the panel; Home/End jump', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    expect(
      screen.getAllByRole('tab').filter(t => t.tabIndex === 0),
    ).toHaveLength(1);
    screen.getByRole('tab', {name: 'Parts'}).focus();
    await user.keyboard('{End}');
    expect(
      screen
        .getByRole('tab', {name: 'Animation'})
        .getAttribute('aria-selected'),
    ).toBe('true');
    await user.keyboard('{Home}');
    expect(
      screen.getByRole('tab', {name: 'Parts'}).getAttribute('aria-selected'),
    ).toBe('true');
    await user.tab();
    expect(focused()).toBe(screen.getByRole('tabpanel'));
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(<Inspector />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
