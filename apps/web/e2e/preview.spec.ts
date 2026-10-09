import {writeFileSync} from 'node:fs';
import {expect, test} from '@playwright/test';
import type {Browser, Page, TestInfo} from '@playwright/test';

const SHOT_DIR = process.env['CSG_SHOT_DIR'];

interface PixelReport {
  /** Pixels differing from the top-left background pixel. */
  foreground: number;
  /** Distinct colours when sampled once per sprite pixel (scale x scale block). */
  distinctColours: number;
  /** Blocks whose pixels are not all one colour (a blurred or fractional upscale). */
  nonUniformBlocks: number;
}

/**
 * Analyses a canvas screenshot, decoded in a scratch page without CSP. The canvas shows the
 * cell-sized buffer at an integer scale, so every `scale` x `scale` block must be one colour.
 */
async function analyze(
  browser: Browser,
  png: Buffer,
  scale: number,
): Promise<PixelReport> {
  const scratch = await browser.newPage();
  try {
    return await scratch.evaluate(
      async ({b64, scale}) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx)
          return {foreground: 0, distinctColours: 0, nonUniformBlocks: 0};
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const key = (i: number) => `${d[i]},${d[i + 1]},${d[i + 2]}`;
        const bg = key(0);
        let foreground = 0;
        for (let i = 0; i < d.length; i += 4) if (key(i) !== bg) foreground++;
        const colours = new Set<string>();
        let nonUniformBlocks = 0;
        for (let y = 0; y + scale <= c.height; y += scale) {
          for (let x = 0; x + scale <= c.width; x += scale) {
            const first = key((y * c.width + x) * 4);
            colours.add(first);
            let uniform = true;
            for (let dy = 0; dy < scale && uniform; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                if (key(((y + dy) * c.width + x + dx) * 4) !== first) {
                  uniform = false;
                  break;
                }
              }
            }
            if (!uniform) nonUniformBlocks++;
          }
        }
        return {
          foreground,
          distinctColours: colours.size,
          nonUniformBlocks,
        };
      },
      {b64: png.toString('base64'), scale},
    );
  } finally {
    await scratch.close();
  }
}

interface CanvasLayout {
  cellW: number;
  cellH: number;
  cssW: number;
  cssH: number;
  dpr: number;
  /** Device pixels per sprite pixel. */
  scale: number;
  pixelated: boolean;
}

/** Reads the preview canvas buffer size and its CSS box. */
async function canvasLayout(page: Page): Promise<CanvasLayout> {
  return page.getByTestId('preview-canvas').evaluate(el => {
    const canvas = el as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    return {
      cellW: canvas.width,
      cellH: canvas.height,
      cssW: r.width,
      cssH: r.height,
      dpr,
      scale: (r.width * dpr) / canvas.width,
      pixelated: getComputedStyle(canvas).imageRendering === 'pixelated',
    };
  });
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

interface AdapterReport {
  available: boolean;
  isFallbackAdapter?: boolean;
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

/** Reads the WebGPU adapter identity in-page; the webgpu project fails elsewhere if absent. */
async function adapterReport(page: Page): Promise<AdapterReport> {
  return page.evaluate(async () => {
    const gpu = (
      navigator as unknown as {
        gpu?: {requestAdapter(): Promise<Record<string, unknown> | null>};
      }
    ).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    if (!adapter) return {available: false};
    const info = (adapter['info'] ?? {}) as Record<string, string>;
    return {
      available: true,
      isFallbackAdapter: adapter['isFallbackAdapter'] === true,
      vendor: info['vendor'],
      architecture: info['architecture'],
      device: info['device'],
      description: info['description'],
    };
  });
}

/** True for CPU rasterizers (SwiftShader / llvmpipe / fallback adapters). */
function isSoftwareAdapter(r: AdapterReport): boolean {
  if (!r.available) return false;
  const text = [r.vendor, r.architecture, r.device, r.description]
    .join(' ')
    .toLowerCase();
  return (
    r.isFallbackAdapter === true || /swiftshader|llvmpipe|software/.test(text)
  );
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

/** Skips pixel assertions on a software WebGPU adapter (SwiftShader draws nothing). */
async function skipOnSoftwareWebGpu(page: Page, info: TestInfo): Promise<void> {
  if (info.project.metadata['expectedBackend'] !== 'webgpu') return;
  const report = await adapterReport(page);
  await info.attach('webgpu-adapter-info', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  const software = isSoftwareAdapter(report);
  if (software) {
    info.annotations.push({
      type: 'skipped-pixel-check',
      description: 'software WebGPU adapter (SwiftShader)',
    });
  }
  test.skip(
    software,
    'software WebGPU adapter (SwiftShader) renders blank: the pixel check needs a real GPU',
  );
}

test('AC-PIX-031.1: the canvas is the 64 px cell shown at an integer scale with pixelated rendering', async ({
  page,
}) => {
  await openPreview(page);
  const l = await canvasLayout(page);
  expect([l.cellW, l.cellH]).toEqual([64, 64]);
  expect(l.pixelated).toBe(true);
  expect(Number.isInteger(Math.round(l.scale * 1000) / 1000)).toBe(true);
  expect(l.scale).toBeGreaterThanOrEqual(1);
  expect(Math.abs(l.cssW * l.dpr - l.cellW * Math.round(l.scale))).toBeLessThan(
    0.01,
  );
  expect(Math.abs(l.cssH - l.cssW)).toBeLessThan(0.01);
});

test('AC-CMP-036.1: default character renders as crisp pixel art and animates between seek times', async ({
  page,
  browser,
}, info) => {
  await openPreview(page);
  await skipOnSoftwareWebGpu(page, info);
  const canvas = page.getByTestId('preview-canvas');
  const scrub = page.getByTestId('scrubber');
  const scale = Math.round((await canvasLayout(page)).scale);

  await scrub.fill('0');
  await page.waitForTimeout(300);
  const a = await canvas.screenshot();
  if (SHOT_DIR) writeFileSync(`${SHOT_DIR}/${info.project.name}-t0.png`, a);
  const ra = await analyze(browser, a, scale);
  expect(ra.foreground).toBeGreaterThan(5000);
  // Pixel art: every sprite pixel is a flat scale x scale block (no filtering), and the
  // toon-shaded cell (palette none) has far fewer colours than the 4096 pixels it has.
  expect(ra.distinctColours).toBeLessThan(1000);
  expect(ra.nonUniformBlocks).toBe(0);

  await scrub.fill('1');
  await page.waitForTimeout(300);
  const b = await canvas.screenshot();
  if (SHOT_DIR) {
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

test('REQ-ANM-018: "Show export frames" is on by default, keyboard operable, and keeps playing when toggled', async ({
  page,
}) => {
  await openPreview(page);
  const toggle = page.getByRole('checkbox', {name: 'Show export frames'});
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  await expect(
    page.getByRole('button', {name: 'Pause animation'}),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
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

test('REQ-ANM-018: Play after Pause and a seek continues from the seek time (no restart)', async ({
  page,
}) => {
  await openPreview(page);
  await page.getByRole('button', {name: 'Pause animation'}).click();
  const scrub = page.getByTestId('scrubber');
  await scrub.fill('1.2');
  await expect(scrub).toHaveValue('1.2');
  await page.getByRole('button', {name: 'Play animation'}).click();
  await expect(
    page.getByRole('button', {name: 'Pause animation'}),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(400);
  const t = Number(await scrub.inputValue());
  // Idle is 2.5 s long: a restart would read about 0.4 s, a resume about 1.6 s.
  expect(t).toBeGreaterThan(1.2);
  expect(t).toBeLessThan(2.4);
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
});

test('packs are served with explicit content types, nosniff and 404 for unknown paths', async ({
  request,
}) => {
  const manifest = await request.get('/packs/quaternius-ual/clips.json');
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()['content-type']).toContain('application/json');
  expect(manifest.headers()['x-content-type-options']).toBe('nosniff');
  const missing = await request.get('/packs/quaternius-ual/no-such-file.glb');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['x-content-type-options']).toBe('nosniff');
  const traversal = await request.get('/packs/..%2F..%2Fpackage.json');
  expect(traversal.status()).toBe(404);
});
