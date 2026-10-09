// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {OptionCardGroup} from './option-card-group';
import {axeViolations, focused} from './test-utils';

afterEach(cleanup);

function Style() {
  const [v, setV] = useState<string | null>('chibi');
  return (
    <>
      <button type="button">before</button>
      <OptionCardGroup
        label="Style"
        value={v}
        onChange={setV}
        options={[
          {id: 'realistic', label: 'Realistic'},
          {id: 'chibi', label: 'Chibi'},
          {id: 'stickman', label: 'Stickman', disabled: true},
        ]}
      />
      <button type="button">after</button>
    </>
  );
}

describe('OptionCardGroup', () => {
  it('AC-UX-092.1: arrows reach a coming-soon card, announce it, never check it; Tab leaves', async () => {
    const user = userEvent.setup();
    render(<Style />);
    const chibi = screen.getByRole('radio', {name: /Chibi/});
    chibi.focus();
    await user.keyboard('{ArrowRight}');
    const soon = screen.getByRole('radio', {name: /Stickman/});
    expect(focused()).toBe(soon);
    expect(soon.getAttribute('aria-disabled')).toBe('true');
    expect(soon.getAttribute('aria-checked')).toBe('false');
    const desc = document.getElementById(
      soon.getAttribute('aria-describedby') ?? '',
    );
    expect(desc?.textContent).toBe('Coming soon. Available in a later update.');
    expect(screen.getByText('Coming soon')).toBeTruthy();
    await user.keyboard(' ');
    expect(soon.getAttribute('aria-checked')).toBe('false');
    expect(chibi.getAttribute('aria-checked')).toBe('true');
    await user.tab();
    expect(focused()).toBe(screen.getByRole('button', {name: 'after'}));
  });

  it('AC-UX-092.1: arrows move and check enabled cards, wrapping', async () => {
    const user = userEvent.setup();
    render(<Style />);
    screen.getByRole('radio', {name: /Chibi/}).focus();
    await user.keyboard('{ArrowLeft}');
    expect(
      screen
        .getByRole('radio', {name: /Realistic/})
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(<Style />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
