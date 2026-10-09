import {describe, expect, it} from 'vitest';
import {hub} from './test-channel';
import {createTabLock} from './tab-lock';

const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe('tab lock', () => {
  it('AC-UX-029.1: a second tab opening the same project is read-only; taking over makes the first tab read-only', async () => {
    const factory = hub();
    const a = createTabLock({
      tabId: 'tab-a',
      channelFactory: factory,
      wait: flush,
    });
    const b = createTabLock({
      tabId: 'tab-b',
      channelFactory: factory,
      wait: flush,
    });
    expect(await a.claim('p1')).toBe('held');
    expect(await b.claim('p1')).toBe('read-only');
    b.takeOver();
    await flush();
    expect(b.state()).toBe('held');
    expect(a.state()).toBe('read-only');
  });

  it('AC-UX-029.1: another project in the second tab is not locked', async () => {
    const factory = hub();
    const a = createTabLock({
      tabId: 'tab-a',
      channelFactory: factory,
      wait: flush,
    });
    const b = createTabLock({
      tabId: 'tab-b',
      channelFactory: factory,
      wait: flush,
    });
    await a.claim('p1');
    expect(await b.claim('p2')).toBe('held');
  });

  it('AC-UX-029.2: a forged message is ignored', async () => {
    const factory = hub();
    const a = createTabLock({
      tabId: 'tab-a',
      channelFactory: factory,
      wait: flush,
    });
    await a.claim('p1');
    const evil = factory('csg-tab-locks');
    evil?.postMessage({
      type: 'takeover',
      projectId: 'p1',
      tabId: 'x',
      extra: 1,
    });
    evil?.postMessage('takeover');
    await flush();
    expect(a.state()).toBe('held');
  });
});
