// @vitest-environment jsdom
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useRef, useState} from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {Dialog} from './dialog';
import {axeViolations, focused} from './test-utils';

afterEach(cleanup);

function App({withInitial = false}: {withInitial?: boolean}) {
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Export
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Export sprite sheet"
        initialFocus={withInitial ? cancel : undefined}
        footer={
          <>
            <button type="button" ref={cancel} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button">Export now</button>
          </>
        }
      >
        <label>
          Name <input />
        </label>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('AC-UX-037.1: Escape closes the dialog and focus returns to the Export button', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole('button', {name: 'Export'});
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', {name: 'Export sprite sheet'});
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it('AC-UX-037.1: focus moves in on open, is trapped by Tab and Shift+Tab, and the page is inert', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', {name: 'Export'}));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(focused())).toBe(true);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(focused())).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await user.tab({shift: true});
      expect(dialog.contains(focused())).toBe(true);
    }
    const root = document.body.firstElementChild;
    expect(root?.hasAttribute('inert')).toBe(true);
  });

  it('AC-UX-037.1: initialFocus is honoured and inert is removed on close', async () => {
    const user = userEvent.setup();
    render(<App withInitial />);
    await user.click(screen.getByRole('button', {name: 'Export'}));
    expect(focused()).toBe(screen.getByRole('button', {name: 'Cancel'}));
    await user.click(screen.getByRole('button', {name: 'Cancel'}));
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('AC-UX-037.1: the close button closes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', {name: 'Export'}));
    await user.click(screen.getByRole('button', {name: 'Close'}));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', {name: 'Export'}));
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([]);
  });
});
