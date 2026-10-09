import {defineConfig, devices} from '@playwright/test';

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
          ],
        },
      },
    },
    {
      name: 'chromium-webgl2',
      metadata: {expectedBackend: 'webgl2'},
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {args: ['--disable-features=WebGPU']},
      },
    },
  ],
  webServer: {
    command: 'pnpm run build && pnpm exec vite preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
