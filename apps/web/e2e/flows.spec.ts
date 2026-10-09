import {readFileSync} from 'node:fs';
import {expect, test} from '@playwright/test';
import type {Locator, Page} from '@playwright/test';
import {
  badAccessibleNames,
  FIXTURE,
  expectClean,
  finishWizard,
  openHome,
  pickStyle,
  openSeededEasy,
  qaShot,
  renderWith,
  seedProjects,
  readZip,
  startWizardFromHome,
  watch,
  WIZARD_TITLES,
} from './fixtures/qa';

test.use({viewport: {width: 1440, height: 900}});

const workspaceRadio = (page: Page, which: 'Easy' | 'Pro') =>
  page
    .getByRole('radiogroup', {name: 'Workspace'})
    .getByRole('radio', {name: which});

const undoButton = (page: Page) =>
  page.getByRole('button', {name: /^Undo(: |$)/});

/** Clicks the first not-yet-selected option of the first listbox on the active Easy tab. */
async function pickOtherTile(page: Page): Promise<void> {
  const list = page
    .getByRole('region', {name: 'Customize'})
    .getByRole('listbox')
    .first();
  const states = await list
    .getByRole('option')
    .evaluateAll(els => els.map(e => e.getAttribute('aria-selected')));
  const index = states.findIndex((s, i) => i > 0 && s !== 'true');
  expect(index, 'a selectable tile').toBeGreaterThan(0);
  const tile = list.getByRole('option').nth(index);
  await tile.click();
  await expect(tile).toHaveAttribute('aria-selected', 'true');
}

/** Switches the Easy tab by name. */
async function easyTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', {name, exact: true}).click();
  await expect(page.getByRole('tab', {name, exact: true})).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function exportOnce(page: Page) {
  const start = page.getByTestId('export-start');
  await expect(start).toBeEnabled({timeout: 60_000});
  const downloadPromise = page.waitForEvent('download', {timeout: 120_000});
  await start.click();
  const download = await downloadPromise;
  await expect(page.getByTestId('export-done')).toBeVisible({timeout: 180_000});
  const path = await download.path();
  return {download, bytes: readFileSync(path)};
}

for (const style of ['Realistic', 'Chibi'] as const) {
  test(`M3 exit flow (${style}): home, wizard, Easy edit, Pro, randomize, export, reload to the lineup`, async ({
    page,
  }, info) => {
    test.setTimeout(420_000);
    const w = await watch(page);
    const tag = `${info.project.name}-${style.toLowerCase()}`;
    const name = `QA ${style}`;

    await openHome(page);
    await qaShot(page, `${tag}-01-home`);
    await startWizardFromHome(page);
    await pickStyle(page, style);
    await qaShot(page, `${tag}-02-wizard-style`);
    await finishWizard(page, name);
    await expect(page.getByRole('region', {name: 'Customize'})).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('textbox', {name: 'Project name'})).toHaveValue(
      name,
    );
    await qaShot(page, `${tag}-03-easy-fresh`);

    // Easy edit: equip hair, change a swatch, apply a body shape.
    await easyTab(page, 'Hair');
    await pickOtherTile(page);
    const row = page
      .getByRole('region', {name: 'Customize'})
      .getByRole('radiogroup', {name: /^Color: /});
    const sw = await row
      .getByRole('radio')
      .evaluateAll(els => els.map(e => e.getAttribute('aria-checked')));
    const swIndex = sw.findIndex((c, i) => i > 1 && c !== 'true');
    const swatch = row.getByRole('radio').nth(swIndex);
    await swatch.click();
    await expect(swatch).toBeChecked();
    await easyTab(page, 'Body');
    const cards = page
      .getByRole('radiogroup', {name: 'Body shape'})
      .getByRole('radio');
    const cs = await cards.evaluateAll(els =>
      els.map(e => e.getAttribute('aria-checked')),
    );
    const shape = cards.nth(cs.findIndex(c => c !== 'true'));
    await shape.click();
    await expect(shape).toBeChecked();
    await qaShot(page, `${tag}-04-easy-edited`);
    const undoLabel = await undoButton(page).getAttribute('aria-label');
    expect(undoLabel).toMatch(/^Undo: ./);

    // Switch to Pro: same state, Mod+Z undoes across the switch.
    await workspaceRadio(page, 'Pro').click();
    await expect(page.getByTestId('pro')).toBeVisible({timeout: 30_000});
    const proUndo = page
      .getByRole('complementary', {name: 'Inspector'})
      .getByRole('button', {name: /^Undo/});
    await expect(proUndo).toHaveAttribute('aria-label', undoLabel ?? '');
    await qaShot(page, `${tag}-05-pro`);
    await page.getByRole('tab', {name: 'Anatomy'}).click();
    await page.getByRole('tab', {name: 'Anatomy'}).focus();
    await page.keyboard.press('Control+z');
    await expect(proUndo).not.toHaveAttribute('aria-label', undoLabel ?? '');
    await page.keyboard.press('Control+Shift+z');
    await expect(proUndo).toHaveAttribute('aria-label', undoLabel ?? '');

    // Randomize everything (Pro library footer), one undo step.
    await page
      .getByRole('complementary', {name: 'Part library'})
      .getByRole('button', {name: 'Randomize'})
      .click();
    await page.getByRole('menuitem', {name: 'Everything'}).click();
    await expect(proUndo).toHaveAttribute('aria-label', /Randomize/i);
    await qaShot(page, `${tag}-06-randomized`);

    // Export a sheet from inside the Pro view.
    await page
      .getByRole('complementary', {name: 'Inspector'})
      .getByRole('button', {name: 'Export', exact: true})
      .click();
    // PRODUCT BUG (reported): a wizard-made character has no animations, so the plan reads
    // "0 frames" and the export fails with EXP_INVALID_SETTINGS. Soft-assert it and carry on.
    await expect(page.getByTestId('export-dialog')).toContainText('frames', {
      timeout: 60_000,
    });
    const plan = (await page.getByTestId('export-dialog').textContent()) ?? '';
    expect
      .soft(plan, 'export plan has frames to render')
      .not.toMatch(/(^|\D)0 frames/);
    if (/(^|\D)0 frames/.test(plan)) {
      await page.keyboard.press('Escape');
    } else {
      const {download, bytes} = await exportOnce(page);
      await qaShot(page, `${tag}-07-export-done`);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);
      const entries = readZip(bytes);
      const names = entries.map(e => e.name);
      const png = entries.find(e => e.name.endsWith('.png'));
      expect(png, `sheet PNG in ${names.join(', ')}`).toBeDefined();
      expect([...(png?.data.subarray(0, 8) ?? [])]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const aseprite = entries.find(
        e => e.name.endsWith('.json') && !e.name.endsWith('manifest.json'),
      );
      expect(aseprite, 'Aseprite JSON').toBeDefined();
      const ase = JSON.parse(aseprite?.data.toString('utf8') ?? '{}') as Record<
        string,
        unknown
      >;
      expect(ase['frames']).toBeDefined();
      expect(ase['meta']).toBeDefined();
      expect(names.some(n => n.endsWith('.manifest.json'))).toBe(true);
      expect(names).toContain('CREDITS.txt');
    }

    // Reload: the saved character is on the home lineup.
    await page.keyboard.press('Escape');
    await page.goto('/#home');
    await page.reload();
    await expect(page.getByTestId('home')).toHaveAttribute(
      'data-ready',
      'true',
      {timeout: 30_000},
    );
    const saved = page.getByRole('option', {
      name: new RegExp(`^${name}, .*saved`),
    });
    await expect(saved).toBeVisible({timeout: 30_000});
    await qaShot(page, `${tag}-08-home-after-reload`);
    expect(await badAccessibleNames(page)).toEqual([]);

    await expectClean(page, w);
  });
}

/** Presses Tab until `target` has focus (fails after `max` presses). */
async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test('AC-UX-101.1 / AC-UX-036.2: keyboard-only flow from a fresh profile through the wizard, Easy edits, Pro and back home', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const w = await watch(page);
  await page.goto('/#home');
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  // Fresh profile: New character has focus (AC-UX-072.1).
  await expect(page.getByTestId('home-new')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', {name: 'Step 1 of 8: Style'}),
  ).toBeFocused({timeout: 30_000});

  // A choice on every step: Randomize this step (a button) where offered, then Next.
  const next = page.getByRole('button', {name: 'Next', exact: true});
  for (let i = 1; i < 8; i++) {
    if (i >= 2) {
      await tabTo(
        page,
        page.getByRole('button', {name: 'Randomize this step'}),
      );
      await page.keyboard.press('Enter');
    }
    await tabTo(page, next);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', {
        name: `Step ${i + 1} of 8: ${WIZARD_TITLES[i]}`,
      }),
    ).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await page.keyboard.type('Keys');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#p=[A-Za-z0-9_-]+$/, {timeout: 10_000});
  await expect(page.getByRole('region', {name: 'Customize'})).toBeVisible({
    timeout: 30_000,
  });

  // Easy: a tile on the Hair tab, a swatch, then the Body shape cards.
  const hairTab = page.getByRole('tab', {name: 'Hair', exact: true});
  await tabTo(page, page.locator('[role="tab"][tabindex="0"]'));
  for (let i = 0; i < 8; i++) {
    if (await hairTab.evaluate(el => el === document.activeElement)) break;
    await page.keyboard.press('ArrowRight');
  }
  await expect(hairTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(hairTab).toHaveAttribute('aria-selected', 'true');
  const list = page
    .getByRole('region', {name: 'Customize'})
    .getByRole('listbox')
    .first();
  const current = list.locator('[role="option"][tabindex="0"]');
  await tabTo(page, current);
  const before = await list
    .getByRole('option')
    .evaluateAll(els => els.map(e => e.getAttribute('aria-selected')));
  // The wizard randomised this slot: step away from the selection, whichever end it is at.
  const atEnd = before[before.length - 1] === 'true';
  await page.keyboard.press(atEnd ? 'ArrowLeft' : 'ArrowRight');
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      list
        .getByRole('option')
        .evaluateAll(els => els.map(e => e.getAttribute('aria-selected'))),
    )
    .not.toEqual(before);

  const row = page
    .getByRole('region', {name: 'Customize'})
    .getByRole('radiogroup', {name: /^Color: /});
  await tabTo(page, row.locator('[role="radio"][tabindex="0"]'));
  const sw0 = await row
    .getByRole('radio')
    .evaluateAll(els => els.map(e => e.getAttribute('aria-checked')));
  const swAtEnd = sw0[sw0.length - 1] === 'true';
  await page.keyboard.press(swAtEnd ? 'ArrowLeft' : 'ArrowRight');
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      row
        .getByRole('radio')
        .evaluateAll(els => els.map(e => e.getAttribute('aria-checked'))),
    )
    .not.toEqual(sw0);
  await expect(page.getByRole('button', {name: /^Undo: /})).toBeVisible();

  // Switch to Pro with the shortcut, change a clip choice is covered by the Animation tab.
  await page.keyboard.press('Control+Alt+p');
  await expect(page.getByTestId('pro')).toBeVisible({timeout: 30_000});
  await expect(
    page.getByRole('radiogroup', {name: 'Workspace'}).getByRole('radio', {
      name: 'Pro',
    }),
  ).toBeChecked();
  await page.keyboard.press('Alt+Shift+3');
  await expect(page.getByRole('tab', {name: 'Anatomy'})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Alt+Shift+5');
  await expect(page.getByRole('tab', {name: 'Animation'})).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Back home through the command palette (no pointer).
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('home');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByRole('option', {name: /^Keys, /})).toBeVisible({
    timeout: 30_000,
  });
  await expectClean(page, w);
});

const exportButton = (page: Page) =>
  page
    .getByRole('region', {name: 'Actions'})
    .getByRole('button', {name: 'Export', exact: true});

test('AC-EXP-025.1: 128 px cells, scale 8 and 9 columns (9216 px) are refused with EXP_TOO_LARGE before any frame renders', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const w = await watch(page);
  await openHome(page);
  await seedProjects(page, [
    {
      id: 'qa-large',
      name: 'Large',
      doc: {
        render: renderWith({size: 128, frames: 9}),
        export: {
          ...(FIXTURE as unknown as {export: Record<string, unknown>}).export,
          scales: [8],
          maxColumns: 9,
        },
      },
    },
  ]);
  await openSeededEasy(page, 'qa-large');
  await exportButton(page).click();
  const alert = page.getByRole('dialog').getByRole('alert');
  await expect(alert).toContainText('EXP_TOO_LARGE', {timeout: 60_000});
  await expect(page.getByTestId('export-start')).toBeDisabled();
  await expect(page.getByTestId('export-progress-text')).toHaveCount(0);
  await expectClean(page, w);
});

test('AC-EXP-021.1 / AC-EXP-021.2 / AC-EXP-021.3: an asset with unknown commercial use asks first, Cancel exports nothing, confirming writes WARNINGS; CC0 assets ask nothing', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const w = await watch(page);
  let unknown = false;
  await page.route('**/packs/quaternius-ubc/manifest.json', async route => {
    const res = await route.fetch();
    if (!unknown) return route.fulfill({response: res});
    const m = (await res.json()) as {license: Record<string, unknown>};
    m.license = {...m.license, commercialUse: 'unknown'};
    return route.fulfill({
      response: res,
      body: JSON.stringify(m),
      headers: {...res.headers(), 'content-length': undefined as never},
    });
  });
  await openHome(page);
  await seedProjects(page, [
    {
      id: 'qa-lic',
      name: 'Licence',
      doc: {render: renderWith({size: 32, frames: 2})},
    },
  ]);

  // AC-EXP-021.2: only CC0 with known use: no dialog, the export just runs.
  await openSeededEasy(page, 'qa-lic');
  await exportButton(page).click();
  await expect(page.getByTestId('export-start')).toBeEnabled({timeout: 60_000});
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('licence-confirm')).toHaveCount(0);
  await expect(page.getByTestId('export-done')).toBeVisible({timeout: 120_000});

  // AC-EXP-021.1: unknown commercial use lists "Unknown license" and renders nothing yet.
  unknown = true;
  let downloads = 0;
  page.on('download', () => downloads++);
  await openSeededEasy(page, 'qa-lic');
  await exportButton(page).click();
  await expect(page.getByTestId('export-start')).toBeEnabled({timeout: 60_000});
  await page.getByTestId('export-start').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Unknown license', {timeout: 30_000});
  await expect(dialog).toContainText('quaternius-ubc/');
  await qaShot(page, 'licence-dialog');
  await expect(page.getByTestId('export-progress-text')).toHaveCount(0);
  await page.getByTestId('licence-cancel').click();
  await expect(page.getByTestId('export-start')).toBeVisible();
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);

  // AC-EXP-021.3: confirmed, CREDITS.txt repeats the warning.
  const dl = page.waitForEvent('download', {timeout: 120_000});
  await page.getByTestId('export-start').click();
  await page.getByTestId('licence-confirm').click();
  const file = await (await dl).path();
  await expect(page.getByTestId('export-done')).toBeVisible({timeout: 120_000});
  const credits = readZip(readFileSync(file)).find(
    e => e.name === 'CREDITS.txt',
  );
  expect(credits?.data.toString('utf8')).toMatch(
    /WARNINGS[\s\S]*LICENSE_UNKNOWN/,
  );
  await expectClean(page, w);
});
