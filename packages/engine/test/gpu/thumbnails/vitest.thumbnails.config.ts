/**
 * Vitest browser config of `pnpm assets:thumbnails` (spec 011 REQ-AST-015: Playwright Chromium
 * with `forceWebGL`). One project, WebGL2 only, one file at a time. Run it through
 * `scripts/golden-env/run.sh assets:thumbnails:render` (the canonical container, ADR-0009), which
 * `tools/thumbnails.ts` calls; outside the container the output is informational only.
 */
import {fileURLToPath} from 'node:url';
import {playwright} from '@vitest/browser-playwright';
import {defineConfig} from 'vitest/config';
import {goldenCommands} from '../golden-commands.ts';
import {thumbnailCommands} from './thumbnail-commands.ts';

const canonical = process.env.CSG_GOLDEN_ENV === 'canonical';

export default defineConfig({
  test: {
    name: 'thumbnails-webgl2',
    root: fileURLToPath(new URL('../../..', import.meta.url)),
    include: ['test/gpu/thumbnails/**/*.thumb.ts'],
    provide: {csgBackend: 'webgl2'},
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      screenshotFailures: false,
      provider: playwright({
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan',
            ...(canonical
              ? ['--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader']
              : []),
          ],
        },
      }),
      instances: [{browser: 'chromium' as const}],
      commands: {...goldenCommands, ...thumbnailCommands},
    },
  },
});
