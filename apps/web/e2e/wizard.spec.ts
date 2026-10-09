import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

const SHOT_DIR = process.env['CSG_SHOT_DIR'];

const TITLES = [
  'Style',
  'Species',
  'Body shape',
  'Face',
  'Hair',
  'Outfit',
  'Colors',
  'Name and finish',
];

async function openWizard(page: Page): Promise<void> {
  await page.goto('/#new');
  await expect(
    page.getByRole('heading', {name: 'Step 1 of 8: Style'}),
  ).toBeVisible({timeout: 20_000});
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOT_DIR === undefined) return;
  mkdirSync(SHOT_DIR, {recursive: true});
  await page.screenshot({path: join(SHOT_DIR, `wizard-${name}.png`)});
}

test('AC-UX-089.1 / AC-UX-092.1: the wizard shows step 1 of 8 and gates Coming-soon styles', async ({
  page,
}, info) => {
  await openWizard(page);
  const heading = page.getByRole('heading', {name: 'Step 1 of 8: Style'});
  await expect(heading).toBeFocused();
  for (const [i, title] of TITLES.entries()) {
    await expect(
      page.getByRole('button', {name: `Step ${i + 1}: ${title}`}),
    ).toBeVisible();
  }
  await expect(page.getByRole('radio', {name: /Chibi/})).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
  for (const name of ['Stickman', 'Voxel']) {
    const card = page.getByRole('radio', {name: new RegExp(name)});
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    await expect(card).toContainText('Coming soon');
  }
  await expect(
    page.getByRole('region', {name: /Character preview/}),
  ).toBeVisible();
  info.annotations.push({type: 'backend', description: info.project.name});
  await shot(page, `step1-${info.project.name}`);
});

test('AC-UX-095.1 / AC-UX-089.1 / AC-UX-099.1 / AC-UX-098.1: keyboard-only pass through the 8 steps to Finish', async ({
  page,
}, info) => {
  await openWizard(page);
  const next = page.getByRole('button', {name: 'Next', exact: true});
  for (let i = 1; i < 8; i++) {
    // Tab from the heading through the step controls to Next, then Enter.
    await page.keyboard.press('Tab');
    for (let guard = 0; guard < 40; guard++) {
      if (await next.evaluate(el => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', {name: `Step ${i + 1} of 8: ${TITLES[i]}`}),
    ).toBeFocused();
    if (i === 2) await shot(page, `step3-${info.project.name}`);
    if (i === 6) await shot(page, `step7-${info.project.name}`);
  }
  await page.keyboard.press('Tab');
  await page.keyboard.type('  Mira  ');
  await expect(page.getByRole('textbox', {name: 'Name'})).toHaveValue(
    '  Mira  ',
  );
  await shot(page, `step8-${info.project.name}`);
  const started = Date.now();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#p=[A-Za-z0-9_-]+$/, {timeout: 5_000});
  expect(Date.now() - started).toBeLessThan(5_000);
  const names = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('csg');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return new Promise<string[]>((resolve, reject) => {
      const req = db.transaction('projects').objectStore('projects').getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as Array<{meta: {name: string}}>).map(r => r.meta.name),
        );
      req.onerror = () => reject(req.error);
    });
  });
  expect(names).toEqual(['Mira']);
});

test('AC-UX-098.1 / AC-UX-098.2: Escape returns home when unchanged, asks to discard when changed', async ({
  page,
}) => {
  await openWizard(page);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await openWizard(page);
  await page.getByRole('radio', {name: /Chibi/}).click();
  await page.keyboard.press('Escape');
  const dialog = page.getByRole('alertdialog', {
    name: 'Discard this character?',
  });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', {name: 'Keep editing'})).toBeFocused();
  await page.getByRole('button', {name: 'Keep editing'}).click();
  await expect(page).toHaveURL(/#new$/);
  await expect(page.getByRole('radio', {name: /Chibi/})).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Discard'}).click();
  await expect(page).toHaveURL(/#home$/);
});

test('AC-UX-098.2: a hand-edited fragment with changes restores #new and asks', async ({
  page,
}) => {
  await openWizard(page);
  await page.getByRole('radio', {name: /Chibi/}).click();
  await page.evaluate(() => {
    window.location.hash = '#home';
  });
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page).toHaveURL(/#new$/);
});
