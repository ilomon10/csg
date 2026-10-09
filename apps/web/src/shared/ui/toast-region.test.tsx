// @vitest-environment jsdom
import {act, cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {axeViolations, focused} from './test-utils';
import {ToastRegion} from './toast-region';
import {createToastQueue} from './toast-queue';

afterEach(cleanup);

describe('ToastRegion', () => {
  it('AC-UX-032.1: an error with its code is in the assertive region, a success in the polite one, focus stays', () => {
    const queue = createToastQueue();
    render(
      <>
        <button type="button">editor</button>
        <ToastRegion queue={queue} />
      </>,
    );
    screen.getByRole('button', {name: 'editor'}).focus();
    act(() => {
      queue.push({
        message: 'Upload failed',
        tone: 'error',
        code: 'UPL_TIMEOUT',
      });
      queue.push({message: 'Saved', tone: 'success'});
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Upload failed');
    expect(alert.textContent).toContain('UPL_TIMEOUT');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Saved');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(focused()).toBe(screen.getByRole('button', {name: 'editor'}));
  });

  it('AC-UX-032.1: the action button is keyboard reachable, runs and dismisses', async () => {
    const user = userEvent.setup();
    const queue = createToastQueue();
    const onAction = vi.fn();
    render(<ToastRegion queue={queue} />);
    act(() => {
      queue.push({message: 'Part removed', action: {label: 'Undo', onAction}});
    });
    await user.tab();
    expect(focused()).toBe(screen.getByRole('button', {name: 'Undo'}));
    await user.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByText('Part removed')).toBeNull();
  });

  it('AC-UX-032.1: the region itself can take programmatic focus for F6', () => {
    render(<ToastRegion queue={createToastQueue()} id="toasts" />);
    const region = screen.getByRole('region', {name: 'Notifications'});
    expect(region.tabIndex).toBe(-1);
    region.focus();
    expect(focused()).toBe(region);
  });

  it('AC-UX-031.1: shows at most three toasts', () => {
    const queue = createToastQueue();
    render(<ToastRegion queue={queue} />);
    act(() => {
      for (let i = 0; i < 5; i++) queue.push({message: `m${i}`, tone: 'error'});
    });
    expect(
      screen.getAllByRole('button', {name: 'Dismiss notification'}),
    ).toHaveLength(3);
  });

  it('AC-UX-036.1: has no axe violations', async () => {
    const queue = createToastQueue();
    const {container} = render(<ToastRegion queue={queue} />);
    act(() => {
      queue.push({message: 'Saved', tone: 'success'});
      queue.push({message: 'Nope', tone: 'error', code: 'X_Y'});
    });
    expect(await axeViolations(container)).toEqual([]);
  });
});
