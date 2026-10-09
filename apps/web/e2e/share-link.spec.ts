import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect, test} from '@playwright/test';
import type {BrowserContext, Page} from '@playwright/test';

/** A valid project document (parts-schema fixture; the e2e runner cannot import the package). */
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../packages/parts-schema/test/fixtures/project-v1.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as {character: Record<string, unknown>};

test.use({permissions: ['clipboard-read', 'clipboard-write']});

interface Rec {
  meta: {projectId: string; name: string};
  doc: {character: {body: unknown; parts: unknown; tints: unknown}};
}

/** Seeds one project, opens it in Pro and returns its id. */
async function openSeeded(page: Page): Promise<string> {
  await page.addInitScript(() => {
    if (window.localStorage.getItem('csg.prefs') === null) {
      window.localStorage.setItem(
        'csg.prefs',
        JSON.stringify({
          format: 'sprite-ui-prefs',
          version: 2,
          theme: 'dark',
          workspace: 'pro',
        }),
      );
    }
  });
  await page.goto('/');
  await expect(page.getByText('Starting…')).toHaveCount(0, {timeout: 20_000});
  const record = {
    format: 'sprite-project-record',
    version: 1,
    meta: {
      projectId: 'share-src',
      name: 'Sharer',
      lastEditedAt: Date.now(),
      pinned: false,
    },
    doc: {...FIXTURE, character: {...FIXTURE.character, name: 'Sharer'}},
  };
  await page.evaluate(async rec => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('csg', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, record);
  await page.goto('/#p=share-src');
  await page.reload();
  await expect(page.getByTestId('pro')).toBeVisible({timeout: 30_000});
  return 'share-src';
}

async function records(page: Page): Promise<Rec[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('csg', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction('projects').objectStore('projects').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all as never;
  });
}

async function copyShareLink(page: Page): Promise<string> {
  await page.getByRole('button', {name: 'Character file'}).click();
  await page.getByRole('menuitem', {name: 'Copy share link'}).click();
  await expect(page.getByText('Share link copied')).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** A second page in the same browser profile (shared IndexedDB), like a new tab. */
async function newTab(context: BrowserContext): Promise<Page> {
  return context.newPage();
}

test('AC-CMP-025.1 / AC-CMP-035.1: a copied share link opens in a new tab, asks, and creates a NEW project with the same character', async ({
  page,
  context,
}) => {
  const srcId = await openSeeded(page);
  const link = await copyShareLink(page);
  expect(link).toContain('#c=');
  const before = (await records(page)).find(r => r.meta.projectId === srcId);

  const tab = await newTab(context);
  await tab.goto(link);
  const dialog = tab.getByRole('alertdialog');
  await expect(dialog).toBeVisible({timeout: 30_000});
  // Cancel is the safe default focus (AC-CMP-035.2).
  await expect(tab.getByRole('button', {name: 'Cancel'})).toBeFocused();
  await tab.getByRole('button', {name: 'Open as new project'}).click();

  await expect(tab).toHaveURL(/#p=(?!share-src)[A-Za-z0-9_-]+$/, {
    timeout: 30_000,
  });
  const all = await records(tab);
  expect(all).toHaveLength(2);
  const created = all.find(r => r.meta.projectId !== srcId);
  expect(created?.meta.name).toBe('Sharer');
  expect(created?.doc.character.body).toEqual(before?.doc.character.body);
  expect(created?.doc.character.parts).toEqual(before?.doc.character.parts);
  expect(created?.doc.character.tints).toEqual(before?.doc.character.tints);
  // The source project is untouched.
  expect(all.find(r => r.meta.projectId === srcId)?.doc).toEqual(before?.doc);

  // The fragment is gone: a reload neither asks again nor adds a project (AC-CMP-035.3).
  await tab.reload();
  await expect(tab.getByRole('alertdialog')).toHaveCount(0);
  expect(tab.url()).not.toContain('#c=');
  expect(await records(tab)).toHaveLength(2);
});

test('AC-CMP-035.2: Cancel creates no project and removes the fragment', async ({
  page,
  context,
}) => {
  await openSeeded(page);
  const link = await copyShareLink(page);
  const tab = await newTab(context);
  await tab.goto(link);
  await tab.bringToFront();
  await expect(tab.getByRole('alertdialog')).toBeVisible({timeout: 30_000});
  // Escape reaches the dialog only once focus is inside it (Cancel is the default focus).
  await expect(
    tab.getByRole('alertdialog').getByRole('button', {name: 'Cancel'}),
  ).toBeFocused();
  await tab.keyboard.press('Escape');
  await expect(tab.getByRole('alertdialog')).toHaveCount(0);
  expect(tab.url()).not.toContain('#c=');
  expect(await records(tab)).toHaveLength(1);
});

test('AC-CMP-034.4: a tampered payload is rejected with CMP_SPEC_INVALID, no dialog, no project, home shown', async ({
  page,
  context,
}) => {
  await openSeeded(page);
  const link = await copyShareLink(page);
  const payload = link.slice(link.indexOf('#c=') + 3);
  // Same length and alphabet, but the deflate stream is damaged.
  const tampered = payload.slice(0, 8) + 'AAAAAAAA' + payload.slice(16);
  const tab = await newTab(context);
  const errors: string[] = [];
  tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(link.slice(0, link.indexOf('#c=') + 3) + tampered);
  await expect(
    tab.locator('.csg-toast__code', {hasText: 'CMP_SPEC_INVALID'}),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(tab.getByRole('alertdialog')).toHaveCount(0);
  await expect(tab.getByTestId('home')).toBeVisible();
  expect(tab.url()).not.toContain('#c=');
  expect(await records(tab)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('AC-CMP-034.1: an oversized payload names the 65,536-character limit and goes home', async ({
  page,
}) => {
  await page.goto(`/#c=${'A'.repeat(70_000)}`);
  await expect(
    page.locator('.csg-toast__msg', {hasText: '65,536'}),
  ).toBeVisible({timeout: 30_000});
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('home')).toBeVisible();
  expect(page.url()).not.toContain('#c=');
});
