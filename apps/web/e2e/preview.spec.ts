import {writeFileSync} from 'node:fs';
import {expect, test} from '@playwright/test';
import type {Browser, Page} from '@playwright/test';

const SHOT_DIR = process.env['CSG_SHOT_DIR'];

/**
 * Counts pixels that differ from the top-left (background) pixel of a PNG, decoded in a
 * scratch page without CSP. The badge overlay is about 1.5k pixels; a character is far more.
 */
async function foregroundPixels(
  browser: Browser,
  png: Buffer,
): Promise<number> {
  const scratch = await browser.newPage();
  try {
    return await scratch.evaluate(async b64 => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) return 0;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 4; i < d.length; i += 4) {
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) n++;
      }
      return n;
    }, png.toString('base64'));
  } finally {
    await scratch.close();
  }
}

async function openPreview(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      (window as unknown as {__csp: string[]}).__csp ??= [];
      (window as unknown as {__csp: string[]}).__csp.push(
        `${e.violatedDirective} ${e.blockedURI.replace(/[0-9a-f-]{36}/, '<id>')} ${e.sourceFile}:${e.lineNumber} ${e.sample}`,
      );
    });
  });
  page.on('console', msg => {
    if (/content security policy|trusted type/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible();
  await expect(page.locator('.preview-stage')).toHaveAttribute(
    'data-status',
    'ready',
    {timeout: 60_000},
  );
  return violations;
}

test('AC-GEN-002.1: badge reports the expected backend', async ({
  page,
}, info) => {
  await openPreview(page);
  const expected = info.project.metadata['expectedBackend'] as string;
  await expect(page.getByTestId('renderer-badge')).toHaveAttribute(
    'data-backend',
    expected,
  );
});

test('AC-CMP-036.1: default character renders and animates between seek times', async ({
  page,
  browser,
}, info) => {
  await openPreview(page);
  const canvas = page.getByTestId('preview-canvas');
  const scrub = page.getByTestId('scrubber');

  await scrub.fill('0');
  await page.waitForTimeout(300);
  const a = await canvas.screenshot();
  expect(await foregroundPixels(browser, a)).toBeGreaterThan(5000);

  await scrub.fill('1');
  await page.waitForTimeout(300);
  const b = await canvas.screenshot();
  if (SHOT_DIR) {
    writeFileSync(`${SHOT_DIR}/${info.project.name}-t0.png`, a);
    writeFileSync(`${SHOT_DIR}/${info.project.name}-t1.png`, b);
  }
  expect(a.equals(b)).toBe(false);

  if (SHOT_DIR) {
    await page.screenshot({path: `${SHOT_DIR}/${info.project.name}-idle.png`});
    await page.locator('select').selectOption({label: 'Walk'});
    await scrub.fill('0.4');
    await page.waitForTimeout(400);
    await page.screenshot({path: `${SHOT_DIR}/${info.project.name}-walk.png`});
    await page.getByRole('button', {name: 'Turn right'}).click();
    await page.getByRole('button', {name: 'Turn right'}).click();
    await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOT_DIR}/${info.project.name}-turn.png`});
  }
});

test('REQ-GEN-002: clip and direction controls work from the keyboard', async ({
  page,
}) => {
  await openPreview(page);
  const dir = page.getByTestId('direction');
  await expect(dir).toHaveText('E');
  await page.getByRole('button', {name: 'Turn right'}).focus();
  await page.keyboard.press('Enter');
  await expect(dir).toHaveText('NE');
  await page.getByRole('button', {name: 'Pause animation'}).click();
  await expect(
    page.getByRole('button', {name: 'Play animation'}),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('AC-GEN-010.2: loading and using the preview raises no CSP violation', async ({
  page,
}) => {
  const violations = await openPreview(page);
  await page.getByRole('button', {name: 'Turn right'}).click();
  await page.locator('select').selectOption({label: 'Walk'});
  await page.waitForTimeout(500);
  const csp = await page.evaluate(
    () => (window as unknown as {__csp?: string[]}).__csp ?? [],
  );
  expect([
    ...new Set([
      ...csp,
      ...violations.map(v => v.replace(/[0-9a-f-]{36}/g, '<id>')),
    ]),
  ]).toEqual([]);
});
