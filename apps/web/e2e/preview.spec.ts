import {writeFileSync} from 'node:fs';
import {expect, test} from '@playwright/test';
import type {Browser, Page, TestInfo} from '@playwright/test';
import {openProjectIn} from './fixtures/qa';

const SPRITE =
  '[data-testid="home-lineup"] .home-slot[data-selected="true"] canvas';
const SHOT_DIR = process.env['CSG_SHOT_DIR'];
/** The Pro viewport canvas (the real CharacterViewport, not the home lineup). */
const STAGE = '.cv__stage canvas';
const timeline = (page: Page) => page.getByRole('group', {name: 'Timeline'});
const playButton = (page: Page) =>
  timeline(page).getByRole('button', {name: /^(Play|Pause)$/});

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
async function canvasLayout(
  page: Page,
  selector: string = SPRITE,
): Promise<CanvasLayout> {
  return page.locator(selector).evaluate(el => {
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
  await page.goto('/#home');
  // Home renders its lineup through the engine; the selected sprite is the 64 px cell canvas.
  await expect(page.locator(SPRITE)).toBeVisible({timeout: 90_000});
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
  await expect(page.locator('.shell-badge')).toHaveAttribute(
    'data-backend',
    expected,
    {timeout: 90_000},
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
  await page.waitForTimeout(500); // the row and scale transition (300 ms) has ended
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

test('AC-CMP-036.1: the default character renders as crisp pixel art in the Pro viewport and animates between frames', async ({
  page,
  browser,
}, info) => {
  await openProjectIn(page, 'pro');
  await skipOnSoftwareWebGpu(page, info);
  const canvas = page.locator(STAGE).first();
  await page.waitForTimeout(300);
  const scale = Math.round((await canvasLayout(page, STAGE)).scale);
  let first = await canvas.screenshot();
  let ra = await analyze(browser, first, scale);
  // Under load the first frames can still be blank: wait for the character to be drawn.
  for (let i = 0; i < 40 && ra.foreground <= 1000; i++) {
    await page.waitForTimeout(250);
    first = await canvas.screenshot();
    ra = await analyze(browser, first, scale);
  }
  if (SHOT_DIR) writeFileSync(`${SHOT_DIR}/${info.project.name}-t0.png`, first);
  expect(ra.foreground).toBeGreaterThan(1000);
  // Pixel art: every sprite pixel is a flat scale x scale block (no filtering) and the
  // toon-shaded cell has far fewer colours than the pixels it has.
  expect(ra.distinctColours).toBeLessThan(1000);
  expect(ra.nonUniformBlocks).toBe(0);

  // It animates: playing samples differ. (Seeking the dock timeline does not drive the
  // viewport yet: the dock keeps its own frame, see the report.)
  const frames = new Set<string>();
  for (let i = 0; i < 6; i++) {
    frames.add((await canvas.screenshot()).toString('base64'));
    await page.waitForTimeout(170);
  }
  expect(frames.size).toBeGreaterThan(1);
});

test('REQ-ANM-018 / AC-ANM-018.2: "Show export frames" is on by default, keyboard operable, and the preview keeps playing when toggled', async ({
  page,
}) => {
  await openProjectIn(page, 'pro');
  const toggle = timeline(page).getByRole('button', {
    name: 'Show export frames',
  });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  await expect(playButton(page)).toHaveText('Pause');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('REQ-GEN-002: clip and direction controls work from the keyboard', async ({
  page,
}) => {
  await openProjectIn(page, 'pro');
  const dir = page.getByTestId('direction');
  const before = await dir.textContent();
  await page.getByRole('button', {name: 'Turn right'}).focus();
  await page.keyboard.press('Enter');
  await expect(dir).not.toHaveText(before ?? '');
  const walk = page
    .getByRole('group', {name: 'Animation'})
    .getByRole('button', {name: 'Walk'});
  await walk.focus();
  await page.keyboard.press('Enter');
  await expect(walk).toHaveAttribute('aria-pressed', 'true');
  const pause = page.getByRole('button', {name: 'Play or pause animation'});
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await pause.click();
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
});

test('AC-GEN-010.2: loading and using the preview raises no CSP violation', async ({
  page,
}) => {
  const violations = await openPreview(page);
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

test('REQ-ANM-018 / AC-ANM-017.1 / AC-ANM-018.4: Play after Pause and a seek near the clip end continues from the sought frame', async ({
  page,
}) => {
  await openProjectIn(page, 'pro');
  await playButton(page).filter({hasText: 'Pause'}).click();
  const slider = timeline(page).getByRole('slider', {name: 'Timeline'});
  await slider.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '7');
  const count = Number(await slider.getAttribute('aria-valuemax'));
  expect(count).toBe(8);
  // Record every playhead value from here on, so a loaded runner cannot skip past the check.
  await slider.evaluate(el => {
    const seen: string[] = [el.getAttribute('aria-valuenow') ?? ''];
    (window as unknown as {__frames?: string[]}).__frames = seen;
    new MutationObserver(() => {
      const v = el.getAttribute('aria-valuenow') ?? '';
      if (seen[seen.length - 1] !== v) seen.push(v);
    }).observe(el, {attributes: true, attributeFilter: ['aria-valuenow']});
  });
  await playButton(page).filter({hasText: 'Play'}).click();
  await expect(playButton(page)).toHaveText('Pause');
  // 8 export frames played at the clip's fps: from frame 7 the playhead must show 8, then wrap
  // to 1. A seek that ignores the fps mapping resumes at another frame (or wraps early).
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as {__frames?: string[]}).__frames?.length ?? 0,
        ),
      {timeout: 5000},
    )
    .toBeGreaterThanOrEqual(3);
  const frames = await page.evaluate(
    () => (window as unknown as {__frames?: string[]}).__frames ?? [],
  );
  expect(frames.slice(0, 3)).toEqual(['7', '8', '1']);
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
});

test('REQ-ANM-018 / AC-ANM-018.1: the Pro dock timeline drives the viewport (seek, step, play/pause)', async ({
  page,
}) => {
  await openProjectIn(page, 'pro');
  const slider = timeline(page).getByRole('slider', {name: 'Timeline'});
  const summary = page.getByTestId('viewport-summary');
  // Pausing from the viewport pauses the timeline: one shared play state.
  await page.getByRole('button', {name: 'Play or pause animation'}).click();
  await expect(playButton(page)).toHaveText('Play');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await expect(summary).toContainText('frame 1 of');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  // The viewport shows the sought frame, and stays there (paused).
  await expect(summary).toContainText('frame 3 of', {timeout: 5000});
  await page.waitForTimeout(500);
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  // Playing from the timeline resumes the viewport.
  await playButton(page).click();
  await expect(
    page.getByRole('button', {name: 'Play or pause animation'}),
  ).toHaveAttribute('aria-pressed', 'true');
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

test('AC-UX-003.1: Pixel mode keeps the 64x64 backing store at an integer zoom; the 3D view fills the stage when the engine offers it', async ({
  page,
}) => {
  await openProjectIn(page, 'pro');
  const zoomIn = page.getByRole('button', {name: 'Zoom in'});
  for (let i = 0; i < 16 && (await zoomIn.isEnabled()); i++) {
    await zoomIn.click();
  }
  const zoom = Number(
    ((await page.getByTestId('zoom').textContent()) ?? '').replace('×', ''),
  );
  expect(Number.isInteger(zoom)).toBe(true);
  expect(zoom).toBeGreaterThanOrEqual(2);
  const l = await canvasLayout(page, STAGE);
  expect([l.cellW, l.cellH]).toEqual([64, 64]);
  expect(l.pixelated).toBe(true);
  expect(Math.abs(l.cssW - 64 * zoom)).toBeLessThan(0.01);
  expect(Math.abs(l.cssH - 64 * zoom)).toBeLessThan(0.01);

  const mode3d = page
    .getByRole('group', {name: 'View mode'})
    .getByRole('button', {name: '3D'});
  // 3D mode is real (setViewMode, orbit, frameCharacter): the toggle must be enabled.
  await expect(mode3d).toBeEnabled({timeout: 30_000});
  const stage = page.getByTestId('viewport-stage');
  await mode3d.click();
  await expect(stage).toHaveAttribute('data-view', '3d');
  const box = await stage.boundingBox();
  const l3 = await canvasLayout(page, STAGE);
  expect(Math.abs(l3.cssW - (box?.width ?? 0))).toBeLessThan(2);
  expect(l3.pixelated).toBe(false);
  // The renderer applies the device-pixel resize on its next frame, after the CSS size; on a
  // slow software-GPU runner that can land after the first read, so wait for it.
  await expect
    .poll(async () => (await canvasLayout(page, STAGE)).cellW, {
      timeout: 20_000,
    })
    .toBeGreaterThan(64);
  await page
    .getByRole('group', {name: 'View mode'})
    .getByRole('button', {name: 'Pixel'})
    .click();
  await expect(stage).toHaveAttribute('data-view', 'pixel');
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
});
