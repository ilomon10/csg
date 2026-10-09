import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {
  WIZARD_TITLES,
  axeViolations,
  badAccessibleNames,
  expectClean,
  openHome,
  seedProjects,
  startWizardFromHome,
  watch,
} from './fixtures/qa';
import type {Watchers} from './fixtures/qa';

test.use({viewport: {width: 1440, height: 900}});

type Theme = 'dark' | 'light';

/** Collects axe violations and bad accessible names of the current state under a label. */
async function audit(
  page: Page,
  found: string[],
  state: string,
): Promise<void> {
  // Let the 300 ms enter transitions finish so axe reads settled colours.
  await page.waitForTimeout(450);
  for (const v of await axeViolations(page)) found.push(`[${state}] axe ${v}`);
  for (const n of await badAccessibleNames(page)) {
    found.push(`[${state}] name ${n}`);
  }
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(t => {
    if (window.localStorage.getItem('csg.prefs') === null) {
      window.localStorage.setItem(
        'csg.prefs',
        JSON.stringify({
          format: 'sprite-ui-prefs',
          version: 2,
          theme: t,
          workspace: 'easy',
        }),
      );
    }
  }, theme);
}

/** Seeds one project and opens it in the given workspace. */
async function openSeeded(
  page: Page,
  workspace: 'easy' | 'pro',
): Promise<void> {
  await page.goto('/#home');
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await seedProjects(page, [{id: 'qa-a11y', name: 'Axe Hero'}]);
  await page.goto('/#p=qa-a11y');
  await page.reload();
  await expect(
    workspace === 'pro'
      ? page.getByTestId('pro')
      : page.getByRole('region', {name: 'Customize'}),
  ).toBeVisible({timeout: 30_000});
}

async function toPro(page: Page): Promise<void> {
  await page
    .getByRole('radiogroup', {name: 'Workspace'})
    .getByRole('radio', {name: 'Pro'})
    .click();
  await expect(page.getByTestId('pro')).toBeVisible({timeout: 30_000});
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    let w: Watchers;
    test.beforeEach(async ({page}) => {
      w = await watch(page);
      await setTheme(page, theme);
    });

    test(`AC-UX-102.1 / AC-UX-102.2 / AC-UX-036.1: home has no axe violations (${theme}): empty, populated, menu open, delete dialog`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      const found: string[] = [];
      await openHome(page);
      await expect(page.getByRole('option').first()).toBeVisible({
        timeout: 30_000,
      });
      await audit(page, found, 'home empty');
      await seedProjects(page, [
        {id: 'qa-1', name: 'Axe Hero'},
        {id: 'qa-2', name: 'Axe Sidekick', pinned: true},
      ]);
      await page.reload();
      await expect(page.getByTestId('home')).toHaveAttribute(
        'data-ready',
        'true',
        {timeout: 30_000},
      );
      await expect(page.getByRole('option', {name: /^Axe Hero/})).toBeVisible({
        timeout: 30_000,
      });
      await audit(page, found, 'home populated');
      await page
        .getByRole('button', {name: /More actions for Axe/})
        .first()
        .click();
      await expect(page.getByRole('menu')).toBeVisible();
      await audit(page, found, 'home menu');
      await page.getByRole('menuitem', {name: 'Delete'}).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await audit(page, found, 'home delete dialog');
      expect(found).toEqual([]);
      await expectClean(page, w);
    });

    test(`AC-UX-102.1 / AC-UX-102.2: every wizard step and the discard dialog (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const found: string[] = [];
      await openHome(page);
      await startWizardFromHome(page);
      for (let i = 0; i < 8; i++) {
        await expect(
          page.getByRole('heading', {
            name: `Step ${i + 1} of 8: ${WIZARD_TITLES[i]}`,
          }),
        ).toBeVisible();
        await audit(page, found, `wizard step ${i + 1}`);
        if (i === 0) await page.getByRole('radio', {name: /Chibi/}).click();
        if (i < 7) {
          await page.getByRole('button', {name: 'Next', exact: true}).click();
        }
      }
      await page.getByRole('button', {name: 'Close wizard'}).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await audit(page, found, 'wizard discard dialog');
      expect(found).toEqual([]);
      await expectClean(page, w);
    });

    test(`AC-UX-102.1 / AC-UX-102.2: each Easy tab (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const found: string[] = [];
      await openSeeded(page, 'easy');
      const tabs = page
        .getByRole('region', {name: 'Customize'})
        .getByRole('tab');
      const count = await tabs.count();
      expect(count).toBeGreaterThanOrEqual(7);
      for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        const name = (await tab.textContent())?.trim() ?? `tab ${i}`;
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await audit(page, found, `easy ${name}`);
      }
      expect(found).toEqual([]);
      await expectClean(page, w);
    });

    test(`AC-UX-036.1: Pro default, each inspector tab and the dock tabs (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const found: string[] = [];
      await openSeeded(page, 'easy');
      await toPro(page);
      await audit(page, found, 'pro default');
      const inspector = page
        .getByRole('complementary', {name: 'Inspector'})
        .getByRole('tablist', {name: 'Inspector sections'})
        .getByRole('tab');
      const n = await inspector.count();
      expect(n).toBe(5);
      for (let i = 0; i < n; i++) {
        const tab = inspector.nth(i);
        const name = (await tab.textContent())?.trim() ?? `tab ${i}`;
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await audit(page, found, `pro inspector ${name}`);
      }
      const dock = page
        .getByRole('region', {name: 'Dock'})
        .getByRole('tablist', {name: 'Dock views'})
        .getByRole('tab');
      const d = await dock.count();
      expect(d).toBe(3);
      for (let i = 0; i < d; i++) {
        const tab = dock.nth(i);
        const name = (await tab.textContent())?.trim() ?? `tab ${i}`;
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await audit(page, found, `pro dock ${name}`);
      }
      expect(found).toEqual([]);
      await expectClean(page, w);
    });

    test(`AC-UX-036.1 / AC-UX-102.1: export dialog, settings, palette, help and diagnostics (${theme})`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const found: string[] = [];
      await openSeeded(page, 'easy');

      await page
        .getByRole('region', {name: 'Actions'})
        .getByRole('button', {name: 'Export', exact: true})
        .click();
      await expect(page.getByTestId('export-dialog')).toBeVisible();
      await audit(page, found, 'export dialog (opening)');
      await expect(page.getByTestId('export-start')).toBeEnabled({
        timeout: 60_000,
      });
      await audit(page, found, 'export dialog (ready)');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('export-dialog')).toHaveCount(0);

      await page.getByRole('button', {name: 'Settings'}).click();
      await expect(page.getByRole('dialog', {name: 'Settings'})).toBeVisible();
      await audit(page, found, 'settings');
      await page.keyboard.press('Escape');

      await page.keyboard.press('Control+k');
      await expect(page.getByRole('combobox')).toBeVisible();
      await audit(page, found, 'palette');
      await page.keyboard.press('Escape');

      await page.getByRole('button', {name: /^Renderer: /}).click();
      await expect(
        page.getByRole('dialog', {name: 'Diagnostics'}),
      ).toBeVisible();
      await audit(page, found, 'diagnostics');
      expect(found).toEqual([]);
      await expectClean(page, w);
    });

    test(`AC-UX-036.1: help overlay (${theme})`, async ({page}) => {
      const found: string[] = [];
      await openSeeded(page, 'easy');
      await page.getByRole('button', {name: 'Help and shortcuts'}).click();
      await expect(
        page.getByRole('dialog', {name: 'Keyboard shortcuts'}),
      ).toBeVisible();
      await audit(page, found, 'help');
      await page.keyboard.press('Escape');

      expect(found).toEqual([]);
    });
  });
}
