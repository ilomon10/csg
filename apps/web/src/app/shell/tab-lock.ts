import {createTabChannel} from '../../shared/persistence';
import type {ChannelFactory, TabChannel} from '../../shared/persistence';

/** BroadcastChannel name of the project locks (messages carry only IDs, REQ-UX-029). */
export const LOCK_CHANNEL = 'csg-tab-locks';

/** How long an opening tab waits for a holder to answer its claim. */
export const CLAIM_WAIT_MS = 150;

/** Whether this tab may edit the open project. */
export type LockState = 'free' | 'claiming' | 'held' | 'read-only';

/**
 * One-writer-per-project lock across tabs (REQ-UX-029) over a validated BroadcastChannel.
 * A tab claims a project and waits briefly; a holder answers with its own claim, which makes
 * the newcomer read-only. Two tabs claiming within the same wait both end read-only (the
 * messages cannot tell a holder's answer from a rival claim); either can take over.
 * "Take over" makes the other tab read-only. Without BroadcastChannel every tab is `held`.
 */
export interface TabLock {
  state(): LockState;
  projectId(): string | null;
  subscribe(listener: () => void): () => void;
  /** Resolves with the resulting state once the claim wait is over. */
  claim(projectId: string): Promise<LockState>;
  release(): void;
  /** Takes the lock from the other tab. */
  takeOver(): void;
  dispose(): void;
}

/** Options of {@link createTabLock}. */
export interface TabLockOptions {
  readonly tabId: string;
  readonly channelFactory?: ChannelFactory;
  readonly wait?: (ms: number) => Promise<void>;
}

/** Creates the tab lock. */
export function createTabLock(options: TabLockOptions): TabLock {
  const channel: TabChannel = createTabChannel(
    LOCK_CHANNEL,
    options.channelFactory,
  );
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const listeners = new Set<() => void>();
  let state: LockState = 'free';
  let project: string | null = null;

  const set = (next: LockState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const off = channel.subscribe(message => {
    if (message.type === 'changed' || message.projectId !== project) return;
    if (message.tabId === options.tabId) return;
    if (message.type === 'claim') {
      if (state === 'held') {
        channel.post({
          type: 'claim',
          projectId: message.projectId,
          tabId: options.tabId,
        });
      } else if (state === 'claiming') {
        set('read-only');
      }
    } else if (message.type === 'takeover') {
      if (state === 'held' || state === 'claiming') set('read-only');
    }
  });

  return {
    state: () => state,
    projectId: () => project,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async claim(projectId) {
      if (project === projectId && state !== 'free') return state;
      if (project !== null && state === 'held') {
        channel.post({
          type: 'release',
          projectId: project,
          tabId: options.tabId,
        });
      }
      project = projectId;
      state = 'claiming';
      channel.post({type: 'claim', projectId, tabId: options.tabId});
      await wait(CLAIM_WAIT_MS);
      if (project !== projectId) return 'free';
      if (state === 'claiming') set('held');
      return state;
    },
    release() {
      if (project !== null && state === 'held') {
        channel.post({
          type: 'release',
          projectId: project,
          tabId: options.tabId,
        });
      }
      project = null;
      set('free');
    },
    takeOver() {
      if (project === null) return;
      channel.post({
        type: 'takeover',
        projectId: project,
        tabId: options.tabId,
      });
      set('held');
    },
    dispose() {
      off();
      this.release();
      channel.close();
      listeners.clear();
    },
  };
}
