import {useEffect, useSyncExternalStore} from 'react';
import {createMiniStore} from './mini-store';

/** Event a test dispatches on `window` to make a region or the root throw while rendering. */
export const TEST_CRASH_EVENT = 'csg:test-crash';

/** Detail of {@link TEST_CRASH_EVENT}: `root`, or `region` (optionally one named region). */
export interface TestCrashDetail {
  readonly scope: 'root' | 'region';
  readonly name?: string;
}

const crashes = createMiniStore<{
  readonly root: boolean;
  readonly regions: readonly string[];
}>({root: false, regions: []});

/** Clears a requested crash (after "Reload panel"). */
export function clearCrash(scope: 'root' | 'region', name?: string): void {
  const s = crashes.get();
  if (scope === 'root') crashes.update({root: false});
  else {
    crashes.update({
      regions: s.regions.filter(r => r !== (name ?? '*') && r !== '*'),
    });
  }
}

/** Listens for {@link TEST_CRASH_EVENT} (the test hook of AC-UX-043.1 and AC-UX-044.1). */
export function useCrashEvents(win: Window): void {
  useEffect(() => {
    const onCrash = (e: Event) => {
      const detail = (e as CustomEvent<TestCrashDetail>).detail;
      if (detail?.scope === 'root') crashes.update({root: true});
      else if (detail?.scope === 'region') {
        crashes.update({
          regions: [...crashes.get().regions, detail.name ?? '*'],
        });
      }
    };
    win.addEventListener(TEST_CRASH_EVENT, onCrash);
    return () => win.removeEventListener(TEST_CRASH_EVENT, onCrash);
  }, [win]);
}

/**
 * Renders nothing, unless a crash was requested for its scope, in which case it throws while
 * rendering. Place one inside each region boundary (REQ-UX-043, REQ-UX-044).
 */
export function CrashProbe({
  scope,
  name,
}: {
  readonly scope: 'root' | 'region';
  readonly name?: string;
}): null {
  const state = useSyncExternalStore(crashes.subscribe, crashes.get);
  const hit =
    scope === 'root'
      ? state.root
      : state.regions.includes('*') ||
        (name !== undefined && state.regions.includes(name));
  if (hit) throw new Error(`Test crash requested for ${scope} ${name ?? ''}`);
  return null;
}
