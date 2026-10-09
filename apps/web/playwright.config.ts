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
 * Two Chromium projects (spec 000 REQ-GEN-002): one with WebGPU (must report `webgpu`; a
 * runner without a WebGPU adapter fails loudly instead of silently testing WebGL2) and one
 * with WebGPU disabled (must report `webgl2`).
 *
 * The WebGPU project asks for a Vulkan adapter. Headless Chromium without a GPU falls back to
 * the SwiftShader adapter, which reports `webgpu` but draws nothing (observed 2026-10-09 with
 * Chromium 1228/1248); the pixel assertions then fail, which is the intended loud failure (R2).
 */
export default defineConfig({
  testDir: './e2e',
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
            '--use-angle=vulkan',
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
