import {availableParallelism} from 'node:os';
import {defineConfig, devices} from '@playwright/test';

/**
 * Parallel workers open many pages in one browser. Chromium may treat the ones behind the
 * others as backgrounded or occluded and then reports no first-contentful-paint for them, which
 * the FCP-ordered tests (AC-UX-034.1, AC-UX-083.1) read as -1. These flags keep every page active.
 */
const KEEP_PAGES_ACTIVE = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];

/**
 * Software GPU for runners without one (CI runs e2e in the pinned Playwright image):
 *
 * - `--use-webgpu-adapter=swiftshader`: the WebGPU adapter (Dawn on SwiftShader Vulkan).
 * - `--use-angle=swiftshader`: WebGL2 and GL compositing on SwiftShader.
 * - `--use-vulkan=swiftshader`: the GPU process's own Vulkan, from Chromium's bundled SwiftShader
 *   ICD. Without it `--enable-features=Vulkan` looks for a system Vulkan driver, which the image
 *   lacks (`vkCreateInstance() failed: -9`). The first `getCurrentTexture()` of a WebGPU canvas
 *   then finds no shared-image backing for the swap chain ("Could not find
 *   SharedImageBackingFactory ... WebGPUSwapBufferProvider"), the GPU channel goes invalid and the
 *   page's whole WebGPU instance is dropped ("A valid external Instance reference no longer
 *   exists"): every device is lost, so the home lineup and exports never produce a frame. The
 *   vitest GPU harness never presents to a canvas (it renders into targets and reads back), which
 *   is why it passes without this flag.
 */
const SOFTWARE_GPU = [
  '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
];

/** Runner without a GPU: CI, or `CSG_E2E_SOFTWARE=1` on a GPU host. */
const SOFTWARE =
  Boolean(process.env['CI']) || process.env['CSG_E2E_SOFTWARE'] === '1';

/**
 * Every SwiftShader page rasterizes on the CPU with many threads. Playwright's default (half the
 * cores) starves the pages on a large machine: with 8 workers on 16 cores the rAF-sampling and
 * transition-timing tests (AC-GEN-007.2, AC-UX-073.1, AC-UX-079.2) saw 1 frame in 3 s. At most 4
 * workers keeps the CI runner's ratio (4 vCPUs, 2 workers) or better.
 */
const SOFTWARE_WORKERS = Math.min(
  4,
  Math.max(1, Math.floor(availableParallelism() / 2)),
);

/**
 * Two Chromium projects (spec 000 REQ-GEN-002): one with WebGPU (must report `webgpu`; a
 * runner without a WebGPU adapter fails loudly instead of silently testing WebGL2) and one
 * with WebGPU disabled (must report `webgl2`).
 *
 * The WebGPU project asks for a Vulkan adapter. On a runner without a GPU (CI, or
 * `CSG_E2E_SOFTWARE=1`) it pins SwiftShader for all three GPU paths; see `SOFTWARE_GPU`.
 */
export default defineConfig({
  testDir: './e2e',
  ...(SOFTWARE ? {workers: SOFTWARE_WORKERS} : {}),
  use: {baseURL: 'http://localhost:4173'},
  projects: [
    {
      name: 'chromium-webgpu',
      metadata: {expectedBackend: 'webgpu'},
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan',
            // Locally, use the host's Vulkan GPU. Set CSG_E2E_SOFTWARE=1 to force the CI path.
            ...(SOFTWARE ? SOFTWARE_GPU : ['--use-angle=vulkan']),
            ...KEEP_PAGES_ACTIVE,
          ],
        },
      },
    },
    {
      name: 'chromium-webgl2',
      metadata: {expectedBackend: 'webgl2'},
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--disable-features=WebGPU', ...KEEP_PAGES_ACTIVE],
        },
      },
    },
  ],
  webServer: {
    // The e2e build adds the test host pages (vite.e2e.config.ts); `dist` stays production only.
    command:
      'pnpm run build:e2e && pnpm exec vite preview --outDir dist-e2e --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
