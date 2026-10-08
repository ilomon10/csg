import {createReadStream, existsSync, readdirSync, statSync} from 'node:fs';
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

const MIME: Readonly<Record<string, string>> = {
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
};

function listFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

/** Static middleware for `/packs/**` straight from `assets/packs` (no copy into src). */
const servePacks: Connect.NextHandleFunction = (req, res, next) => {
  const url = (req.url ?? '').split('?')[0] ?? '';
  if (!url.startsWith(PACKS_URL)) return next();
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(url.slice(PACKS_URL.length)));
  } catch {
    res.statusCode = 400;
    return res.end();
  }
  const file = join(PACKS_DIR, rel);
  if (
    !file.startsWith(PACKS_DIR + sep) ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader(
    'Content-Type',
    MIME[extname(file)] ?? 'application/octet-stream',
  );
  createReadStream(file).pipe(res);
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
  server: {fs: {allow: [resolve(HERE, '../..')]}},
});
