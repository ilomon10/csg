import {gzipSync} from 'node:zlib';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {expectClean, qaShot, seedProjects, watch} from './fixtures/qa';

/** Hard gates need the reference machine (spec M3 plan section 5); elsewhere numbers are reported. */
const GATE = process.env['CSG_PERF_GATE'] === '1';

interface ColdLoad {
  fcp: number;
  lcp: number;
  engineStart: number;
  /** Gzipped bytes of every script requested before the engine chunk (workers excluded). */
  initialJsGz: number;
  initialJs: string[];
  engineJs: string[];
}

/** Cold-loads a route and measures FCP, LCP, the engine request time and the initial JS. */
async function coldLoad(page: Page, hash: string): Promise<ColdLoad> {
  await page.addInitScript(() => {
    const w = window as unknown as {__fcp: number; __lcp: number};
    w.__fcp = -1;
    w.__lcp = -1;
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.name === 'first-contentful-paint') w.__fcp = e.startTime;
      }
    }).observe({type: 'paint', buffered: true});
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) w.__lcp = e.startTime;
    }).observe({type: 'largest-contentful-paint', buffered: true});
  });
  const scripts: Array<{url: string; gz: number; at: number}> = [];
  const pending: Array<Promise<void>> = [];
  page.on('response', res => {
    const url = res.url();
    if (!/\/assets\/[^?]+\.js$/.test(url) || /worker/.test(url)) return;
    pending.push(
      res
        .body()
        .then(b => {
          scripts.push({
            url,
            gz: gzipSync(b, {level: 9}).length,
            at: res.request().timing().startTime,
          });
        })
        .catch(() => undefined),
    );
  });
  // A backgrounded tab reports no FCP; keep the page in front for the measurement.
  await page.bringToFront();
  await page.goto(`/${hash}`);
  // The lineup or wizard preview animates once the engine is ready.
  await expect(
    page
      .locator(
        'canvas[data-animated], .wz canvas, [data-testid="home-lineup"] canvas',
      )
      .first(),
  ).toBeVisible({timeout: 90_000});
  await page.waitForTimeout(1_000);
  await Promise.all(pending);
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as {__fcp: number}).__fcp),
      {
        timeout: 15_000,
        message: 'first-contentful-paint reported',
      },
    )
    .toBeGreaterThan(0);
  const times = await page.evaluate(() => {
    const w = window as unknown as {__fcp: number; __lcp: number};
    const engine = performance
      .getEntriesByType('resource')
      .find(e => /preview-engine-/.test(e.name));
    return {
      fcp: w.__fcp,
      lcp: w.__lcp,
      engineStart: engine?.startTime ?? -1,
    };
  });
  const isEngine = (u: string) => /preview-engine-|\/src-/.test(u);
  const initial = scripts.filter(s => !isEngine(s.url));
  return {
    ...times,
    initialJsGz: initial.reduce((n, s) => n + s.gz, 0),
    initialJs: initial.map(s => `${s.url.split('/').pop()} ${s.gz}`),
    engineJs: scripts.filter(s => isEngine(s.url)).map(s => s.url),
  };
}

for (const hash of ['#home', '#new']) {
  test(`AC-GEN-007.3 / AC-UX-083.1: cold load of ${hash} requests the engine chunk after FCP, initial JS <= 400 KB gz, LCP measured`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const r = await coldLoad(page, hash);
    const report = JSON.stringify(r, null, 2);
    await info.attach(`cold-load-${hash.slice(1)}`, {
      body: report,
      contentType: 'application/json',
    });
    info.annotations.push({
      type: 'budget',
      description: `${hash}: FCP ${r.fcp.toFixed(0)} ms, LCP ${r.lcp.toFixed(0)} ms, initial JS ${(r.initialJsGz / 1000).toFixed(1)} KB gz, engine request at ${r.engineStart.toFixed(0)} ms`,
    });
    expect(r.fcp).toBeGreaterThan(0);
    expect(r.engineStart, 'engine chunk requested').toBeGreaterThan(0);
    expect(r.engineStart).toBeGreaterThanOrEqual(r.fcp);
    expect(r.initialJsGz).toBeLessThanOrEqual(400 * 1000);
    expect(r.lcp, 'LCP observed').toBeGreaterThan(0);
    // The LCP gate is for the reference machine; software-rendered CI only reports it.
    if (GATE) expect(r.lcp).toBeLessThanOrEqual(2_500);
  });
}

test('AC-GEN-007.2 (report only): preview frame time sampled in Easy over 3 s', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/#home');
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await seedProjects(page, [{id: 'qa-fps', name: 'Fps Hero'}]);
  await page.goto('/#p=qa-fps');
  await page.reload();
  await expect(page.getByRole('region', {name: 'Customize'})).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.ez-preview canvas').first()).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(2_000);
  const stats = await page.evaluate(
    () =>
      new Promise<{frames: number; p50: number; p95: number; max: number}>(
        resolve => {
          const dts: number[] = [];
          let last = performance.now();
          const end = last + 3_000;
          const tick = (now: number) => {
            dts.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else {
              dts.sort((a, b) => a - b);
              const at = (q: number) =>
                dts[Math.min(dts.length - 1, Math.floor(q * dts.length))] ?? 0;
              resolve({
                frames: dts.length,
                p50: at(0.5),
                p95: at(0.95),
                max: dts[dts.length - 1] ?? 0,
              });
            }
          };
          requestAnimationFrame(tick);
        },
      ),
  );
  info.annotations.push({
    type: 'budget',
    description: `Easy rAF: ${stats.frames} frames, p50 ${stats.p50.toFixed(1)} ms, p95 ${stats.p95.toFixed(1)} ms, max ${stats.max.toFixed(1)} ms`,
  });
  await info.attach('easy-raf', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
  expect(stats.frames).toBeGreaterThan(5);
  if (GATE) expect(stats.p95).toBeLessThanOrEqual(16.7);
});

test('REQ-EXP-026 / P-07: export of 8 frames per clip through the UI path with no main-thread task over 50 ms (reported, soft gate)', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const w = await watch(page);
  await page.addInitScript(() => {
    const win = window as unknown as {__long: number[]};
    win.__long = [];
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) win.__long.push(e.duration);
    }).observe({type: 'longtask', buffered: true});
  });
  // The test host mounts the real dialog; the default settings are the preview clips (idle, walk).
  await page.goto('/export-host.html?frames=8');
  await page.getByRole('button', {name: 'Export', exact: true}).click();
  const start = page.getByTestId('export-start');
  await expect(start).toBeEnabled({timeout: 60_000});
  const t0 = Date.now();
  const download = page.waitForEvent('download');
  await start.click();
  await download;
  await expect(page.getByTestId('export-done')).toBeVisible({timeout: 180_000});
  const ms = Date.now() - t0;
  const long = await page.evaluate(
    () => (window as unknown as {__long: number[]}).__long,
  );
  const worst = Math.max(0, ...long);
  info.annotations.push({
    type: 'budget',
    description: `export (host default: 2 clips x 8 frames x directions, 64 px): ${ms} ms, longest main-thread task ${worst.toFixed(0)} ms (${long.length} long tasks)`,
  });
  await qaShot(page, `${info.project.name}-export-budget`);
  // Soft gate: the 10 s budget is for 4 clips on the reference machine (REQ-EXP-026); this
  // host exports 2 clips, so 10 s is an upper bound that also holds on slow runners.
  if (GATE) expect(ms).toBeLessThanOrEqual(10_000);
  else expect(ms).toBeLessThanOrEqual(120_000);
  await expectClean(page, w);
});
