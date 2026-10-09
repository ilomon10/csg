import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';
import {openProjectIn} from './fixtures/qa';

/** Spec 000 REQ-GEN-010 (amended 2026-10-09, M2-23s), byte for byte. */
const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; require-trusted-types-for 'script'; trusted-types csg-worker-url";

const PACKAGES = fileURLToPath(new URL('../../../packages', import.meta.url));

/** Records violation events and CSP/Trusted Types console messages from page start. */
async function watchViolations(page: Page): Promise<string[]> {
  const log: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as {__v: string[]}).__v = [];
    // Chromium has no `trustedTypes.getPolicyNames()`: record every policy that gets created.
    const policies: string[] = [];
    (window as unknown as {__policies: string[]}).__policies = policies;
    const tt = (
      window as unknown as {
        trustedTypes?: {createPolicy(n: string, r?: object): unknown};
      }
    ).trustedTypes;
    if (tt !== undefined) {
      const orig = tt.createPolicy.bind(tt);
      tt.createPolicy = (name, rules) => {
        const created = orig(name, rules);
        policies.push(name);
        return created;
      };
    }
    document.addEventListener('securitypolicyviolation', e => {
      (window as unknown as {__v: string[]}).__v.push(
        `${e.violatedDirective} ${e.blockedURI.slice(0, 40)} ${e.sample}`,
      );
    });
  });
  page.on('console', msg => {
    if (/content security policy|trusted type/i.test(msg.text())) {
      log.push(msg.text());
    }
  });
  return log;
}

/** Home renders its lineup through the engine; an animated canvas means the engine is live. */
async function ready(page: Page): Promise<void> {
  await page.goto('/#home');
  await expect(
    page.locator('[data-testid="home-lineup"] canvas[data-animated]').first(),
  ).toBeVisible({timeout: 90_000});
}

test('AC-GEN-010.1 / AC-GEN-014.4: the production index.html starts with the amended CSP meta', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const head = html.slice(html.indexOf('<head>') + 6);
  const elements = [
    ...head.matchAll(/<(meta|script|link|style|base)\b[^>]*>/g),
  ];
  const first = elements.find(m => !/^<meta\s+charset=/i.test(m[0]));
  expect(first?.[0]).toMatch(/^<meta\s+http-equiv="Content-Security-Policy"/);
  const content =
    /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
      first?.[0] ?? '',
    );
  expect(content?.[1]).toBe(CSP);
});

test('AC-GEN-014.1: selecting palettes in the Pro Render tab starts exactly one palette-lut worker through csg-worker-url, with no CSP or Trusted Types violation', async ({
  page,
}) => {
  const log = await watchViolations(page);
  const workers: string[] = [];
  page.on('worker', w => workers.push(w.url()));
  await openProjectIn(page, 'pro');
  await page
    .getByRole('complementary', {name: 'Inspector'})
    .getByRole('tab', {name: 'Render'})
    .click();
  const select = page
    .getByRole('group', {name: 'Render'})
    .getByLabel('Palette');
  await select.selectOption('pico-8');
  await expect(select).toHaveValue('pico-8');
  await expect
    .poll(() => workers.filter(u => /palette-lut/.test(u)).length, {
      timeout: 30_000,
    })
    .toBe(1);
  await select.selectOption('endesga-32');
  await expect(select).toHaveValue('endesga-32');
  await page.waitForTimeout(1_500);
  expect(workers.filter(u => /palette-lut/.test(u))).toHaveLength(1);
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as {__v: string[]}).__v),
  ).toEqual([]);
  expect(log).toEqual([]);
  // AC-GEN-014.1: every LUT was built in the worker, none on the main thread.
  const stage = page.getByTestId('viewport-stage');
  await expect(stage).toHaveAttribute('data-lut-main-builds', '0');
  await expect(stage).toHaveAttribute('data-lut-failures', '0');
  expect(
    Number(await stage.getAttribute('data-lut-worker-builds')),
  ).toBeGreaterThan(0);
});

test('AC-GEN-014.3 / AC-GEN-014.6: only csg-worker-url exists; default and duplicate policies and string sinks are blocked', async ({
  page,
}) => {
  await watchViolations(page);
  await ready(page);
  const names = await page.evaluate(
    () => (window as unknown as {__policies: string[]}).__policies,
  );
  const result = await page.evaluate(() => {
    const tt = (
      window as unknown as {
        trustedTypes: {
          createPolicy(n: string, r: object): unknown;
        };
      }
    ).trustedTypes;
    const throws = (fn: () => void): string => {
      try {
        fn();
        return 'no throw';
      } catch (e) {
        return (e as Error).name;
      }
    };
    return {
      defaultPolicy: throws(() => tt.createPolicy('default', {})),
      duplicate: throws(() => tt.createPolicy('csg-worker-url', {})),
      innerHTML: throws(() => {
        Reflect.set(document.createElement('div'), 'innerHTML', '<b>x</b>');
      }),
    };
  });
  expect(names).toEqual(['csg-worker-url']);
  expect(result.defaultPolicy).toBe('TypeError');
  expect(result.duplicate).toBe('TypeError');
  expect(result.innerHTML).toBe('TypeError');
  // These probes violate the policy by design (excluded from AC-GEN-010.2 counting).
  const events = await page.evaluate(
    () => (window as unknown as {__v: string[]}).__v,
  );
  expect(events.length).toBeGreaterThanOrEqual(2);
});

/** Source files of `packages/*` browser code, without tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      return name === 'node_modules' || name === 'test' || name === 'dist'
        ? []
        : sourceFiles(p);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

/** Static import specifiers of a built chunk, in source order (dynamic `import(` excluded). */
function staticImports(js: string): string[] {
  return [
    ...js.matchAll(
      /(?:^|[;}\s])(?:import|export)\s*(?:[^"'`;()]*?\bfrom\s*)?["'](\.\/[^"']+)["']/g,
    ),
  ].map(m => m[1] ?? '');
}

test('AC-GEN-014.6: the policy module is the first thing the entry graph runs; packages create no workers from URLs', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const src = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
  expect(src).toBeDefined();

  // Follow the entry's STATIC import graph in ES evaluation order (depth-first post-order:
  // a module's imports run before its body). Dynamic imports are not part of it.
  const sources = new Map<string, string>();
  const order: string[] = [];
  const visit = async (url: string): Promise<void> => {
    if (sources.has(url)) return;
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    const js = await res.text();
    sources.set(url, js);
    for (const spec of staticImports(js)) {
      await visit(new URL(spec, new URL(url, 'http://x')).pathname);
    }
    order.push(url);
  };
  const entryUrl = new URL(src ?? '', 'http://x').pathname;
  await visit(entryUrl);

  const policyIdx = order.findIndex(u =>
    (sources.get(u) ?? '').includes('createPolicy('),
  );
  expect(policyIdx).toBeGreaterThan(-1);
  const policyUrl = order[policyIdx] ?? '';
  const policySrc = sources.get(policyUrl) ?? '';
  const policyAt = policySrc.indexOf('createPolicy(');
  // Nothing evaluated before the policy (earlier chunks, or earlier in the same chunk) can
  // create roots, workers, canvases or load Zod's jitless config.
  const risky =
    /StrictMode|createRoot|jitless|new\s+(Shared)?Worker\s*\(|createElement\(\s*["']canvas/;
  for (const u of order.slice(0, policyIdx)) {
    expect(sources.get(u), u).not.toMatch(risky);
  }
  expect(policySrc.slice(0, policyAt)).not.toMatch(risky);
  // The app body (`#root` lookup) lives in the entry and runs after the policy.
  const entrySrc = sources.get(entryUrl) ?? '';
  expect(order.indexOf(entryUrl)).toBeGreaterThanOrEqual(policyIdx);
  if (policyUrl === entryUrl) {
    expect(policyAt).toBeLessThan(entrySrc.indexOf('Missing #root element'));
  }
  // Every dynamic import (view chunks, engine, canvases, workers) runs after the policy: none
  // sits in a chunk evaluated before it, nor earlier in the policy chunk.
  const dynamic = /\bimport\(\s*[`"']\.\//;
  for (const u of order.slice(0, policyIdx)) {
    expect(sources.get(u), u).not.toMatch(dynamic);
  }
  const dynInPolicyChunk = policySrc.search(dynamic);
  if (dynInPolicyChunk !== -1) expect(policyAt).toBeLessThan(dynInPolicyChunk);

  const offenders = readdirSync(PACKAGES).flatMap(pkg =>
    sourceFiles(join(PACKAGES, pkg, 'src')).filter(f =>
      /new\s+(Shared)?Worker\s*\(/.test(readFileSync(f, 'utf8')),
    ),
  );
  expect(offenders).toEqual([]);
});

test('AC-GEN-015.3: the worker script response carries the REQ-GEN-010 policy header (E2E static server)', async ({
  page,
  request,
}) => {
  await ready(page);
  // The allowlisted worker URL is the one the palette LUT worker is built to.
  const html = await (await request.get('/')).text();
  const entry = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  expect(entry).toBeTruthy();
  const urls = new Set<string>();
  const queue = [entry as string];
  while (queue.length > 0 && urls.size < 20) {
    const u = queue.pop() as string;
    if (urls.has(u)) continue;
    urls.add(u);
    const js = await (await request.get(u)).text();
    for (const m of js.matchAll(/assets\/([\w.-]+\.js)/g)) {
      queue.push(`/assets/${m[1]}`);
    }
  }
  const workerUrl = [...urls].find(u => /\.worker-[^/]*\.js$/.test(u));
  expect(workerUrl).toBeTruthy();
  const res = await request.get(workerUrl as string);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toBe(CSP);
  // Scoped to workers: ordinary assets and the document use the meta policy only.
  const other = await request.get(entry as string);
  expect(other.headers()['content-security-policy']).toBeUndefined();
});
