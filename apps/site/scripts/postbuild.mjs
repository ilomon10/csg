// Post-export steps and build-failing checks on apps/site/out (spec 010).
//  - REQ-WEB-003: .nojekyll at the root.
//  - REQ-WEB-039: sitemap.xml and robots.txt with absolute URLs.
//  - REQ-WEB-005 / AC-WEB-005.1: every /docs route maps to exactly one allowed
//    Markdown source, and every source has a route.
//  - REQ-WEB-008 / AC-WEB-008.3: no broken internal href/src (fragments included).
//    /app/ is the editor, built separately, and is treated as a known route.
//  - AC-WEB-012.2: the static search index is at most 400 KB gzipped.
//  - AC-WEB-038.1: unique titles, absolute canonicals, og:image is a 1200x630 PNG.
import process from 'node:process';
import {URL} from 'node:url';
import console from 'node:console';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SITE, '../..');
const OUT = join(SITE, 'out');
const basePath = (process.env.SITE_BASE_PATH ?? '').replace(/\/+$/, '');
const siteUrl = (process.env.SITE_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  '',
);
const errors = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!existsSync(OUT)) {
  console.error(
    '[site] out/ is missing; did next build run with output: export?',
  );
  process.exit(1);
}

writeFileSync(join(OUT, '.nojekyll'), '');

const files = walk(OUT);
const htmlFiles = files.filter(f => f.endsWith('.html'));
const routeOf = f => {
  const r = '/' + relative(OUT, f).split(sep).join('/');
  return r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r;
};
const routes = htmlFiles
  .map(routeOf)
  .filter(r => !/^\/(404|_not-found)/.test(r) && !r.startsWith('/_next/'));

// ---------- sitemap + robots ----------
const locs = [...routes.filter(r => r.endsWith('/')), '/app/'].sort();
writeFileSync(
  join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs
    .map(r => `  <url><loc>${siteUrl}${basePath}${r}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
writeFileSync(
  join(OUT, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}${basePath}/sitemap.xml\n`,
);

for (const required of [
  'index.html',
  '404.html',
  'docs/index.html',
  'sitemap.xml',
  'robots.txt',
  '.nojekyll',
]) {
  if (!existsSync(join(OUT, required)))
    errors.push(`out/${required} is missing (AC-WEB-001.1)`);
}

// ---------- docs routes <-> Markdown sources ----------
function mdSources() {
  const list = [];
  const add = (dir, prefix) => {
    for (const f of walk(join(REPO, dir))) {
      if (!f.endsWith('.md')) continue;
      const r = relative(join(REPO, dir), f)
        .split(sep)
        .join('/')
        .replace(/\.md$/, '');
      const slug = r === 'index' ? '' : r.replace(/\/index$/, '');
      list.push({
        file: relative(REPO, f).split(sep).join('/'),
        route: `${prefix}${slug ? `${slug}/` : ''}`,
      });
    }
  };
  add('docs/guide', '/docs/');
  add('docs/contributing', '/docs/contribute/');
  list.push({
    file: 'docs/architecture.md',
    route: '/docs/contribute/architecture/',
  });
  for (const n of readdirSync(join(REPO, 'docs/adr'))) {
    if (!n.endsWith('.md') || n === 'template.md') continue;
    const route =
      n === 'README.md'
        ? '/docs/contribute/adr/'
        : `/docs/contribute/adr/${n.replace(/\.md$/, '')}/`;
    list.push({file: `docs/adr/${n}`, route});
  }
  return list;
}
const sources = mdSources();
const docRoutes = new Set(routes.filter(r => r.startsWith('/docs/')));
const byRoute = new Map();
for (const s of sources) {
  if (byRoute.has(s.route))
    errors.push(`${s.file} and ${byRoute.get(s.route)} both map to ${s.route}`);
  byRoute.set(s.route, s.file);
  if (!docRoutes.has(s.route))
    errors.push(`${s.file}: no exported page at ${s.route}`);
}
for (const r of docRoutes) {
  if (!byRoute.has(r))
    errors.push(`out${r}: docs page without a Markdown source`);
}

// ---------- internal links ----------
const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    idCache.set(
      file,
      new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])),
    );
  }
  return idCache.get(file);
}
function targetFile(path) {
  const p = join(OUT, path);
  if (path.endsWith('/'))
    return existsSync(join(p, 'index.html')) ? join(p, 'index.html') : null;
  if (existsSync(p) && statSync(p).isFile()) return p;
  if (existsSync(join(p, 'index.html'))) return join(p, 'index.html');
  return null;
}
const decode = s =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
let checked = 0;
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const page = routeOf(file);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = decode(m[1]);
    if (/^([a-z][a-z0-9+.-]*:|\/\/|data:|blob:)/i.test(raw)) continue;
    checked++;
    const [rawPath, hash] = raw.split('#', 2);
    let path = rawPath;
    if (!path) {
      if (hash && !idsOf(file).has(decodeURIComponent(hash))) {
        errors.push(`out${page}: broken fragment #${hash}`);
      }
      continue;
    }
    if (!path.startsWith('/'))
      path = new URL(path, `http://x${basePath}${page}`).pathname;
    if (basePath) {
      if (!path.startsWith(`${basePath}/`) && path !== basePath) {
        errors.push(`out${page}: ${raw} escapes basePath ${basePath}`);
        continue;
      }
      path = path.slice(basePath.length) || '/';
    }
    path = decodeURIComponent(path.split('?')[0]);
    if (path === '/app/' || path.startsWith('/app/')) continue;
    const target = targetFile(path);
    if (!target) {
      errors.push(`out${page}: broken link ${raw}`);
      continue;
    }
    if (
      hash &&
      target.endsWith('.html') &&
      !idsOf(target).has(decodeURIComponent(hash))
    ) {
      errors.push(`out${page}: broken fragment ${raw}`);
    }
  }
}

// ---------- search index budget (AC-WEB-012.2) ----------
const SEARCH_BUDGET_BYTES = 400 * 1024;
let searchGzip = 0;
{
  const index = join(OUT, 'api/search');
  if (!existsSync(index))
    errors.push('out/api/search (search index) is missing');
  else {
    searchGzip = gzipSync(readFileSync(index), {level: 9}).length;
    if (searchGzip > SEARCH_BUDGET_BYTES)
      errors.push(
        `search index is ${(searchGzip / 1024).toFixed(1)} KB gzipped, budget is 400 KB (AC-WEB-012.2)`,
      );
  }
}

// ---------- titles, canonicals, OG images (AC-WEB-038.1) ----------
{
  const titles = new Map();
  const attr = (html, re) => decode(re.exec(html)?.[1] ?? '');
  const pngSize = file => {
    const b = readFileSync(file);
    return b.toString('latin1', 1, 4) === 'PNG'
      ? [b.readUInt32BE(16), b.readUInt32BE(20)]
      : null;
  };
  for (const file of htmlFiles) {
    const page = routeOf(file);
    if (!routes.includes(page) || !page.endsWith('/')) continue;
    const html = readFileSync(file, 'utf8');
    const title = attr(html, /<title>([^<]*)<\/title>/);
    if (!title) errors.push(`out${page}: missing <title>`);
    else if (titles.has(title))
      errors.push(
        `out${page}: <title> "${title}" duplicates ${titles.get(title)}`,
      );
    else titles.set(title, page);
    const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
    if (!/^https?:\/\//.test(canonical))
      errors.push(`out${page}: rel=canonical is missing or not absolute`);
    const og = attr(html, /<meta property="og:image" content="([^"]+)"/);
    if (!og) {
      errors.push(`out${page}: missing og:image`);
      continue;
    }
    if (!attr(html, /<meta name="twitter:card" content="([^"]+)"/))
      errors.push(`out${page}: missing twitter:card`);
    const local = og.replace(siteUrl, '').slice(basePath.length);
    const target = join(OUT, local);
    const size = existsSync(target) ? pngSize(target) : null;
    if (!size || size[0] !== 1200 || size[1] !== 630)
      errors.push(
        `out${page}: og:image ${og} is not a 1200x630 PNG in the export`,
      );
  }
}

if (errors.length) {
  console.error(`[site] export checks failed (${errors.length}):`);
  for (const e of errors.slice(0, 80)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `[site] export checks passed: ${docRoutes.size} docs pages map 1:1 to ${sources.length} Markdown files, ${checked} internal links resolve. Search index ${(searchGzip / 1024).toFixed(1)} KB gzipped (budget 400 KB).`,
);
