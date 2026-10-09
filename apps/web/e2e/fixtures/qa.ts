/**
 * Shared helpers of the M3 QA specs (`a11y`, `flows`, `budgets`): CSP and network watchers, axe,
 * a ZIP reader, project seeding and the wizard drivers. Test code only.
 */
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {expect} from '@playwright/test';
import type {Page} from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** Where the exit-flow screenshots go (`apps/web/test-results/qa/`). */
export const QA_DIR = resolve(
  fileURLToPath(new URL('../../test-results/qa', import.meta.url)),
);

/** Saves a full-page screenshot under {@link QA_DIR}. */
export async function qaShot(page: Page, name: string): Promise<void> {
  mkdirSync(QA_DIR, {recursive: true});
  const path = join(QA_DIR, `${name}.png`);
  try {
    await page.screenshot({path});
  } catch {
    // CDP occasionally refuses a capture while the page swaps frames; one retry is enough.
    await page.waitForTimeout(300);
    await page.screenshot({path});
  }
}

/** A valid project document (parts-schema fixture; the e2e runner cannot import the package). */
export const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../../packages/parts-schema/test/fixtures/project-v1.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as {character: Record<string, unknown>};

export interface Watchers {
  /** `securitypolicyviolation` events and CSP / Trusted Types console errors. */
  csp: string[];
  /** Requests that are not same-origin, not GET, or carry a body. */
  badRequests: string[];
  /** Every request URL seen (same-origin included), for reporting. */
  all: string[];
}

/** Starts the CSP violation watcher and the network watcher on a page (call before `goto`). */
export async function watch(page: Page): Promise<Watchers> {
  const w: Watchers = {csp: [], badRequests: [], all: []};
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      const win = window as unknown as {__csp?: string[]};
      (win.__csp ??= []).push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      );
    });
  });
  page.on('console', msg => {
    if (/content security policy|trusted type/i.test(msg.text())) {
      w.csp.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    if (/content security policy|trusted type/i.test(err.message)) {
      w.csp.push(err.message);
    }
  });
  const origin = 'http://localhost:4173'; // baseURL of playwright.config.ts
  page.on('request', r => {
    const url = r.url();
    w.all.push(`${r.method()} ${url}`);
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (!url.startsWith(origin) || r.method() !== 'GET' || r.postData()) {
      w.badRequests.push(`${r.method()} ${url}`);
    }
  });
  return w;
}

/** Collects the page-side CSP events recorded by {@link watch} into the watcher. */
export async function collectCsp(page: Page, w: Watchers): Promise<string[]> {
  const inPage = await page
    .evaluate(() => (window as unknown as {__csp?: string[]}).__csp ?? [])
    .catch(() => []);
  return [...new Set([...w.csp, ...inPage])];
}

/** Asserts zero CSP violations and only same-origin GET requests without a body. */
export async function expectClean(page: Page, w: Watchers): Promise<void> {
  expect(await collectCsp(page, w), 'CSP violations').toEqual([]);
  expect(w.badRequests, 'non-same-origin / non-GET requests').toEqual([]);
}

/**
 * Waits until no finite CSS animation or transition is running, so axe measures settled colors
 * (a menu fading in reads as low contrast mid-fade on a slow CI runner). Infinite animations,
 * such as a loading spinner, are ignored.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every(
          a =>
            a.playState !== 'running' ||
            a.effect?.getComputedTiming().iterations === Infinity,
        ),
    undefined,
    {timeout: 10_000},
  );
}

/**
 * Runs axe and returns one line per violation. The default tag set is the project's gate
 * (WCAG 2.0, 2.1 and 2.2 A/AA, as in `workspaces.spec.ts`), including label-in-name (2.5.3).
 */
export async function axeViolations(page: Page): Promise<string[]> {
  await settleAnimations(page);
  await page.evaluate(AXE);
  return page.evaluate(
    async tags => {
      const axe = (
        window as unknown as {
          axe: {
            run: (
              ctx: unknown,
              opts: unknown,
            ) => Promise<{
              violations: Array<{
                id: string;
                nodes: Array<{target: string[]; html: string}>;
              }>;
            }>;
          };
        }
      ).axe;
      const result = await axe.run(document, {
        runOnly: {type: 'tag', values: tags},
      });
      return result.violations.map(
        v =>
          `${v.id}: ${v.nodes
            .slice(0, 4)
            .map(n => `${n.target.join(' ')} <${n.html.slice(0, 90)}>`)
            .join(' | ')}`,
      );
    },
    ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  );
}

const NAME_BAD = /\.(glb|png|webp)$|^builtin:|^user:/;

/**
 * AC-UX-102.2: the accessible name of every option, radio and button in the tile, card,
 * swatch and avatar groups is non-empty and not a file name or ID. Returns offending names.
 */
export async function badAccessibleNames(page: Page): Promise<string[]> {
  return page.evaluate(re => {
    const bad = new RegExp(re);
    const out: string[] = [];
    const groups = document.querySelectorAll(
      '[role="listbox"], [role="radiogroup"]',
    );
    for (const g of groups) {
      for (const el of g.querySelectorAll(
        '[role="option"], [role="radio"], button',
      )) {
        const labelledBy = el.getAttribute('aria-labelledby');
        const name =
          el.getAttribute('aria-label') ??
          (labelledBy
            ? labelledBy
                .split(/\s+/)
                .map(id => document.getElementById(id)?.textContent ?? '')
                .join(' ')
            : (el.textContent ?? ''));
        if (name.trim() === '' || bad.test(name.trim())) {
          out.push(`${el.tagName}[${el.getAttribute('role')}] "${name}"`);
        }
      }
    }
    return out;
  }, NAME_BAD.source);
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Minimal ZIP reader over the central directory (stored and deflate entries). */
export function readZip(buf: Buffer): ZipEntry[] {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    out.push({
      name,
      data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Writes a valid project record straight into the `csg` database. */
export async function seedProjects(
  page: Page,
  records: ReadonlyArray<{
    id: string;
    name: string;
    pinned?: boolean;
    /** Shallow overrides of the project document (for example `render`, `export`). */
    doc?: Record<string, unknown>;
  }>,
): Promise<void> {
  const recs = records.map((r, i) => ({
    format: 'sprite-project-record',
    version: 1,
    meta: {
      projectId: r.id,
      name: r.name,
      lastEditedAt: 1_700_000_000_000 + (records.length - i) * 86_400_000,
      pinned: r.pinned ?? false,
    },
    doc: {
      ...FIXTURE,
      ...r.doc,
      character: {...FIXTURE.character, name: r.name},
    },
  }));
  await page.evaluate(async list => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('csg', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      for (const r of list) tx.objectStore('projects').put(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, recs);
}

export const WIZARD_TITLES = [
  'Style',
  'Species',
  'Body shape',
  'Face',
  'Hair',
  'Outfit',
  'Colors',
  'Name and finish',
] as const;

/** Opens home on the current profile and waits until the saved list was read. */
export async function openHome(page: Page): Promise<void> {
  await page.goto('/#home');
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
}

/** Opens the wizard from the Home "New character" button. */
export async function startWizardFromHome(page: Page): Promise<void> {
  await page.getByTestId('home-new').click();
  await expect(page).toHaveURL(/#new$/);
  await expect(
    page.getByRole('heading', {name: 'Step 1 of 8: Style'}),
  ).toBeVisible({timeout: 30_000});
}

/** Picks a style on wizard step 1. */
export async function pickStyle(
  page: Page,
  style: 'Realistic' | 'Chibi',
): Promise<void> {
  await page.getByRole('radio', {name: new RegExp(style)}).click();
}

/** Walks the wizard from step 1 to Finish with a name; clicks Next on every step. */
export async function finishWizard(page: Page, name: string): Promise<string> {
  for (let i = 1; i < 8; i++) {
    await page.getByRole('button', {name: 'Next', exact: true}).click();
    await expect(
      page.getByRole('heading', {
        name: `Step ${i + 1} of 8: ${WIZARD_TITLES[i]}`,
      }),
    ).toBeFocused();
  }
  await page.getByRole('textbox', {name: 'Name'}).fill(name);
  await page.getByRole('button', {name: 'Finish', exact: true}).click();
  await expect(page).toHaveURL(/#p=([A-Za-z0-9_-]+)$/, {timeout: 10_000});
  return /#p=([A-Za-z0-9_-]+)$/.exec(page.url())?.[1] ?? '';
}

/** Render settings of the fixture project with the default idle clip (frames and cell size set). */
export function renderWith(opts: {
  size: number;
  frames: number;
}): Record<string, unknown> {
  const base = (FIXTURE as unknown as {render: Record<string, unknown>}).render;
  return {
    ...base,
    resolution: {width: opts.size, height: opts.size},
    animations: [
      {
        clipId: 'builtin:quaternius-ual/idle',
        label: 'idle',
        frameCount: opts.frames,
        fps: 5,
        loop: true,
        timing: 'fit',
      },
    ],
  };
}

/** Opens a seeded project in Easy and waits for the workspace. */
export async function openSeededEasy(page: Page, id: string): Promise<void> {
  await page.goto('/#p=' + id);
  await page.reload();
  await expect(page.getByRole('region', {name: 'Customize'})).toBeVisible({
    timeout: 30_000,
  });
}

/** Seeds one project (idle and walk clips) and opens it in the given workspace. */
export async function openProjectIn(
  page: Page,
  workspace: 'easy' | 'pro',
  opts: {id?: string; frames?: number} = {},
): Promise<void> {
  const id = opts.id ?? 'qa-view';
  await page.addInitScript(ws => {
    if (window.localStorage.getItem('csg.prefs') === null) {
      window.localStorage.setItem(
        'csg.prefs',
        JSON.stringify({
          format: 'sprite-ui-prefs',
          version: 2,
          theme: 'dark',
          workspace: ws,
        }),
      );
    }
  }, workspace);
  await page.goto('/#home');
  await expect(page.getByTestId('home')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  const base = (FIXTURE as unknown as {render: Record<string, unknown>}).render;
  const anim = (clip: string, fps: number) => ({
    clipId: `builtin:quaternius-ual/${clip}`,
    label: clip,
    frameCount: opts.frames ?? 8,
    fps,
    loop: true,
    timing: 'fit',
  });
  await seedProjects(page, [
    {
      id,
      name: 'View Hero',
      doc: {render: {...base, animations: [anim('idle', 5), anim('walk', 6)]}},
    },
  ]);
  await page.goto(`/#p=${id}`);
  await page.reload();
  await expect(
    workspace === 'pro'
      ? page.getByTestId('pro')
      : page.getByRole('region', {name: 'Customize'}),
  ).toBeVisible({timeout: 30_000});
  // The viewport toolbar is enabled once the renderer is ready.
  await expect(page.getByRole('button', {name: 'Turn right'})).toBeEnabled({
    timeout: 90_000,
  });
  await expect(page.locator('.cv__stage canvas').first()).toBeVisible({
    timeout: 90_000,
  });
}
