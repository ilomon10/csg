/**
 * `pnpm assets:thumbnails` (spec 011 REQ-AST-015, REQ-AST-039). Renders deterministic pixel-art
 * thumbnails of every part, character preset, look and body shape with the real engine pipeline
 * in the canonical golden container (ADR-0009), then verifies and installs them:
 *
 * 1. plans the jobs from the built packs (`tools/lib/thumbnails/jobs.ts`) and writes
 *    `test-results/thumbnails/jobs.json`;
 * 2. renders them with `scripts/golden-env/run.sh assets:thumbnails:render` (Docker, pinned
 *    Playwright image, WebGL2 on SwiftShader), which writes WebP and RGBA PNG pairs below
 *    `test-results/thumbnails/`;
 * 3. checks each WebP (lossless, exact size, at most 12 KB) and decodes it with sharp (libwebp)
 *    to compare it pixel for pixel with the rendered RGBA;
 * 4. installs changed files into `assets/packs/<packId>/`, removes thumbnails no job produces,
 *    writes `thumbnails/index.json` (input hashes for the stale check of `assets:check`) and the
 *    computed manifest `thumbnail` fields (the same rule `assets:build` applies);
 * 5. writes a contact sheet PNG (`--contact <file>`, default
 *    `test-results/thumbnails/contact.png`).
 *
 * Flags: `--host` renders with the host's Playwright Chromium instead of Docker (not canonical:
 * nothing is installed unless `--allow-host` is also given), `--skip-render` re-verifies and
 * installs the last render. Exit codes: 0 ok, 1 render or verification failure, 2 usage.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import type {OverlayOptions} from 'sharp';
import {parseJson} from '@csg/parts-schema';
import {canonicalJson} from './lib/build/canonical-json.js';
import {
  THUMBNAIL_INDEX_PATH,
  serializeThumbnailIndex,
  sha256Hex,
  thumbnailFileProblems,
} from './lib/thumbnails/index-file.js';
import type {ThumbnailIndexEntry} from './lib/thumbnails/index-file.js';
import {THUMBNAIL_SHAPE_STYLES, planThumbnails} from './lib/thumbnails/jobs.js';
import type {ThumbnailJob} from './lib/thumbnails/jobs.js';
import {readPlanPacks} from './lib/thumbnails/read-packs.js';
import {registerPartThumbnails} from './lib/thumbnails/register.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'assets', 'packs');
const WORK = join(ROOT, 'test-results', 'thumbnails');
const CONFIG =
  'packages/engine/test/gpu/thumbnails/vitest.thumbnails.config.ts';

interface Options {
  host: boolean;
  allowHost: boolean;
  skipRender: boolean;
  contact: string;
}

function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    host: false,
    allowHost: false,
    skipRender: false,
    contact: join(WORK, 'contact.png'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') o.host = true;
    else if (a === '--allow-host') o.allowHost = true;
    else if (a === '--skip-render') o.skipRender = true;
    else if (a === '--contact' && argv[i + 1] !== undefined)
      o.contact = resolve(argv[++i]!);
    else throw new UsageError(`unknown argument "${a}"`);
  }
  return o;
}

class UsageError extends Error {}

function render(host: boolean): number {
  const r = host
    ? spawnSync(
        process.execPath,
        ['node_modules/vitest/vitest.mjs', 'run', '--config', CONFIG],
        {cwd: ROOT, stdio: 'inherit'},
      )
    : spawnSync(
        join(ROOT, 'scripts/golden-env/run.sh'),
        ['assets:thumbnails:render'],
        {cwd: ROOT, stdio: 'inherit'},
      );
  return r.status ?? 1;
}

async function rawRgba(
  input: Buffer,
): Promise<{data: Buffer; width: number; height: number}> {
  const {data, info} = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({resolveWithObject: true});
  return {data, width: info.width, height: info.height};
}

/** Every thumbnail file currently in a pack (pack-relative), except the index. */
async function existingThumbnails(packDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    if (!existsSync(dir)) return;
    for (const e of await readdir(dir, {withFileTypes: true})) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(join(dir, e.name), r);
      else out.push(r);
    }
  };
  await walk(join(packDir, 'thumbnails'), 'thumbnails');
  return out.filter(p => p !== THUMBNAIL_INDEX_PATH).sort();
}

async function contactSheet(
  jobs: readonly ThumbnailJob[],
  file: string,
): Promise<void> {
  const CELL = 128;
  const GAP = 4;
  const rows = (['part', 'character', 'look', 'shape'] as const)
    .flatMap(kind => {
      const list = jobs.filter(j => j.kind === kind);
      if (kind !== 'shape') return [list];
      return THUMBNAIL_SHAPE_STYLES.map(s => list.filter(j => j.style === s));
    })
    .flatMap(list => {
      const chunks: ThumbnailJob[][] = [];
      for (let i = 0; i < list.length; i += 12)
        chunks.push(list.slice(i, i + 12));
      return chunks;
    })
    .filter(r => r.length > 0);
  const cols = Math.max(...rows.map(r => r.length));
  const width = cols * (CELL + GAP) + GAP;
  const height = rows.length * (CELL + GAP) + GAP;
  const layers: OverlayOptions[] = [];
  for (const [y, row] of rows.entries()) {
    for (const [x, job] of row.entries()) {
      const png = join(WORK, 'rgba', job.packId, `${job.path}.png`);
      layers.push({
        input: await sharp(png)
          .resize(CELL, CELL, {kernel: 'nearest'})
          .png()
          .toBuffer(),
        left: GAP + x * (CELL + GAP),
        top: GAP + y * (CELL + GAP),
      });
    }
  }
  await mkdir(dirname(file), {recursive: true});
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: {r: 96, g: 104, b: 120, alpha: 1},
    },
  })
    .composite(layers)
    .png()
    .toFile(file);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const plan = planThumbnails(await readPlanPacks(PACKS));
  if (plan.problems.length > 0) {
    console.error(
      `assets:thumbnails: cannot plan:\n${plan.problems.map(p => `  - ${p}`).join('\n')}`,
    );
    return 1;
  }
  if (plan.jobs.length === 0) {
    console.log('assets:thumbnails: no built packs, nothing to render.');
    return 0;
  }
  if (!opts.skipRender) {
    await rm(WORK, {recursive: true, force: true});
    await mkdir(WORK, {recursive: true});
    await writeFile(
      join(WORK, 'jobs.json'),
      JSON.stringify({shapeStyles: THUMBNAIL_SHAPE_STYLES, jobs: plan.jobs}),
    );
    console.log(
      `assets:thumbnails: rendering ${plan.jobs.length} thumbnails (${opts.host ? 'host Chromium, not canonical' : 'canonical container'})`,
    );
    const status = render(opts.host);
    if (status !== 0) {
      console.error(`assets:thumbnails: render failed (exit ${status}).`);
      return 1;
    }
  }
  const reportJson = parseJson(
    await readFile(join(WORK, 'render-report.json'), 'utf8'),
  );
  const canonical =
    reportJson.ok &&
    (reportJson.value as {canonical?: unknown}).canonical === true;
  if (!canonical && !opts.allowHost) {
    console.error(
      'assets:thumbnails: the render did not run in the canonical container; nothing installed (use --allow-host to install anyway).',
    );
    return 1;
  }

  // Verify every output before touching assets/packs.
  const outputs = new Map<string, Buffer>();
  const failures: string[] = [];
  for (const job of plan.jobs) {
    const key = `${job.packId}/${job.path}`;
    let webp: Buffer;
    let png: Buffer;
    try {
      webp = await readFile(join(WORK, 'out', job.packId, job.path));
      png = await readFile(join(WORK, 'rgba', job.packId, `${job.path}.png`));
    } catch {
      failures.push(`${key}: not rendered`);
      continue;
    }
    const problems = thumbnailFileProblems(job, webp);
    const a = await rawRgba(webp);
    const b = await rawRgba(png);
    if (a.width !== b.width || a.height !== b.height || !a.data.equals(b.data))
      problems.push('decodes to different pixels than were rendered');
    if (problems.length > 0) failures.push(`${key}: ${problems.join('; ')}`);
    else outputs.set(key, webp);
  }
  if (failures.length > 0) {
    console.error(
      `assets:thumbnails: verification failed:\n${failures.map(f => `  - ${f}`).join('\n')}`,
    );
    return 1;
  }

  // Install.
  let written = 0;
  let removed = 0;
  let total = 0;
  const byPack = new Map<string, ThumbnailJob[]>();
  for (const job of plan.jobs)
    byPack.set(job.packId, [...(byPack.get(job.packId) ?? []), job]);
  for (const [packId, jobs] of byPack) {
    const packDir = join(PACKS, packId);
    const wanted = new Set(jobs.map(j => j.path));
    for (const old of await existingThumbnails(packDir)) {
      if (!wanted.has(old)) {
        await rm(join(packDir, old));
        removed++;
      }
    }
    const entries: ThumbnailIndexEntry[] = [];
    for (const job of jobs) {
      const bytes = outputs.get(`${packId}/${job.path}`)!;
      const dest = join(packDir, job.path);
      const current = existsSync(dest) ? await readFile(dest) : null;
      if (current === null || !current.equals(bytes)) {
        await mkdir(dirname(dest), {recursive: true});
        await writeFile(dest, bytes);
        written++;
      }
      total += bytes.length;
      const side = job.cellPx * job.scale;
      entries.push({
        path: job.path,
        kind: job.kind,
        id: job.id,
        inputs: job.inputs,
        sha256: sha256Hex(bytes),
        width: side,
        height: side,
      });
    }
    await writeFile(
      join(packDir, THUMBNAIL_INDEX_PATH),
      serializeThumbnailIndex(entries),
    );
    const manifestPath = join(packDir, 'manifest.json');
    const manifest = parseJson(await readFile(manifestPath, 'utf8'));
    if (manifest.ok) {
      const reg = registerPartThumbnails(
        manifest.value as Record<string, unknown>,
        rel => existsSync(join(packDir, rel)),
      );
      if (reg.changed)
        await writeFile(manifestPath, canonicalJson(reg.manifest));
    }
  }
  await contactSheet(plan.jobs, opts.contact);
  const counts = new Map<string, number>();
  for (const j of plan.jobs) counts.set(j.kind, (counts.get(j.kind) ?? 0) + 1);
  console.log(
    `assets:thumbnails: ${plan.jobs.length} thumbnails (${[...counts].map(([k, n]) => `${n} ${k}`).join(', ')}), ` +
      `${written} written, ${removed} removed, ${total} bytes total. Contact sheet: ${opts.contact}`,
  );
  return 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  (e: unknown) => {
    if (e instanceof UsageError) {
      console.error(`assets:thumbnails: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    throw e;
  },
);
