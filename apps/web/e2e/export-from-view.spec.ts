import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

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
) as {character: Record<string, unknown>; render: Record<string, unknown>};

/** The fixture selects no clips; an export needs at least one. */
const ANIMATIONS = [
  {
    clipId: 'builtin:quaternius-ual/idle',
    label: 'idle',
    frameCount: 4,
    fps: 8,
    loop: true,
    timing: 'fit',
  },
];

type Patch = (c: Record<string, unknown>) => Record<string, unknown>;

/** Writes a project into the `csg` database and opens it with the given prefs. */
async function openProject(
  page: Page,
  opts: {
    workspace?: 'easy' | 'pro';
    theme?: 'dark' | 'light';
    patch?: Patch;
    size?: {width: number; height: number};
    layout?: unknown;
  } = {},
): Promise<void> {
  const {workspace = 'easy', theme = 'dark', patch, size, layout} = opts;
  if (size) await page.setViewportSize(size);
  const base = {format: 'sprite-ui-prefs', version: 2, theme, workspace};
  await page.addInitScript(
    ([prefs]) => {
      if (window.localStorage.getItem('csg.prefs') === null) {
        window.localStorage.setItem('csg.prefs', prefs as string);
      }
    },
    [JSON.stringify(layout ? {...base, layout} : base)],
  );
  await page.goto('/');
  await expect(page.getByText('Starting…')).toHaveCount(0, {timeout: 20_000});
  const character = patch ? patch(FIXTURE.character) : FIXTURE.character;
  const record = {
    format: 'sprite-project-record',
    version: 1,
    meta: {
      projectId: 'ws-e2e',
      name: 'Workspace Hero',
      lastEditedAt: Date.now(),
      pinned: false,
    },
    doc: {
      ...FIXTURE,
      character: {...character, name: 'Workspace Hero'},
      render: {...FIXTURE.render, animations: ANIMATIONS},
    },
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
  await page.goto('/#p=ws-e2e');
  await page.reload();
  await expect(
    workspace === 'pro'
      ? page.getByTestId('pro')
      : page.getByRole('region', {name: 'Customize'}),
  ).toBeVisible({timeout: 30_000});
}

/** The preview canvas is redrawn: screenshots taken over `ms` are not all identical. */
async function isAnimating(page: Page, ms = 2500): Promise<boolean> {
  const canvas = page.getByTestId('preview-canvas').first();
  const first = await canvas.screenshot();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(150);
    if (!(await canvas.screenshot()).equals(first)) return true;
  }
  return false;
}

for (const workspace of ['easy', 'pro'] as const) {
  test(`AC-EXP-017.1, AC-UX-064.1: exporting from ${workspace} borrows the live renderer, downloads a ZIP and the preview keeps animating`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await openProject(page, {workspace});
    const wasAnimating = await isAnimating(page);
    await page.keyboard.press('Control+e');
    const start = page.getByTestId('export-start');
    await expect(start).toBeEnabled({timeout: 30_000});
    const downloadPromise = page.waitForEvent('download');
    await start.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    await expect(page.getByTestId('export-done')).toBeVisible({
      timeout: 120_000,
    });
    await page.screenshot({
      path: testInfo.outputPath(`export-from-${workspace}.png`),
    });
    await page.keyboard.press('Escape');
    // The same preview canvas is still there and still drawing (no second renderer, no hang).
    await expect(page.getByTestId('preview-canvas').first()).toBeVisible();
    if (wasAnimating) expect(await isAnimating(page, 6000)).toBe(true);
  });
}

test('AC-EXP-024.1: cancelling an export from Easy leaves the preview running', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openProject(page, {workspace: 'easy'});
  const wasAnimating = await isAnimating(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.keyboard.press('Control+e');
  const start = page.getByTestId('export-start');
  await expect(start).toBeEnabled({timeout: 30_000});
  await start.click();
  await page
    .getByRole('button', {name: /cancel/i})
    .first()
    .click();
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  await page.keyboard.press('Escape');
  if (wasAnimating) expect(await isAnimating(page, 6000)).toBe(true);
});

test('AC-EXP-017.1: Export pressed right after opening Easy waits for the viewport renderer instead of hanging', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openProject(page, {workspace: 'easy'});
  await page.keyboard.press('Control+e');
  const start = page.getByTestId('export-start');
  await expect(start).toBeEnabled({timeout: 30_000});
  const downloadPromise = page.waitForEvent('download');
  await start.click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.zip$/);
  await expect(page.getByTestId('export-done')).toBeVisible({timeout: 120_000});
});
