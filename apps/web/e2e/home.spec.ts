import {mkdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

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

/** Opens home on a fresh profile and waits until the saved list was read. */
async function openHome(page: Page): Promise<void> {
  await page.goto('/#home');
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
}

/** Writes valid project records straight into the `csg` database, then reloads. */
async function seedAndReload(
  page: Page,
  names: readonly string[],
  pinned: readonly string[] = [],
): Promise<void> {
  await openHome(page);
  const records = names.map((name, i) => ({
    format: 'sprite-project-record',
    version: 1,
    meta: {
      projectId: `seed-${i}`,
      name,
      lastEditedAt: 1_700_000_000_000 + (names.length - i) * 86_400_000,
      pinned: pinned.includes(name),
    },
    doc: {...FIXTURE, character: {...FIXTURE.character, name}},
  }));
  await page.evaluate(async recs => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('csg', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      for (const r of recs) tx.objectStore('projects').put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, records);
  await page.reload();
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true');
}

/** Counts the records of one IndexedDB store. */
async function countStore(page: Page, store: string): Promise<number> {
  return page.evaluate(async name => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('csg', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const n = await new Promise<number>((resolve, reject) => {
      const req = db.transaction(name).objectStore(name).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return n;
  }, store);
}

const options = (page: Page) => page.getByRole('option');
const selectedName = async (page: Page): Promise<string> =>
  (await page
    .locator('[role="option"][aria-selected="true"]')
    .getAttribute('aria-label')) ?? '';

test('AC-UX-085.1 / AC-UX-072.1: a fresh profile lists exactly the presets, shows the empty text and focuses New', async ({
  page,
}) => {
  await openHome(page);
  await expect(page.getByTestId('home-empty')).toHaveText(
    'No saved characters yet. Create one or start from a preset.',
  );
  await expect(page.getByTestId('home-new')).toBeFocused();
  await expect(options(page).first()).toBeVisible({timeout: 30_000});
  const names = await options(page).evaluateAll(els =>
    els.map(el => el.getAttribute('aria-label')),
  );
  expect(names.length).toBeGreaterThanOrEqual(6);
  expect(names.every(n => n?.endsWith('preset'))).toBe(true);
  await expect(page.getByTestId('home-primary')).toHaveText(
    'Start from this preset',
  );
  await expect(page.getByRole('button', {name: /More actions/})).toHaveCount(0);
});

test('AC-UX-083.1 / AC-UX-081.1: the engine chunk is requested after FCP and the selected character animates', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as {__fcp: number}).__fcp = -1;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-contentful-paint') {
          (window as unknown as {__fcp: number}).__fcp = e.startTime;
        }
      }
    }).observe({type: 'paint', buffered: true});
  });
  await page.bringToFront();
  await openHome(page);
  // At FCP every lineup position is a skeleton or a still, never empty (REQ-UX-081).
  await expect(page.getByTestId('home-lineup')).toBeVisible();
  await expect(
    page.locator('[data-testid="home-lineup"] canvas[data-animated]').first(),
  ).toBeVisible({timeout: 90_000});
  const fcp = await page.evaluate(
    () => (window as unknown as {__fcp: number}).__fcp,
  );
  expect(fcp).toBeGreaterThan(0);
  const engineStart = await page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .find(e => /preview-engine-/.test(e.name))?.startTime ?? -1,
  );
  expect(engineStart).toBeGreaterThanOrEqual(fcp);
});

test('AC-GEN-002.1: the renderer badge reports the expected backend once home renders', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await openHome(page);
  await expect(page.locator('.shell-badge')).toHaveAttribute(
    'data-backend',
    info.project.metadata['expectedBackend'] as string,
    {timeout: 90_000},
  );
});

test('AC-UX-073.1 / AC-UX-074.1: the selected character is centred at an integer scale and a click recentres the row within 300 ms', async ({
  page,
}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await openHome(page);
  await expect(options(page).first()).toBeVisible({timeout: 30_000});
  await page.waitForTimeout(600); // layout and the first scale transition settle
  const lineup = page.getByTestId('home-lineup');
  const scale = Number(await lineup.getAttribute('data-scale'));
  const box = await lineup.boundingBox();
  expect(scale).toBe(Math.max(2, Math.floor((box!.height * 0.5) / 64)));
  const slot = (id: string) => page.locator(`.home-slot[data-index="${id}"]`);
  const figWidth = async () =>
    (await slot('0').locator('.home-fig').boundingBox())!.width;
  // The scale transition may still run on a loaded machine: poll until it settles.
  await expect.poll(figWidth, {timeout: 5000}).toBeCloseTo(64 * scale, 0);
  const fig = await slot('0').locator('.home-fig').boundingBox();
  expect(
    Math.abs(fig!.x + fig!.width / 2 - (box!.x + box!.width / 2)),
  ).toBeLessThanOrEqual(1);
  const row = page.getByTestId('home-row');
  const duration = await row.evaluate(
    el => getComputedStyle(el).transitionDuration,
  );
  expect(
    parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000),
  ).toBeLessThanOrEqual(300);
  await slot('3').click();
  await expect(options(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(450);
  const moved = await slot('3').locator('.home-fig').boundingBox();
  expect(
    Math.abs(moved!.x + moved!.width / 2 - (box!.x + box!.width / 2)),
  ).toBeLessThanOrEqual(1);
  expect(moved!.width).toBeCloseTo(64 * scale, 0);
  const neighbour = await slot('2').locator('.home-fig').boundingBox();
  expect(neighbour!.width).toBeCloseTo(64 * (scale - 1), 0);
});

test('AC-UX-084.1: under reduced motion the row has no transition and nothing animates', async ({
  page,
}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await openHome(page);
  await expect(options(page).first()).toBeVisible({timeout: 30_000});
  const durations = await page
    .getByTestId('home-row')
    .evaluate(el => getComputedStyle(el).transitionDuration);
  expect(durations.split(',').every(d => parseFloat(d) === 0)).toBe(true);
  await page.keyboard.press('Tab');
  await options(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('canvas[data-animated="true"]')).toHaveCount(0);
});

test('AC-UX-075.1 / AC-UX-075.2 / AC-UX-075.3: arrows, End and Enter work from the keyboard, the last avatar is fully visible and avatars never change', async ({
  page,
}) => {
  await page.setViewportSize({width: 1024, height: 800});
  await seedAndReload(
    page,
    Array.from({length: 30}, (_, i) => `Hero ${String(i).padStart(2, '0')}`),
  );
  await expect(options(page).first()).toBeVisible();
  const first = options(page).first();
  await expect(first).toHaveAttribute('aria-label', 'Hero 00, 1 of 38, saved');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(options(page).nth(1)).toBeFocused();
  await expect(options(page).nth(1)).toHaveAttribute(
    'aria-label',
    'Hero 01, 2 of 38, saved',
  );
  await page.keyboard.press('End');
  const last = options(page).last();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  // The strip scrolls the selection into view (smooth scrolling takes a moment).
  await expect
    .poll(async () => {
      const strip = (await page.getByRole('listbox').boundingBox())!;
      const box = (await last.boundingBox())!;
      return (
        box.x >= strip.x - 1 && box.x + box.width <= strip.x + strip.width + 1
      );
    })
    .toBe(true);
  // Avatars are stills: the same bytes across samples.
  const srcs = async () =>
    page
      .locator('.home-avatar')
      .evaluateAll(els =>
        Object.fromEntries(
          els.map(e => [
            e.closest('[data-id]')?.getAttribute('data-id') ?? '',
            (e as HTMLImageElement).currentSrc,
          ]),
        ),
      );
  const a = await srcs();
  await page.waitForTimeout(1000);
  const b = await srcs();
  // Avatars that were there stay byte-identical (new ones may still arrive from the renderer).
  for (const [id, src] of Object.entries(a)) expect(b[id]).toBe(src);
});

test('AC-UX-076.1: Enter on the New tile opens the wizard', async ({page}) => {
  await openHome(page);
  await page.getByTestId('home-new').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#new$/);
});

test('AC-UX-072.1 / AC-UX-078.1 / AC-UX-079.2 / AC-UX-079.3: saved order, Edit opens the project, Pin persists and Delete removes records after confirmation', async ({
  page,
}) => {
  await seedAndReload(page, ['Knight', 'Mage', 'Rogue'], ['Rogue']);
  // The presets arrive with the catalog; the position counts include them.
  await expect(options(page)).toHaveCount(11);
  const labels = () =>
    options(page).evaluateAll(els =>
      els.slice(0, 3).map(e => e.getAttribute('aria-label')),
    );
  // Rogue is pinned; Knight was edited most recently of the rest.
  expect(await labels()).toEqual([
    'Rogue, 1 of 11, saved',
    'Knight, 2 of 11, saved',
    'Mage, 3 of 11, saved',
  ]);
  await expect(page.getByTestId('home-primary')).toHaveText('Edit');

  // Pin Mage: it moves into the pinned group and stays selected; the order survives a reload.
  await options(page).nth(2).click();
  await page.getByRole('button', {name: /More actions for Mage/}).click();
  await page.getByRole('menuitem', {name: 'Pin'}).click();
  await expect(page.getByText('Pinned "Mage"')).toBeVisible();
  await expect(
    page.locator('[role="option"][aria-selected="true"]'),
  ).toHaveAttribute('aria-label', /^Mage,/);
  await page.reload();
  await expect(options(page).first()).toBeVisible();
  // The pinned group is ordered by edit date: Mage (edited after Rogue) comes first.
  expect((await labels())[0]).toMatch(/^Mage/);

  // Delete with confirmation: Cancel is the default focus.
  await options(page).nth(0).click();
  await page.getByRole('button', {name: /More actions for Mage/}).click();
  await page.getByRole('menuitem', {name: 'Delete'}).click();
  await expect(page.getByRole('button', {name: 'Cancel'})).toBeFocused();
  await page.getByRole('button', {name: 'Cancel'}).click();
  expect(await countStore(page, 'projects')).toBe(3);
  await page.getByRole('button', {name: /More actions for Mage/}).click();
  await page.getByRole('menuitem', {name: 'Delete'}).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', {name: 'Delete'})
    .click();
  await expect.poll(() => countStore(page, 'projects')).toBe(2);

  // Edit opens the selected project.
  await page.getByTestId('home-primary').click();
  await expect(page).toHaveURL(/#p=seed-\d$/);
});

test('AC-UX-078.2 / AC-UX-078.3: Start from this preset saves a project named after the preset with the preset camera and opens it', async ({
  page,
  request,
}, info) => {
  await openHome(page);
  await expect(options(page).first()).toBeVisible({timeout: 30_000});
  const label = (await options(page).first().getAttribute('aria-label')) ?? '';
  const name = label.split(',')[0] ?? '';
  const id = (await options(page).first().getAttribute('data-id'))!.replace(
    'preset:',
    '',
  );
  const presetJson = (await (
    await request.get(`/packs/quaternius-ubc/presets/characters/${id}.json`)
  ).json()) as {camera?: string; character: unknown};
  // AC-UX-078.2 bounds activation to the project being in IndexedDB (500 ms in the spec), not
  // the page navigation or the Playwright round trips. Stamp the click in its own task and poll
  // IndexedDB in-page, so the measured interval is the one the AC defines.
  const savedAfterMs = await page.evaluate(async () => {
    const button = document.querySelector<HTMLElement>(
      '[data-testid="home-primary"]',
    );
    const started = performance.now();
    button?.click();
    for (;;) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('csg', 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const req = db.transaction('projects').objectStore('projects').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (count > 0) return performance.now() - started;
      if (performance.now() - started > 10_000) return Infinity;
      await new Promise(r => setTimeout(r, 10));
    }
  });
  await expect(page).toHaveURL(/#p=[A-Za-z0-9-]+$/);
  // The 500 ms budget is a reference-machine gate (as in budgets.spec.ts): software-rendered
  // lineups in parallel workers starve the main thread, so elsewhere the value is only reported.
  info.annotations.push({
    type: 'budget',
    description: `AC-UX-078.2: click to project in IndexedDB ${savedAfterMs.toFixed(0)} ms`,
  });
  expect(savedAfterMs).toBeLessThan(
    process.env['CSG_PERF_GATE'] === '1' ? 500 : 5000,
  );
  const saved = await page.evaluate(async () => {
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
    return all as Array<{
      meta: {name: string};
      doc: {character: unknown; render: {camera: {preset: string}}};
    }>;
  });
  expect(saved).toHaveLength(1);
  expect(saved[0]?.meta.name).toBe(name);
  expect(saved[0]?.doc.render.camera.preset).toBe(presetJson.camera ?? 'side');
  expect(saved[0]?.doc.character).toEqual(presetJson.character);
});

test('AC-UX-077.1: the Random preset tile selects a preset without creating a project', async ({
  page,
}) => {
  await openHome(page);
  await expect(options(page).first()).toBeVisible({timeout: 30_000});
  await page.getByTestId('home-random').click();
  expect(await selectedName(page)).toMatch(/preset$/);
  expect(await countStore(page, 'projects')).toBe(0);
});

test('AC-UX-071.1: screenshots of home in dark and light with the selection moved', async ({
  page,
}, info) => {
  test.skip(
    SHOT_DIR === undefined,
    'screenshots are written only when CSG_SHOT_DIR is set',
  );
  mkdirSync(SHOT_DIR!, {recursive: true});
  await page.setViewportSize({width: 1440, height: 900});
  await seedAndReload(page, ['Rowan', 'Mira', 'Juno']);
  await expect(page.locator('canvas[data-animated]').first()).toBeVisible({
    timeout: 90_000,
  });
  await page.waitForTimeout(8000);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      t => document.documentElement.setAttribute('data-theme', t),
      theme,
    );
    await options(page).first().focus();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${SHOT_DIR}/home-${theme}-first-${info.project.name}.png`,
    });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${SHOT_DIR}/home-${theme}-moved-${info.project.name}.png`,
    });
    await page.keyboard.press('Home');
  }
});
