/**
 * Browser-side GPU test harness (M2-08). Import only from `*.gpu.ts` files run by the `gpu-*`
 * Vitest projects (`pnpm test:gpu`).
 *
 * - One project per backend (`gpu-webgpu`, `gpu-webgl2`); the backend arrives through `provide`.
 * - A fresh canvas and renderer per harness (re-initialising on a disposed canvas fails on WebGL2).
 * - The actual backend is asserted after `init()`: without the Chromium WebGPU flags three silently
 *   falls back to WebGL2, which would make "webgpu" goldens pass as WebGL2 images.
 */
import {commands} from 'vitest/browser';
import {inject} from 'vitest';
import * as THREE from 'three/webgpu';
import type {ReadbackLayout} from '../../src/contracts/pipeline';
import {normalizeReadback} from '../../src/pipeline/readback';
import type {
  CompareResult,
  EnvironmentRecord,
  GoldenBackend,
  GoldenOverride,
} from './golden-node.ts';
import type {CompareGoldenPayload} from './golden-commands.ts';

declare module 'vitest/browser' {
  interface BrowserCommands {
    csgCompareGolden(payload: CompareGoldenPayload): Promise<CompareResult>;
    csgWriteReport(name: string, json: unknown): Promise<void>;
    csgEnv(): Promise<NodeEnv>;
    csgSeedGolden(
      goldenDir: string,
      backend: GoldenBackend,
      name: string,
      rgbaBase64: string,
      width: number,
      height: number,
    ): Promise<void>;
    csgArtifactExists(relativePath: string): Promise<boolean>;
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    csgBackend: GoldenBackend;
  }
}

/** Backend of the current project. */
export function currentBackend(): GoldenBackend {
  return inject('csgBackend');
}

/** A renderer on its own canvas plus recorded environment facts. */
export interface GpuHarness {
  readonly backend: GoldenBackend;
  readonly renderer: THREE.WebGPURenderer;
  readonly environment: EnvironmentRecord;
  dispose(): void;
}

/** What `csgEnv` reports from Node. */
export interface NodeEnv {
  canonical: boolean;
  image: string | null;
  perfGate: boolean;
  /** `CSG_GOLDEN_UPDATE=1`: compareGolden rewrites instead of comparing. */
  update: boolean;
}

/** Reads the Node-side environment flags. */
export const nodeEnv = (): Promise<NodeEnv> => commands.csgEnv();

async function collectAdapter(
  renderer: THREE.WebGPURenderer,
  isWebGPU: boolean,
): Promise<Record<string, unknown>> {
  if (isWebGPU) {
    const gpu = (navigator as unknown as {gpu: GpuLike}).gpu;
    const adapter = await gpu.requestAdapter();
    const info = adapter?.info ?? {};
    return {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: info.isFallbackAdapter ?? adapter?.isFallbackAdapter,
    };
  }
  const gl = (renderer.backend as unknown as {gl: WebGL2RenderingContext}).gl;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    version: gl.getParameter(gl.VERSION),
    renderer: ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
    colorBufferFloat: gl.getExtension('EXT_color_buffer_float') !== null,
    colorBufferHalfFloat:
      gl.getExtension('EXT_color_buffer_half_float') !== null,
  };
}

interface GpuLike {
  requestAdapter(): Promise<{
    info?: Record<string, unknown> & {isFallbackAdapter?: boolean};
    isFallbackAdapter?: boolean;
  } | null>;
}

/**
 * Creates and initialises a renderer for the current project's backend.
 *
 * @throws Error when the actual backend is not the requested one, or when, inside the canonical
 *   environment, the WebGPU adapter is not SwiftShader.
 */
export async function createGpuHarness(
  width: number,
  height: number,
): Promise<GpuHarness> {
  const backend = currentBackend();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    forceWebGL: backend === 'webgl2',
  });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const isWebGPU =
    (renderer.backend as unknown as {isWebGPUBackend?: boolean})
      .isWebGPUBackend === true;
  const actual: GoldenBackend = isWebGPU ? 'webgpu' : 'webgl2';
  if (actual !== backend) {
    void renderer.dispose();
    throw new Error(
      `requested backend ${backend} but three initialised ${actual}; ` +
        'is Chromium started with --enable-unsafe-webgpu (see vitest.config.ts)?',
    );
  }
  const adapter = await collectAdapter(renderer, isWebGPU);
  const env = await nodeEnv();
  if (env.canonical && isWebGPU && adapter.architecture !== 'swiftshader') {
    void renderer.dispose();
    throw new Error(
      `canonical environment needs the SwiftShader WebGPU adapter, got ${JSON.stringify(adapter)}`,
    );
  }
  const environment: EnvironmentRecord = {
    image: env.image,
    userAgent: navigator.userAgent,
    three: THREE.REVISION,
    adapter,
  };
  return {
    backend,
    renderer,
    environment,
    dispose: () => void renderer.dispose(),
  };
}

/** Row layout of `readRenderTargetPixelsAsync` for an RGBA8 target on a backend. */
export function readbackLayout(
  backend: GoldenBackend,
  width: number,
): ReadbackLayout {
  return backend === 'webgpu'
    ? {rowStrideBytes: Math.ceil((width * 4) / 256) * 256, bottomUp: false}
    : {rowStrideBytes: width * 4, bottomUp: true};
}

/** Result of {@link renderToRgba}. */
export interface RenderedImage {
  /** Normalised: tight RGBA8, top-left origin. */
  rgba: Uint8ClampedArray;
  /** Length of the raw readback buffer (padding evidence). */
  rawLength: number;
  width: number;
  height: number;
}

/** Renders a scene into an RGBA8 target (no colour transform, nearest, no MSAA) and normalises the readback. */
export async function renderToRgba(
  h: GpuHarness,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): Promise<RenderedImage> {
  const rt = new THREE.RenderTarget(width, height, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    samples: 0,
    colorSpace: THREE.NoColorSpace,
  });
  try {
    h.renderer.setRenderTarget(rt);
    h.renderer.render(scene, camera);
    h.renderer.setRenderTarget(null);
    const raw = (await h.renderer.readRenderTargetPixelsAsync(
      rt,
      0,
      0,
      width,
      height,
    )) as Uint8Array;
    return {
      rgba: normalizeReadback(
        raw,
        width,
        height,
        readbackLayout(h.backend, width),
      ),
      rawLength: raw.length,
      width,
      height,
    };
  } finally {
    rt.dispose();
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Options of {@link compareGolden}. */
export interface CompareGoldenOptions {
  /** Tolerance override; the reason is mandatory. Default is 0 differing pixels. */
  override?: GoldenOverride;
  /** Harness self-tests only: golden root relative to the repo root. */
  goldenDir?: string;
}

/**
 * Compares a normalised frame with the committed golden of the current backend (REQ-PIX-028).
 * Tolerance 0 unless `override` is given. Fails the test in the canonical environment
 * (`CSG_GOLDEN_ENV=canonical`); elsewhere it only logs the differing-pixel count (AC-PIX-028.3).
 * With `CSG_GOLDEN_UPDATE=1` (canonical only) it rewrites the golden instead.
 *
 * @returns The comparison outcome when the test may continue.
 * @throws Error when the comparison must fail.
 */
export async function compareGolden(
  h: GpuHarness,
  name: string,
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: CompareGoldenOptions = {},
): Promise<CompareResult> {
  const payload: CompareGoldenPayload = {
    backend: h.backend,
    name,
    rgbaBase64: toBase64(
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    ),
    width,
    height,
    override: options.override,
    environment: h.environment,
    goldenDir: options.goldenDir,
  };
  const result = await commands.csgCompareGolden(payload);
  if (result.fail) throw new Error(result.message);
  return result;
}
