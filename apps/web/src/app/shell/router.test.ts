// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createRouter} from './router';
import type {Router} from './router';

let router: Router | null = null;
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  router?.dispose();
  router = null;
});

describe('router', () => {
  it('AC-UX-069.2: an unknown or hostile fragment maps to home, never throws', () => {
    window.history.replaceState(null, '', '#p=../../etc');
    router = createRouter(window);
    expect(router.current()).toEqual({view: 'home'});
  });

  it('AC-UX-070.1: an empty fragment is the startup route and navigate replaces it with #home', async () => {
    router = createRouter(window);
    expect(router.current()).toEqual({view: 'startup'});
    const length = window.history.length;
    await router.navigate({view: 'home'});
    expect(window.location.hash).toBe('#home');
    expect(window.history.length).toBe(length);
  });

  it('AC-UX-069.1: every view change adds a history entry and updates the fragment', async () => {
    router = createRouter(window);
    await router.navigate({view: 'home'}, {replace: true});
    const length = window.history.length;
    await router.navigate({view: 'project', projectId: 'abc'});
    expect(window.location.hash).toBe('#p=abc');
    expect(window.history.length).toBe(length + 1);
    await router.navigate({view: 'wizard'}, {replace: true});
    expect(window.location.hash).toBe('#new');
    expect(window.history.length).toBe(length + 1);
  });

  it('AC-UX-069.3: guards run before leaving the editor and can cancel', async () => {
    router = createRouter(window);
    await router.navigate({view: 'project', projectId: 'abc'}, {replace: true});
    const seen: string[] = [];
    let allow = false;
    router.addGuard(async (from, to) => {
      seen.push(`${from.view}->${to.view}`);
      return allow;
    });
    expect(await router.navigate({view: 'home'})).toBe(false);
    expect(router.current().view).toBe('project');
    allow = true;
    expect(await router.navigate({view: 'home'})).toBe(true);
    expect(router.current().view).toBe('home');
    expect(seen).toEqual(['project->home', 'project->home']);
  });

  it('AC-UX-069.3: a browser Back (hashchange) is guarded; a cancelled one restores the fragment', async () => {
    router = createRouter(window);
    await router.navigate({view: 'project', projectId: 'abc'}, {replace: true});
    router.addGuard(() => false);
    window.location.hash = '#home';
    await new Promise(r => setTimeout(r, 20));
    expect(router.current().view).toBe('project');
    expect(window.location.hash).toBe('#p=abc');
  });
});
