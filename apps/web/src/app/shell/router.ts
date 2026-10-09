import {formatViewRoute, parseViewRoute} from '../../shared/routing';
import type {ViewRoute} from '../../shared/routing';

/** A route that can be navigated to (share links arrive from the URL only). */
export type NavigableRoute = Exclude<ViewRoute, {view: 'startup' | 'share'}>;

/**
 * Runs before the view changes (REQ-UX-069: flush autosave; wizard: discard confirmation).
 * Returning `false` cancels the navigation.
 */
export type RouteGuard = (
  from: ViewRoute,
  to: ViewRoute,
) => boolean | void | Promise<boolean | void>;

/** Options of {@link Router.navigate}. */
export interface NavigateOptions {
  /** Replace the current history entry instead of adding one. */
  readonly replace?: boolean;
}

/** Fragment router over the pure parser of `shared/routing` (REQ-UX-048, REQ-UX-069). */
export interface Router {
  current(): ViewRoute;
  subscribe(listener: () => void): () => void;
  /** Resolves to false when a guard cancelled the navigation. */
  navigate(route: NavigableRoute, options?: NavigateOptions): Promise<boolean>;
  addGuard(guard: RouteGuard): () => void;
  dispose(): void;
}

const sameRoute = (a: ViewRoute, b: ViewRoute): boolean =>
  a.view === b.view &&
  (a.view !== 'project' || a.projectId === (b as typeof a).projectId) &&
  (a.view !== 'share' || a.payload === (b as typeof a).payload);

/**
 * Creates the router. The fragment is untrusted input: unknown values map to home. Every
 * `navigate` adds a history entry so Back and Forward move between views; a Back or Forward
 * runs the guards too, and a cancelled one restores the fragment of the current view.
 */
export function createRouter(win: Window): Router {
  let route: ViewRoute = parseViewRoute(win.location.hash);
  const listeners = new Set<() => void>();
  const guards = new Set<RouteGuard>();
  let queue: Promise<unknown> = Promise.resolve();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  async function allowed(from: ViewRoute, to: ViewRoute): Promise<boolean> {
    // The startup route has nothing to flush or discard.
    if (from.view === 'startup') return true;
    for (const guard of [...guards]) {
      try {
        if ((await guard(from, to)) === false) return false;
      } catch {
        // A failing guard must not trap the user on a view.
      }
    }
    return true;
  }

  const fragmentOf = (r: ViewRoute): string | null =>
    r.view === 'startup' || r.view === 'share' ? null : formatViewRoute(r);

  const onHashChange = () => {
    const next = parseViewRoute(win.location.hash);
    if (sameRoute(next, route)) return;
    queue = queue.then(async () => {
      const from = route;
      if (await allowed(from, next)) {
        route = next;
        notify();
        return;
      }
      const back = fragmentOf(from);
      if (back !== null) win.history.replaceState(null, '', back);
    });
  };
  win.addEventListener('hashchange', onHashChange);

  return {
    current: () => route,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate(next, options = {}) {
      const run = queue.then(async () => {
        const from = route;
        if (sameRoute(from, next) && from.view !== 'startup') return true;
        if (!(await allowed(from, next))) return false;
        const fragment = formatViewRoute(next);
        if (options.replace === true || from.view === 'startup') {
          win.history.replaceState(null, '', fragment);
        } else {
          win.history.pushState(null, '', fragment);
        }
        route = next;
        notify();
        return true;
      });
      queue = run;
      return run;
    },
    addGuard(guard) {
      guards.add(guard);
      return () => {
        guards.delete(guard);
      };
    },
    dispose() {
      win.removeEventListener('hashchange', onHashChange);
      listeners.clear();
      guards.clear();
    },
  };
}
