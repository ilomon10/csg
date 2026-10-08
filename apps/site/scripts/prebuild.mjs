// Build-failing source checks for apps/site (spec 010). Runs before `next build`.
//  - REQ-WEB-033: every image in public/sprites has a manifest entry; production
//    builds (SITE_ENV=production) reject entries marked `placeholder`.
//  - REQ-WEB-005/006: guide pages are plain .md, no MDX-only syntax, and no docs
//    content lives inside apps/site.
//  - REQ-WEB-010: every docs folder has meta.json and every page is reachable.
//  - REQ-WEB-008: relative links and #anchors in source Markdown resolve.
import process from 'node:process';
import console from 'node:console';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SITE, '../..');
const errors = [];
const rel = p => relative(REPO, p).split(sep).join('/');

function walk(dir, filter = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (
      name === 'node_modules' ||
      name === '.next' ||
      name === 'out' ||
      name === '.source'
    )
      continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

// ---------- provenance (REQ-WEB-033) ----------
{
  const production = process.env.SITE_ENV === 'production';
  const manifestPath = join(SITE, 'public/sprites/manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {items: []};
  const entries = new Map(manifest.items.map(i => [i.file, i]));
  const images = walk(join(SITE, 'public'), p =>
    /\.(png|webp|gif|jpe?g|avif)$/i.test(p),
  );
  for (const img of images) {
    const file = relative(join(SITE, 'public'), img).split(sep).join('/');
    const entry = entries.get(file);
    if (!entry)
      errors.push(
        `public/${file}: image has no entry in public/sprites/manifest.json`,
      );
    else if (production && entry.placeholder) {
      errors.push(
        `public/${file}: placeholder art is not allowed in production builds (SITE_ENV=production)`,
      );
    }
  }
  for (const file of entries.keys()) {
    if (!existsSync(join(SITE, 'public', file)))
      errors.push(`manifest.json lists missing file public/${file}`);
  }
  if (!production && [...entries.values()].some(e => e.placeholder)) {
    console.warn(
      '[site] Using placeholder sprites (allowed outside SITE_ENV=production).',
    );
  }
}

// ---------- no docs content inside apps/site (AC-WEB-005.2) ----------
for (const f of walk(SITE, p => /\.mdx?$/.test(p))) {
  errors.push(
    `${rel(f)}: docs content must live in docs/, not inside apps/site`,
  );
}
for (const f of walk(join(SITE, 'app/docs'))) {
  const r = relative(join(SITE, 'app/docs'), f).split(sep).join('/');
  if (r !== 'layout.tsx' && r !== '[[...slug]]/page.tsx') {
    errors.push(
      `${rel(f)}: /docs routes are rendered only from Markdown sources`,
    );
  }
}

// ---------- Markdown sources ----------
const GUIDE = join(REPO, 'docs/guide');
const CONTRIB = join(REPO, 'docs/contributing');
const sources = [
  ...walk(GUIDE, p => p.endsWith('.md')),
  ...walk(CONTRIB, p => p.endsWith('.md')),
  join(REPO, 'docs/architecture.md'),
  ...readdirSync(join(REPO, 'docs/adr'))
    .filter(n => n.endsWith('.md') && n !== 'template.md')
    .map(n => join(REPO, 'docs/adr', n)),
];
for (const f of walk(GUIDE, p => p.endsWith('.mdx'))) {
  errors.push(`${rel(f)}: Guide pages must be plain Markdown (.md)`);
}

/** Lines outside fenced code, with inline code blanked out. */
function proseLines(text) {
  const lines = text.split('\n');
  let fence = null;
  let frontmatter = lines[0] === '---';
  return lines.map((line, i) => {
    if (frontmatter) {
      if (i > 0 && line === '---') frontmatter = false;
      return '';
    }
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (m) {
      if (!fence) fence = m[1];
      else if (line.trim().startsWith(fence)) fence = null;
      return '';
    }
    if (fence) return '';
    return line.replace(/`[^`]*`/g, '``');
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const seen = new Map();
    const set = new Set();
    for (const line of proseLines(readFileSync(file, 'utf8'))) {
      const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
      if (!h) continue;
      const base = slugify(h[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      set.add(n ? `${base}-${n}` : base);
    }
    anchorCache.set(file, set);
  }
  return anchorCache.get(file);
}

function resolveLink(fromFile, target) {
  let abs = resolve(dirname(fromFile), decodeURIComponent(target));
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    for (const n of ['index.md', 'README.md']) {
      if (existsSync(join(abs, n))) return join(abs, n);
    }
    return abs;
  }
  if (!existsSync(abs) && existsSync(`${abs}.md`)) abs = `${abs}.md`;
  return existsSync(abs) ? abs : null;
}

for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  const strict = file.startsWith(GUIDE + sep) || file.startsWith(CONTRIB + sep);
  proseLines(text).forEach((line, i) => {
    const where = `${rel(file)}:${i + 1}`;
    if (strict) {
      if (/^(import|export)\s/.test(line))
        errors.push(`${where}: MDX import/export is not allowed in .md docs`);
      if (/<[A-Z][A-Za-z0-9.]*[\s/>]/.test(line))
        errors.push(`${where}: JSX element is not allowed in .md docs`);
      if (/(^|[^\\])\{[^}]*\}/.test(line.replace(/\[[^\]]*\]\([^)]*\)/g, ''))) {
        errors.push(
          `${where}: {expression} blocks are MDX-only; escape the brace or use code`,
        );
      }
    }
    for (const m of line.matchAll(
      /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    )) {
      const url = m[1];
      if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(url)) continue;
      const [path, hash] = url.split('#', 2);
      const target = path ? resolveLink(file, path) : file;
      if (!target) {
        errors.push(`${where}: broken link to ${url}`);
        continue;
      }
      if (hash && target.endsWith('.md') && !anchorsOf(target).has(hash)) {
        errors.push(`${where}: missing anchor #${hash} in ${rel(target)}`);
      }
    }
  });
}

// ---------- meta.json coverage (REQ-WEB-010) ----------
function checkMeta(root) {
  const dirs = [root, ...walk(root, () => false)];
  const allDirs = new Set([root]);
  for (const f of walk(root)) allDirs.add(dirname(f));
  for (const dir of allDirs) {
    const metaPath = join(dir, 'meta.json');
    const entries = readdirSync(dir).filter(
      n => n.endsWith('.md') || statSync(join(dir, n)).isDirectory(),
    );
    if (!existsSync(metaPath)) {
      errors.push(`${rel(dir)}: folder has no meta.json`);
      continue;
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (!meta.title || !Array.isArray(meta.pages)) {
      errors.push(`${rel(metaPath)}: meta.json needs "title" and "pages"`);
      continue;
    }
    if (meta.pages.includes('...')) continue;
    for (const e of entries) {
      const name = e.replace(/\.md$/, '');
      if (!meta.pages.includes(name))
        errors.push(`${rel(join(dir, e))}: not listed in ${rel(metaPath)}`);
    }
    for (const p of meta.pages) {
      if (p.startsWith('---') || p.startsWith('[') || p.startsWith('!'))
        continue;
      if (!existsSync(join(dir, `${p}.md`)) && !existsSync(join(dir, p))) {
        errors.push(`${rel(metaPath)}: lists missing page "${p}"`);
      }
    }
  }
  return dirs;
}
checkMeta(GUIDE);
checkMeta(CONTRIB);

if (errors.length) {
  console.error(`[site] prebuild checks failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `[site] prebuild checks passed (${sources.length} Markdown sources).`,
);
