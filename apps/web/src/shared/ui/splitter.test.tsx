// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {Splitter} from './splitter';
import {axeViolations} from './test-utils';

afterEach(cleanup);

function Library({direction = 1 as 1 | -1}) {
  const [w, setW] = useState(280);
  return (
    <Splitter
      orientation="vertical"
      label="Resize library"
      value={w}
      min={200}
      max={480}
      direction={direction}
      onChange={setW}
    />
  );
}

describe('Splitter', () => {
  it('AC-UX-002.1: Right pressed 3 times gives 328 and aria-valuenow 328', async () => {
    const user = userEvent.setup();
    render(<Library />);
    const sep = screen.getByRole('separator', {name: 'Resize library'});
    sep.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(sep.getAttribute('aria-valuenow')).toBe('328');
    expect(sep.getAttribute('aria-valuemin')).toBe('200');
    expect(sep.getAttribute('aria-valuemax')).toBe('480');
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('AC-UX-002.1: Home and End go to min and max and values clamp', async () => {
    const user = userEvent.setup();
    render(<Library />);
    const sep = screen.getByRole('separator');
    sep.focus();
    await user.keyboard('{Home}');
    expect(sep.getAttribute('aria-valuenow')).toBe('200');
    await user.keyboard('{ArrowLeft}');
    expect(sep.getAttribute('aria-valuenow')).toBe('200');
    await user.keyboard('{End}');
    expect(sep.getAttribute('aria-valuenow')).toBe('480');
  });

  it('AC-UX-002.1: a panel after the bar (direction -1) grows when the bar moves left', async () => {
    const user = userEvent.setup();
    render(<Library direction={-1} />);
    const sep = screen.getByRole('separator');
    sep.focus();
    await user.keyboard('{ArrowLeft}');
    expect(sep.getAttribute('aria-valuenow')).toBe('296');
  });

  it('AC-UX-040.1: pointer drag resizes as well', () => {
    render(<Library />);
    const sep = screen.getByRole('separator');
    fireEvent.pointerDown(sep, {clientX: 100, pointerId: 1});
    fireEvent.pointerMove(sep, {clientX: 150, pointerId: 1});
    fireEvent.pointerUp(sep, {pointerId: 1});
    expect(sep.getAttribute('aria-valuenow')).toBe('330');
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const {container} = render(<Library />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
