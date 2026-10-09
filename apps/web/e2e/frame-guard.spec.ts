import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

/**
 * REQ-GEN-012: a framed editor shows only the "Open in a new tab" link and touches no storage,
 * IndexedDB, OPFS, BroadcastChannel or service worker. The spies are installed in every frame
 * before any page script runs.
 */
const SPIES = () => {
  const w = window as unknown as {__calls: string[]};
  w.__calls = [];
  const note = (name: string) => w.__calls.push(name);
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    // [Global] interfaces define their attributes on the window object itself.
    const desc = Object.getOwnPropertyDescriptor(window, name);
    if (desc?.get === undefined) continue;
    const get = desc.get;
    Object.defineProperty(window, name, {
      ...desc,
      get() {
        note(name);
        return get.call(window);
      },
    });
  }
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    note('indexedDB.open');
    return open.apply(this, args);
  };
  const OrigChannel = window.BroadcastChannel;
  window.BroadcastChannel = class extends OrigChannel {
    constructor(name: string) {
      note('BroadcastChannel');
      super(name);
    }
  };
  const storage = navigator.storage as unknown as {
    getDirectory?: () => Promise<unknown>;
  };
  if (storage.getDirectory !== undefined) {
    const original = storage.getDirectory.bind(storage);
    storage.getDirectory = () => {
      note('storage.getDirectory');
      return original();
    };
  }
  const sw = navigator.serviceWorker as unknown as {
    register?: (...a: unknown[]) => Promise<unknown>;
  };
  if (sw?.register !== undefined) {
    const original = sw.register.bind(sw);
    sw.register = (...a) => {
      note('serviceWorker.register');
      return original(...a);
    };
  }
};

async function framed(page: Page, hostUrl: string, appUrl: string) {
  await page.addInitScript(SPIES);
  await page.route(hostUrl, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>host</title><iframe title="editor" src="${appUrl}" width="900" height="600"></iframe>`,
    }),
  );
  await page.goto(hostUrl);
  const frame = page.frameLocator('iframe');
  await expect(
    frame.getByRole('link', {name: 'Open in a new tab'}),
  ).toBeVisible();
  const child = page.frames().find(f => f !== page.mainFrame());
  expect(child).toBeDefined();
  // Let any late startup work run before counting.
  await page.waitForTimeout(1500);
  const calls = await child?.evaluate(
    () => (window as unknown as {__calls: string[]}).__calls,
  );
  return {frame, calls};
}

test('AC-GEN-012.1: a cross-origin frame shows only the link and makes 0 storage accesses', async ({
  page,
  baseURL,
}) => {
  // Two fake public origins proxied to the preview server: a loopback frame target from another
  // origin is blocked by Chromium's local-network-access checks before the editor loads.
  const real = baseURL ?? 'http://localhost:4173';
  await page.route('http://app.test/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({
      response: await route.fetch({url: real + url.pathname + url.search}),
    });
  });
  const {frame, calls} = await framed(
    page,
    'http://host.test/host.html',
    'http://app.test/',
  );
  expect(calls).toEqual([]);
  await expect(frame.locator('#root a')).toHaveCount(1);
  await expect(frame.locator('canvas, button')).toHaveCount(0);
  await expect(
    frame.getByRole('link', {name: 'Open in a new tab'}),
  ).toHaveAttribute('rel', 'noopener noreferrer');
});

test('AC-GEN-012.2: a same-origin frame gives the same result', async ({
  page,
  baseURL,
}) => {
  const origin = baseURL ?? 'http://localhost:4173';
  const {frame, calls} = await framed(
    page,
    `${origin}/host.html`,
    `${origin}/`,
  );
  expect(calls).toEqual([]);
  await expect(frame.locator('#root a')).toHaveCount(1);
  await expect(frame.locator('canvas, button')).toHaveCount(0);
});
