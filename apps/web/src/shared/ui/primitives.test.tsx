// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {Announcer, announce, resetAnnouncer} from './announcer';
import {Button, IconButton} from './button';
import {Icon} from './icon';
import {axeViolations} from './test-utils';
import {VisuallyHidden} from './visually-hidden';

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

describe('Announcer', () => {
  it('AC-UX-061.2: announces politely and re-announces identical text', () => {
    render(<Announcer />);
    act(() => announce('Selected: Ponytail'));
    const status = screen.getByRole('status');
    expect(status.textContent?.trim()).toBe('Selected: Ponytail');
    const first = status.textContent;
    act(() => announce('Selected: Ponytail'));
    expect(status.textContent).not.toBe(first);
    expect(status.textContent?.trim()).toBe('Selected: Ponytail');
  });
  it('AC-UX-032.1: assertive messages go to the alert region', () => {
    render(<Announcer />);
    act(() => announce('Export failed', 'assertive'));
    expect(screen.getByRole('alert').textContent?.trim()).toBe('Export failed');
  });
});

describe('Button and Icon', () => {
  it('AC-UX-036.1: icon buttons carry aria-label, icons are decorative, no axe violations', async () => {
    const {container} = render(
      <div>
        <Button variant="primary">Play</Button>
        <Button variant="ghost" icon="plus">
          New
        </Button>
        <Button variant="danger" disabled>
          Delete
        </Button>
        <IconButton icon="undo" label="Undo" />
        <Icon name="check" label="Done" />
        <VisuallyHidden>hidden text</VisuallyHidden>
      </div>,
    );
    expect(
      screen.getByRole('button', {name: 'Undo'}).getAttribute('title'),
    ).toBe('Undo');
    expect(
      screen
        .getByRole('button', {name: 'New'})
        .querySelector('svg')
        ?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      screen.getByRole('button', {name: 'Play'}).getAttribute('type'),
    ).toBe('button');
    expect(await axeViolations(container)).toEqual([]);
  });
});
