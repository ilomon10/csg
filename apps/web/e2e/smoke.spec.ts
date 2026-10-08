import {expect, test} from '@playwright/test';

test('GEN smoke: app shows the heading', async ({page}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', {name: 'Character Sprite Generator'}),
  ).toBeVisible();
});
