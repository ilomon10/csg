import {expect, test} from '@playwright/test';

test('GEN smoke: app shows the heading', async ({page}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {name: 'Character Sprite Generator'}),
  ).toBeVisible();
});

test('AC-GEN-007.3: on a cold load the engine chunk is requested after first contentful paint', async ({
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
  await page.goto('/');
  await expect(page.locator('.preview-stage')).toHaveAttribute(
    'data-status',
    'ready',
    {timeout: 60_000},
  );
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
  expect(engineStart).toBeGreaterThan(0);
  expect(engineStart).toBeGreaterThanOrEqual(fcp);
});
