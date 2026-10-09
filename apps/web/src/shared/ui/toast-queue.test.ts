import {describe, expect, it} from 'vitest';
import {createToastQueue, TOAST_MAX_VISIBLE} from './toast-queue';

/** Manual clock and timers so tests never touch the real clock. */
function harness() {
  let t = 0;
  const timers = new Map<number, {at: number; fn: () => void}>();
  let id = 0;
  const queue = createToastQueue({
    now: () => t,
    setTimer: (fn, ms) => {
      timers.set(++id, {at: t + ms, fn});
      return id;
    },
    clearTimer: h => timers.delete(h as number),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  return {queue, advance};
}

describe('toast queue', () => {
  it('AC-UX-031.1: five toasts show three, the rest appear as earlier ones expire', () => {
    const {queue, advance} = harness();
    for (let i = 0; i < 5; i++) queue.push({message: `m${i}`});
    expect(queue.visible().map(x => x.message)).toEqual(['m0', 'm1', 'm2']);
    expect(queue.queued()).toBe(2);
    advance(5000);
    expect(queue.visible().map(x => x.message)).toEqual(['m3', 'm4']);
    expect(TOAST_MAX_VISIBLE).toBe(3);
  });

  it('AC-UX-031.2: an error stays until dismissed', () => {
    const {queue, advance} = harness();
    const id = queue.push({
      message: 'Upload failed',
      tone: 'error',
      code: 'UPL_TIMEOUT',
    });
    advance(60_000);
    expect(queue.visible()).toHaveLength(1);
    queue.dismiss(id);
    expect(queue.visible()).toHaveLength(0);
  });

  it('AC-UX-031.1: timeouts are info 5 s, success 4 s, warning 8 s, with action 10 s', () => {
    const {queue, advance} = harness();
    queue.push({message: 'i', tone: 'info'});
    queue.push({message: 's', tone: 'success'});
    queue.push({message: 'w', tone: 'warning'});
    advance(3999);
    expect(queue.visible()).toHaveLength(3);
    advance(1);
    expect(queue.visible().map(x => x.message)).toEqual(['i', 'w']);
    advance(1000);
    expect(queue.visible().map(x => x.message)).toEqual(['w']);
    advance(3000);
    expect(queue.visible()).toHaveLength(0);
    queue.push({message: 'undo', action: {label: 'Undo', onAction: () => {}}});
    advance(9999);
    expect(queue.visible()).toHaveLength(1);
    advance(1);
    expect(queue.visible()).toHaveLength(0);
  });

  it('AC-UX-031.1: identical messages within 2 s merge with a count', () => {
    const {queue, advance} = harness();
    queue.push({message: 'Saved'});
    advance(1500);
    queue.push({message: 'Saved'});
    expect(queue.visible()).toHaveLength(1);
    expect(queue.visible()[0]?.count).toBe(2);
    advance(2500);
    queue.push({message: 'Saved'});
    expect(queue.visible()).toHaveLength(2);
  });

  it('AC-UX-031.1: pause on hover or focus holds the timer and resume continues it', () => {
    const {queue, advance} = harness();
    const id = queue.push({message: 'hold'});
    advance(3000);
    queue.pause(id);
    advance(60_000);
    expect(queue.visible()).toHaveLength(1);
    queue.resume(id);
    advance(1999);
    expect(queue.visible()).toHaveLength(1);
    advance(1);
    expect(queue.visible()).toHaveLength(0);
  });
});
