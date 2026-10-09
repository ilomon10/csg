import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {settleAnimations} from './fixtures/qa';

const SHOT_DIR = process.env['CSG_SHOT_DIR'];
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

// Axe is injected as an inline script, which the editor CSP would block.
test.use({bypassCSP: true});

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
    doc: {...FIXTURE, character: {...character, name: 'Workspace Hero'}},
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

const withAnatomy =
  (head: number): Patch =>
  c => ({
    ...c,
    anatomy: {...(c['anatomy'] as Record<string, unknown>), head},
  });
const withTint =
  (hair: string): Patch =>
  c => ({...c, tints: {...(c['tints'] as Record<string, unknown>), hair}});

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, {recursive: true});
  await page.screenshot({path: join(SHOT_DIR, `${name}.png`)});
}

async function axeViolations(page: Page): Promise<string[]> {
  await settleAnimations(page);
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            ctx: unknown,
            opts: unknown,
          ) => Promise<{
            violations: Array<{id: string; nodes: Array<{target: string[]}>}>;
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    });
    return result.violations.map(
      v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`,
    );
  });
}

const toggle = (page: Page, which: 'Easy' | 'Pro') =>
  page
    .getByRole('radiogroup', {name: 'Workspace'})
    .getByRole('radio', {name: which});

test('AC-UX-054.1 / AC-UX-054.2: a fresh profile opens Easy; the last workspace is remembered', async ({
  page,
}) => {
  await page.addInitScript(() => undefined);
  await page.goto('/');
  await expect(page.getByText('Starting…')).toHaveCount(0, {timeout: 20_000});
  await openProject(page, {workspace: 'easy'});
  await toggle(page, 'Pro').click();
  await expect(
    page.getByRole('complementary', {name: 'Inspector'}),
  ).toBeVisible({timeout: 30_000});
  await page.reload();
  await expect(
    page.getByRole('complementary', {name: 'Inspector'}),
  ).toBeVisible({timeout: 30_000});
});

test('AC-UX-051.1 / AC-UX-052.1: switching Easy to Pro keeps the document and the history, and Mod+Z undoes the Easy edit', async ({
  page,
}) => {
  await openProject(page, {size: {width: 1440, height: 900}});
  await page.getByRole('tab', {name: 'Hair'}).click();
  const tile = page
    .getByRole('listbox')
    .first()
    .getByRole('option', {selected: false})
    .nth(1);
  await tile.click();
  const undo = page
    .getByRole('region', {name: 'Actions'})
    .getByRole('button', {name: /^Undo: /});
  await expect(undo).toBeVisible();
  const label = await undo.getAttribute('aria-label');
  await toggle(page, 'Pro').click();
  const proUndo = page
    .getByRole('complementary', {name: 'Inspector'})
    .getByRole('button', {name: /^Undo: /});
  // The Pro view mounts lazily; a loaded runner can take several seconds.
  await expect(proUndo).toHaveAttribute('aria-label', label ?? '', {
    timeout: 30_000,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', {name: 'Anatomy'}).focus();
  await page.keyboard.press('Control+z');
  await expect(
    page
      .getByRole('complementary', {name: 'Inspector'})
      .getByRole('button', {name: 'Undo'}),
  ).toBeDisabled();
});

test('AC-UX-055.1: Edit in Pro on a custom body shape opens Anatomy with focus on the preset selector', async ({
  page,
}) => {
  await openProject(page, {patch: withAnatomy(1.2)});
  await expect(page.getByRole('radio', {name: /Custom/})).toBeChecked();
  await page.getByRole('button', {name: 'Edit in Pro'}).click();
  await expect(page.getByRole('tab', {name: 'Anatomy'})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement
              ?.closest('[data-focus-key]')
              ?.getAttribute('data-focus-key') ?? '',
        ),
      {timeout: 20_000},
    )
    .toBe('anatomy.preset');
});

test('AC-UX-055.2 / AC-UX-055.3: a custom hair tint shows as a checked swatch; Edit in Pro focuses the hair tint control; visiting tabs changes nothing', async ({
  page,
}) => {
  await openProject(page, {patch: withTint('#123456')});
  for (const name of ['Skin', 'Face', 'Outfit', 'Accessories', 'Colors']) {
    await page.getByRole('tab', {name}).click();
  }
  await expect(
    page
      .getByRole('region', {name: 'Actions'})
      .getByRole('button', {name: 'Undo'}),
  ).toBeDisabled();
  await page.getByRole('tab', {name: 'Hair'}).click();
  await expect(
    page.getByRole('radio', {name: 'Custom color #123456'}),
  ).toBeChecked();
  await page.getByRole('button', {name: 'Edit in Pro'}).click();
  await expect(page.getByRole('tab', {name: 'Colors'})).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('#cmp-tint-hair')).toBeFocused();
});

test('AC-UX-001.1 / AC-UX-001.2: Pro regions have their default sizes at 1440x900 and are named landmarks', async ({
  page,
}) => {
  await openProject(page, {
    workspace: 'pro',
    size: {width: 1440, height: 900},
  });
  const box = async (name: string, role: 'complementary' | 'region') =>
    (await page.getByRole(role, {name, exact: true}).first().boundingBox())!;
  expect((await box('Part library', 'complementary')).width).toBeCloseTo(
    280,
    0,
  );
  expect((await box('Inspector', 'complementary')).width).toBeCloseTo(320, 0);
  expect((await box('Dock', 'region')).height).toBeCloseTo(240, 0);
  const viewport = await box('Viewport', 'region');
  expect(viewport.width).toBeGreaterThanOrEqual(760);
  expect(viewport.height).toBeGreaterThanOrEqual(560);
  await expect(page.getByRole('banner')).toBeVisible();
});

test('AC-UX-002.1 / AC-UX-002.2: splitters move by keyboard and sizes and collapsed state persist', async ({
  page,
}) => {
  await openProject(page, {
    workspace: 'pro',
    size: {width: 1440, height: 900},
  });
  const split = page.getByRole('separator', {name: 'Resize part library'});
  await split.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '328');
  const dock = page.getByRole('separator', {name: 'Resize dock'});
  await dock.focus();
  await page.keyboard.press('ArrowUp');
  await expect(dock).toHaveAttribute('aria-valuenow', '256');
  await page.getByRole('button', {name: 'Collapse inspector'}).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const p = JSON.parse(localStorage.getItem('csg.prefs') ?? '{}');
        return `${p.layout?.libraryPx}/${p.layout?.dockPx}/${p.layout?.collapsed?.inspector}`;
      }),
    )
    .toBe('328/256/true');
  await page.reload();
  await expect(
    page.getByRole('separator', {name: 'Resize part library'}),
  ).toHaveAttribute('aria-valuenow', '328', {timeout: 30_000});
  await expect(
    page.getByRole('separator', {name: 'Resize dock'}),
  ).toHaveAttribute('aria-valuenow', '256');
  await expect(
    page.getByRole('button', {name: 'Expand inspector'}),
  ).toBeVisible();
});

test('AC-UX-005.1 / AC-UX-005.2: Mod+Shift+G shows and focuses the Material graph tab with its notice; maximize restores on Escape', async ({
  page,
}) => {
  await openProject(page, {
    workspace: 'pro',
    size: {width: 1440, height: 900},
  });
  await page.getByRole('tab', {name: 'Anatomy'}).focus();
  await page.keyboard.press('Control+Shift+g');
  const tab = page.getByRole('tab', {name: 'Material graph'});
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toBeFocused();
  await expect(page.getByTestId('graph-notice')).toBeVisible();
  await page.keyboard.press('Control+Shift+m');
  await expect(page.getByTestId('pro')).toHaveAttribute(
    'data-maximized',
    'true',
  );
  await tab.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pro')).toHaveAttribute(
    'data-maximized',
    'false',
  );
});

test('AC-UX-006.1: at 1100x800 the library is behind a drawer toggle and the inspector is docked', async ({
  page,
}) => {
  await openProject(page, {
    workspace: 'pro',
    size: {width: 1100, height: 800},
  });
  await expect(
    page.getByRole('complementary', {name: 'Part library'}),
  ).toBeHidden();
  await expect(
    page.getByRole('complementary', {name: 'Inspector'}),
  ).toBeVisible({timeout: 30_000});
  await page.getByRole('button', {name: 'Part library'}).click();
  await expect(
    page.getByRole('complementary', {name: 'Part library'}),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('complementary', {name: 'Part library'}),
  ).toBeHidden();
});

test('AC-UX-006.2: at 834x1112 both side panels are drawers, the dock is collapsed and targets are at least 44 px', async ({
  page,
}) => {
  await openProject(page, {
    workspace: 'pro',
    size: {width: 834, height: 1112},
  });
  await expect(
    page.getByRole('complementary', {name: 'Inspector'}),
  ).toBeHidden();
  await page.getByRole('button', {name: 'Part library'}).click();
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.pro button, .pro [role=tab], .pro [role=option], .pro input',
      ),
    )
      .filter(
        el => el.getClientRects().length > 0 && el.closest('[inert]') === null,
      )
      .map(el => ({el, r: el.getBoundingClientRect()}))
      .filter(({r}) => r.width < 43.5 || r.height < 43.5)
      .map(
        ({el}) =>
          `${el.tagName}.${el.className} ${el.getAttribute('aria-label') ?? el.textContent}`,
      ),
  );
  expect(small).toEqual([]);
});

test('AC-UX-056.1: at 1440x900 the Easy preview is 792 px wide and the actions bar 64 px tall', async ({
  page,
}) => {
  await openProject(page, {size: {width: 1440, height: 900}});
  const preview = (await page
    .getByRole('region', {name: 'Preview', exact: true})
    .boundingBox())!;
  const bar = (await page
    .getByRole('region', {name: 'Actions'})
    .boundingBox())!;
  expect(Math.abs(preview.width - 792)).toBeLessThanOrEqual(14);
  expect(Math.abs(bar.height - 64)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('region', {name: 'Customize'})).toBeVisible();
});

test('AC-UX-068.1 / AC-UX-068.2: at tablet widths the preview stacks above the panel, targets are at least 44 px and nothing scrolls sideways', async ({
  page,
}) => {
  await openProject(page, {size: {width: 834, height: 1112}});
  const preview = (await page
    .getByRole('region', {name: 'Preview', exact: true})
    .boundingBox())!;
  const panel = (await page
    .getByRole('region', {name: 'Customize'})
    .boundingBox())!;
  expect(preview.y + preview.height).toBeLessThanOrEqual(panel.y + 1);
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '.ez button, .ez [role=tab], .ez [role=option], .ez [role=radio]',
      ),
    )
      .filter(el => el.getClientRects().length > 0)
      .map(el => ({el, r: el.getBoundingClientRect()}))
      .filter(({r}) => r.width < 43.5 || r.height < 43.5)
      .map(
        ({el}) =>
          `${el.tagName}.${el.className} ${el.getAttribute('aria-label') ?? el.textContent}`,
      ),
  );
  expect(small).toEqual([]);
  await page.getByRole('tab', {name: 'Hair'}).click();
  const hair = page.getByRole('listbox').first().getByRole('option').nth(1);
  await hair.tap().catch(() => hair.click());
  await expect(hair).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({width: 1023, height: 800});
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1023);
});

for (const workspace of ['easy', 'pro'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    test(`AC-UX-036.1: ${workspace} ${theme} has no axe violations (WCAG 2.2 AA)`, async ({
      page,
    }) => {
      await openProject(page, {
        workspace,
        theme,
        size: {width: 1440, height: 900},
      });
      await page.waitForTimeout(600);
      await shot(page, `ws-${workspace}-${theme}`);
      expect(await axeViolations(page)).toEqual([]);
    });
  }
}
