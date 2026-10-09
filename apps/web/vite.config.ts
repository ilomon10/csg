import {
  createReadStream,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import type {ServerResponse} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import type {Connect, Plugin} from 'vite';
import {defineConfig} from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Built asset packs (spec 011); the repo root is the single source of truth. */
const PACKS_DIR = resolve(HERE, '../../assets/packs');
/** Stable URL prefix the packs are served under (dev, preview and build). */
const PACKS_URL = '/packs/';

/**
 * The REQ-GEN-010 policy has a single source: the CSP meta in `index.html`. The preview server
 * sends the same string as a header on worker scripts (REQ-GEN-015, AC-GEN-015.3).
 */
function readCsp(): string {
  const html = readFileSync(resolve(HERE, 'index.html'), 'utf8');
  const m =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(
      html,
    );
  if (m?.[1] === undefined) throw new Error('index.html has no CSP meta');
  return m[1].replace(/&#39;|&apos;/g, "'");
}

/** Built module-worker scripts (`assets/*.worker-<hash>.js`). */
const WORKER_URL = /\/assets\/[^/]*\.worker-[^/]*\.js$/;

const MIME: Readonly<Record<string, string>> = {
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
};

/** Regular files under `dir`; symlinks (files or directories) are skipped, never followed. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : entry.isFile()
        ? [join(dir, entry.name)]
        : [];
  });
}

function sendStatus(res: ServerResponse, status: number): void {
  res.statusCode = status;
  res.removeHeader('Content-Length');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(status === 404 ? 'Not found' : 'Error');
}

/**
 * Static middleware for `/packs/**` straight from `assets/packs` (no copy into src).
 * Unknown paths and traversal attempts get 404; read errors 500 (or a closed
 * connection once headers are sent) instead of crashing the server. Responses
 * carry an explicit content type and `X-Content-Type-Options: nosniff`.
 */
const servePacks: Connect.NextHandleFunction = (req, res, next) => {
  const url = (req.url ?? '').split('?')[0] ?? '';
  if (!url.startsWith(PACKS_URL)) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendStatus(res, 405);
  }
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(url.slice(PACKS_URL.length)));
  } catch {
    return sendStatus(res, 400);
  }
  const file = join(PACKS_DIR, rel);
  let size: number;
  try {
    if (!file.startsWith(PACKS_DIR + sep)) return sendStatus(res, 404);
    // Symlinks are never served: lstat the file and require its real path to stay under the
    // real packs directory (this also rejects a symlinked parent directory).
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) return sendStatus(res, 404);
    const realRoot = realpathSync(PACKS_DIR);
    if (!realpathSync(file).startsWith(realRoot + sep)) {
      return sendStatus(res, 404);
    }
    size = stat.size;
  } catch {
    return sendStatus(res, 404);
  }
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
  );
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  pipeline(createReadStream(file), res).catch(() => {
    if (!res.headersSent) sendStatus(res, 500);
    else res.destroy();
  });
};

/**
 * Serves `assets/packs/**` at `/packs/` in dev and preview and emits the same files
 * into the production bundle. In dev the CSP meta of REQ-GEN-010 is removed: Vite's
 * HMR client needs inline scripts and a websocket, which the strict policy forbids
 * (spec 000 edge case: the policy applies to production builds only).
 */
function packsAndCsp(): Plugin {
  return {
    name: 'csg-packs-and-csp',
    configureServer(server) {
      server.middlewares.use(servePacks);
    },
    configurePreviewServer(server) {
      const csp = readCsp();
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (WORKER_URL.test(path))
          res.setHeader('Content-Security-Policy', csp);
        next();
      });
      server.middlewares.use(servePacks);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.server === undefined) return html;
        return html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/,
          '',
        );
      },
    },
    async generateBundle() {
      if (!existsSync(PACKS_DIR)) return;
      for (const file of listFiles(PACKS_DIR)) {
        this.emitFile({
          type: 'asset',
          fileName: `packs/${file
            .slice(PACKS_DIR.length + 1)
            .split(sep)
            .join('/')}`,
          source: await readFile(file),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), packsAndCsp()],
  build: {chunkSizeWarningLimit: 2500},
  // Module worker bundles must be ES modules: the host starts them with `{type: 'module'}`.
  worker: {format: 'es'},
  server: {
    // Only what dev needs: this app, the workspace packages it imports, the built packs
    // and the hoisted node_modules; not the whole repo.
    fs: {
      allow: [
        resolve(HERE),
        resolve(HERE, '../../packages'),
        PACKS_DIR,
        resolve(HERE, '../../node_modules'),
      ],
    },
  },
});
