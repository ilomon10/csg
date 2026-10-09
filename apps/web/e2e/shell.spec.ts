import {mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from '@playwright/test';
import type {BrowserContext, Page} from '@playwright/test';
import {DEFAULT_SHORTCUTS} from '../src/shared/shortcuts/registry';

const SHOT_DIR = process.env['CSG_SHOT_DIR'];

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

/** Waits until the shell finished booting (router resolved, IndexedDB open). */
async function booted(page: Page, url = '/'): Promise<void> {
  // Focus and paint events only reach a page that is in front (parallel workers share a browser).
  await page.bringToFront();
  await page.goto(url);
  await expect(
    page.getByRole('heading', {name: 'Character Sprite Generator'}),
  ).toBeVisible();
  // Software-rendered previews in parallel workers can starve the main thread for seconds.
  await expect(page.getByText('Starting…')).toHaveCount(0, {timeout: 20_000});
}

/** Writes a valid project record straight into the `csg` database (no editing UI exists yet). */
async function seedProject(
  page: Page,
  id: string,
  name: string,
): Promise<void> {
  const record = {
    format: 'sprite-project-record',
    version: 1,
    meta: {projectId: id, name, lastEditedAt: Date.now(), pinned: false},
    doc: {...FIXTURE, character: {...FIXTURE.character, name}},
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
}

/** Collects CSP and Trusted Types violations from page start. */
async function watchViolations(page: Page): Promise<string[]> {
  const log: string[] = [];
  page.on('console', msg => {
    if (/content security policy|trusted type/i.test(msg.text())) {
      log.push(msg.text());
    }
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      console.error(
        `Content Security Policy violation: ${e.violatedDirective}`,
      );
    });
  });
  return log;
}

test('AC-UX-070.1: a fresh profile with no fragment shows home, the fragment becomes #home and no dialog is open', async ({
  page,
}) => {
  const violations = await watchViolations(page);
  await booted(page);
  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('AC-UX-034.1: a stored Light theme is applied before the first contentful paint', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'csg.prefs',
      JSON.stringify({format: 'sprite-ui-prefs', version: 2, theme: 'light'}),
    );
    const w = window as unknown as {__themeAt: number; __fcp: number};
    w.__themeAt = -1;
    w.__fcp = -1;
    new MutationObserver(() => {
      if (
        w.__themeAt < 0 &&
        document.documentElement.getAttribute('data-theme') === 'light'
      ) {
        w.__themeAt = performance.now();
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-theme'],
    });
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-contentful-paint') w.__fcp = e.startTime;
      }
    }).observe({type: 'paint', buffered: true});
  });
  await booted(page);
  // Chromium reports FCP only for a visible, painted page; under parallel workers the tab can
  // be backgrounded, so bring it to the front and wait for the buffered paint entry.
  await page.bringToFront();
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as {__fcp: number}).__fcp),
      {timeout: 15_000},
    )
    .toBeGreaterThan(0);
  const times = await page.evaluate(() => {
    const w = window as unknown as {__themeAt: number; __fcp: number};
    return {theme: w.__themeAt, fcp: w.__fcp};
  });
  expect(times.theme).toBeGreaterThan(0);
  expect(times.fcp).toBeGreaterThan(0);
  expect(times.theme).toBeLessThan(times.fcp);
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).toBe('rgb(236, 235, 228)');
});

test('AC-UX-020.1 / AC-UX-019.3: F1 opens the help overlay with every registry entry once; Escape closes it', async ({
  page,
}) => {
  await booted(page);
  await page.getByRole('button', {name: 'Settings'}).focus();
  await page.keyboard.press('F1');
  const dialog = page.getByRole('dialog', {name: 'Keyboard shortcuts'});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(
    DEFAULT_SHORTCUTS.length,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Settings'})).toBeFocused();
});

test('AC-UX-037.1 / AC-UX-019.1: Escape closes the settings dialog and focus returns to its button; Ctrl+K opens the palette', async ({
  page,
}) => {
  await booted(page);
  const gear = page.getByRole('button', {name: 'Settings'});
  await gear.click();
  await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(gear).toBeFocused();
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', {name: 'Command palette'});
  await expect(box).toBeFocused();
  await box.fill('workspace');
  await expect(
    page.getByRole('option', {name: /Switch workspace/}),
  ).toHaveAttribute('aria-disabled', 'true');
});

test('AC-UX-013.1: F6 cycles focus between the top bar and the content', async ({
  page,
}) => {
  await booted(page);
  // Home moves focus to its primary action once its lineup is ready; F6 must not race that.
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await page.keyboard.press('F6');
  await expect(page.locator('[data-region="Top bar"]')).toBeFocused();
  await page.keyboard.press('F6');
  await expect(page.locator('[data-region="Content"]')).toBeFocused();
});

test('AC-UX-030.1: closing the tab with everything saved shows no confirmation', async ({
  page,
}) => {
  await booted(page);
  let dialogs = 0;
  page.on('dialog', d => {
    dialogs++;
    void d.dismiss();
  });
  await page.close({runBeforeUnload: true});
  expect(dialogs).toBe(0);
});

test('AC-UX-053.1: Mod+Alt+P switches workspace and the top-bar radio reflects it', async ({
  page,
}) => {
  await booted(page);
  await seedProject(page, 'e2e-hero', 'E2E Hero');
  await booted(page, '/#p=e2e-hero');
  const group = page.getByRole('radiogroup', {name: 'Workspace'});
  await expect(group).toBeVisible();
  const easy = group.getByRole('radio', {name: 'Easy'});
  await expect(easy).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Control+Alt+p');
  await expect(group.getByRole('radio', {name: 'Pro'})).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('textbox', {name: 'Project name'})).toHaveValue(
    'E2E Hero',
  );
});

test('AC-UX-069.1: an unknown project id shows home and a UX_PROJECT_NOT_FOUND warning', async ({
  page,
}) => {
  await booted(page, '/#p=does-not-exist');
  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByText('UX_PROJECT_NOT_FOUND')).toBeVisible();
});

test('AC-UX-043.1: a crashing region shows the panel fallback while the top bar keeps working', async ({
  page,
}) => {
  await booted(page);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('csg:test-crash', {
        detail: {scope: 'region', name: 'Content'},
      }),
    ),
  );
  const fallback = page.getByTestId('region-fallback');
  await expect(fallback).toContainText('This panel stopped working');
  await expect(fallback).toContainText('UX_PANEL_CRASHED');
  await page.getByRole('button', {name: 'Settings'}).click();
  await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Reload panel'}).click();
  await expect(page.getByTestId('region-fallback')).toHaveCount(0);
});

test('AC-UX-044.1: a crash that escapes every region shows the full-window fallback and a backup that opens to the same character', async ({
  page,
}) => {
  await booted(page);
  await seedProject(page, 'e2e-backup', 'Backup Hero');
  await booted(page, '/#p=e2e-backup');
  await expect(page.getByRole('textbox', {name: 'Project name'})).toHaveValue(
    'Backup Hero',
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('csg:test-crash', {detail: {scope: 'root'}}),
    ),
  );
  await expect(page.getByTestId('root-fallback')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download project backup'}).click();
  const file = await download;
  const text = await (
    await import('node:fs/promises')
  ).readFile(await file.path(), 'utf8');
  const json = JSON.parse(text) as {
    format: string;
    character: {name: string};
  };
  expect(json.format).toBe('sprite-project');
  expect(json.character.name).toBe('Backup Hero');
});

async function pageIn(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await booted(page, url);
  return page;
}

test('AC-UX-045.1 / AC-UX-086.1: after an unclean shutdown the restore prompt shows over home and Restore opens the autosave', async ({
  context,
}) => {
  const first = await pageIn(context, '/');
  await seedProject(first, 'crash-1', 'Crashed Hero');
  // The first tab stays open untouched: it is the "killed" session. Its marker is what a kill leaves.
  await first.evaluate(() =>
    window.localStorage.setItem(
      'csg.session',
      JSON.stringify({
        format: 'sprite-session',
        version: 1,
        projectId: 'crash-1',
      }),
    ),
  );
  const second = await pageIn(context, '/#p=crash-1');
  const dialog = second.getByRole('alertdialog', {
    name: 'Restore your last session?',
  });
  await expect(dialog).toContainText('Crashed Hero');
  // AC-UX-045.2: nothing is loaded into the editor or the engine before the user answers.
  await second.waitForTimeout(1500);
  await expect(second.locator('.preview-stage')).toHaveCount(0);
  await expect(second.getByRole('textbox', {name: 'Project name'})).toHaveCount(
    0,
  );
  await dialog.getByRole('button', {name: 'Restore'}).click();
  await expect(second).toHaveURL(/#p=crash-1$/);
  await expect(second.getByRole('textbox', {name: 'Project name'})).toHaveValue(
    'Crashed Hero',
  );
});

test('AC-UX-086.1: choosing "Start without restoring" shows home with #home', async ({
  context,
}) => {
  const first = await pageIn(context, '/');
  await seedProject(first, 'crash-2', 'Skipped Hero');
  await first.evaluate(() =>
    window.localStorage.setItem(
      'csg.session',
      JSON.stringify({
        format: 'sprite-session',
        version: 1,
        projectId: 'crash-2',
      }),
    ),
  );
  const second = await pageIn(context, '/#p=crash-2');
  await second.getByRole('button', {name: 'Start without restoring'}).click();
  await expect(second).toHaveURL(/#home$/);
  await expect(second.getByRole('alertdialog')).toHaveCount(0);
});

test('AC-UX-029.1: a second tab opening the same project is read-only; taking over makes the first tab read-only within 1 s', async ({
  context,
}) => {
  test.setTimeout(90_000);
  const a = await pageIn(context, '/');
  await seedProject(a, 'lock-1', 'Locked Hero');
  await booted(a, '/#p=lock-1');
  await expect(a.getByRole('textbox', {name: 'Project name'})).toBeVisible();
  // A claim waits 150 ms for the holder's answer (REQ-UX-029). On a starved runner the holder can
  // answer late, and then the newcomer legitimately holds the lock; that is not the case under
  // test, so open the second tab again (the first tab still holds the project).
  let b = await pageIn(context, '/#p=lock-1');
  for (let attempt = 1; attempt < 4; attempt++) {
    const read = b.getByTestId('tab-lock-banner');
    const shown = await read.waitFor({state: 'visible', timeout: 6_000}).then(
      () => true,
      () => false,
    );
    if (shown) break;
    await b.close();
    b = await pageIn(context, '/#p=lock-1');
  }
  await expect(b.getByTestId('tab-lock-banner')).toContainText(
    'Open in another tab',
    {timeout: 10_000},
  );
  await expect(a.getByTestId('tab-lock-banner')).toHaveCount(0);
  // The AC bounds the interval from the take-over to A's banner, so stamp both ends inside the
  // pages (same clock): the stamp in B is taken in the click's own task, the stamp in A when the
  // banner is inserted. The Playwright round trips under load are not part of the interval.
  await a.evaluate(() => {
    const w = window as unknown as {__bannerAt: number};
    w.__bannerAt = -1;
    const check = () => {
      if (
        w.__bannerAt < 0 &&
        document.querySelector('[data-testid="tab-lock-banner"]')
      ) {
        w.__bannerAt = Date.now();
      }
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
    });
    check();
  });
  const clickedAt = await b.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find(
      el => el.textContent?.trim() === 'Take over editing',
    );
    const at = Date.now();
    button?.click();
    return at;
  });
  await expect(b.getByTestId('tab-lock-banner')).toHaveCount(0);
  await expect(a.getByTestId('tab-lock-banner')).toBeVisible({timeout: 10_000});
  const bannerAt = await a.evaluate(
    () => (window as unknown as {__bannerAt: number}).__bannerAt,
  );
  expect(bannerAt).toBeGreaterThan(0);
  expect(bannerAt - clickedAt).toBeLessThan(1000);
});

for (const theme of ['dark', 'light'] as const) {
  test(`shell screenshot (${theme})`, async ({page}) => {
    test.skip(SHOT_DIR === undefined, 'set CSG_SHOT_DIR to write screenshots');
    await page.addInitScript(t => {
      window.localStorage.setItem(
        'csg.prefs',
        JSON.stringify({format: 'sprite-ui-prefs', version: 2, theme: t}),
      );
    }, theme);
    await page.setViewportSize({width: 1280, height: 720});
    await booted(page);
    await page.waitForTimeout(500);
    mkdirSync(SHOT_DIR as string, {recursive: true});
    await page.screenshot({
      path: join(SHOT_DIR as string, `shell-${theme}.png`),
    });
  });
}
