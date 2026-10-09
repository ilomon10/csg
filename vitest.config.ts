import {createRequire} from 'node:module';
import type * as BrowserPlaywright from '@vitest/browser-playwright';
import {pathToFileURL} from 'node:url';
import {defineConfig} from 'vitest/config';

/**
 * Real-browser GPU projects (M2-08). Opt-in: they exist only when `CSG_GPU=1` (set by
 * `pnpm test:gpu`, `pnpm goldens:update` and the golden container), so `pnpm test` stays fast
 * and needs no browser.
 */
/**
 * `@vitest/browser-playwright` is an engine devDependency (pnpm does not hoist it to the root),
 * so it is resolved from `packages/engine` and only when the GPU projects are requested.
 */
async function loadPlaywrightProvider() {
  const resolved = createRequire(
    new URL('./packages/engine/package.json', import.meta.url),
  ).resolve('@vitest/browser-playwright');
  const mod = (await import(pathToFileURL(resolved).href)) as {
    playwright: typeof BrowserPlaywright.playwright;
  };
  return mod.playwright;
}

const canonical = process.env.CSG_GOLDEN_ENV === 'canonical';
const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  // Canonical environment: pin the software adapters so results do not depend on autodetection.
  ...(canonical
    ? ['--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader']
    : []),
  // `CSG_HOST_GPU=1` (set by `pnpm test:perf`): use the host's hardware GPU. Headless Chromium
  // otherwise picks SwiftShader on Linux, so perf numbers would describe the software rasterizer.
  // Never in the canonical golden environment.
  ...(!canonical && process.env.CSG_HOST_GPU === '1'
    ? ['--use-angle=vulkan', '--ignore-gpu-blocklist']
    : []),
];

const playwright =
  process.env.CSG_GPU === '1' ? await loadPlaywrightProvider() : null;

/**
 * `CSG_PERF=1` (`pnpm test:perf`): the GPU projects run only the M2-19 performance suite
 * (`test/perf/**`), which is slow and report-only unless `CSG_PERF_GATE=1`.
 */
const perfOnly = process.env.CSG_PERF === '1';

const goldenCommands =
  playwright !== null
    ? (await import('./packages/engine/test/gpu/golden-commands.ts'))
        .goldenCommands
    : {};

const gpuProjects =
  playwright !== null
    ? (['webgpu', 'webgl2'] as const).map(backend => ({
        // `fflate` is imported only by the export worker (M3 perf export case). Discovered
        // mid-run, Vite re-optimizes it and reloads the browser, which fails the other files.
        optimizeDeps: {include: ['fflate']},
        test: {
          name: `gpu-${backend}`,
          root: 'packages/engine',
          include: perfOnly
            ? ['test/perf/**/*.gpu.ts']
            : ['test/gpu/**/*.gpu.ts', 'test/golden/**/*.gpu.ts'],
          provide: {csgBackend: backend},
          // Perf: one file at a time, so measurements do not share the GPU or CPU.
          fileParallelism: !perfOnly,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({launchOptions: {args: CHROMIUM_ARGS}}),
            instances: [{browser: 'chromium' as const}],
            commands: goldenCommands,
          },
        },
      }))
    : [];

export default defineConfig({
  test: {
    projects: [
      {test: {name: 'parts-schema', root: 'packages/parts-schema'}},
      {test: {name: 'shader-graph', root: 'packages/shader-graph'}},
      {test: {name: 'engine', root: 'packages/engine'}},
      {
        test: {
          name: 'web',
          root: 'apps/web',
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        },
      },
      {test: {name: 'tools', root: 'tools'}},
      ...gpuProjects,
    ],
  },
});
