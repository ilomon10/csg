import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import {defineConfig, mergeConfig} from 'vite';
import base from './vite.config';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Puts the CSP meta of `index.html` into the test host page, so tests run under the same policy. */
function hostCsp(): Plugin {
  return {
    name: 'csg-e2e-host-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('export-host.html')) return html;
        const index = readFileSync(resolve(HERE, 'index.html'), 'utf8');
        const meta = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/.exec(
          index,
        )?.[0];
        if (meta === undefined) throw new Error('index.html has no CSP meta');
        return html.replace('<!--CSP-->', meta);
      },
    },
  };
}

/**
 * Build used only by `pnpm e2e` (see `playwright.config.ts`): the production inputs plus the
 * test host pages. Output goes to `dist-e2e`, never to the shipped `dist`.
 */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [hostCsp()],
    build: {
      outDir: 'dist-e2e',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(HERE, 'index.html'),
          'export-host': resolve(HERE, 'export-host.html'),
        },
      },
    },
  }),
);
