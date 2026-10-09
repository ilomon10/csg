import {afterEach, describe, expect, it, vi} from 'vitest';
import {ImageBitmapLoader, SRGBColorSpace, TextureLoader} from 'three';
import type {Mesh, MeshStandardMaterial} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {GLTFParser} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {
  REGION_ATTRIBUTE,
  SOURCE_REGION_ATTRIBUTE,
  createGlbLoader,
  inspectGlb,
  IMAGE_ELEMENT_TEXTURES_PLUGIN,
  imageElementTexturesPlugin,
  isAllowedAssetUrl,
  joinPackUrl,
} from './index';
import {buildTestGlb, createTestFetch} from './test-glb';

const BODY_URL = 'packs/p/body.glb';

function firstMesh(root: {traverse(cb: (o: unknown) => void): void}): Mesh {
  let found: Mesh | undefined;
  root.traverse(o => {
    if (found === undefined && (o as Partial<Mesh>).isMesh === true) {
      found = o as Mesh;
    }
  });
  if (found === undefined) throw new Error('no mesh');
  return found;
}

describe('loaders: url policy (architecture 4.10, REQ-AST-029)', () => {
  it('REQ-AST-029: allows same-origin and blob: URLs only', () => {
    const origin = 'https://app.example';
    expect(isAllowedAssetUrl('/assets/packs/a/body.glb', origin)).toBe(true);
    expect(isAllowedAssetUrl('assets/a.glb', origin)).toBe(true);
    expect(isAllowedAssetUrl('https://app.example/a.glb', origin)).toBe(true);
    expect(isAllowedAssetUrl('blob:https://app.example/1234', origin)).toBe(
      true,
    );
    expect(isAllowedAssetUrl('https://cdn.example/a.glb', origin)).toBe(false);
    expect(isAllowedAssetUrl('//cdn.example/a.glb', origin)).toBe(false);
    expect(isAllowedAssetUrl('data:application/octet-stream,AA', origin)).toBe(
      false,
    );
    expect(isAllowedAssetUrl('http://app.example/a.glb', origin)).toBe(false);
  });

  it('REQ-AST-029: without an origin only relative URLs and blob: pass', () => {
    expect(isAllowedAssetUrl('packs/a.glb', undefined)).toBe(true);
    expect(isAllowedAssetUrl('blob:x', undefined)).toBe(true);
    expect(isAllowedAssetUrl('https://app.example/a.glb', undefined)).toBe(
      false,
    );
    expect(isAllowedAssetUrl('//host/a.glb', undefined)).toBe(false);
  });

  it('joins pack base URLs with exactly one slash', () => {
    expect(joinPackUrl('/packs/a', 'parts/x.glb')).toBe('/packs/a/parts/x.glb');
    expect(joinPackUrl('/packs/a/', 'parts/x.glb')).toBe(
      '/packs/a/parts/x.glb',
    );
  });
});

describe('loaders: GLB loader (REQ-AST-028, REQ-AST-029)', () => {
  it('AC-AST-028.1: converts _REGION to a Float32 regionId (itemSize 1) and drops _region', async () => {
    const files = new Map([[BODY_URL, buildTestGlb({region: [0, 3, 10]})]]);
    const stub = createTestFetch(files);
    const loader = createGlbLoader({fetch: stub.fetch, origin: undefined});
    const result = await loader.load(BODY_URL, {
      errorCode: 'CMP_PART_LOAD_FAILED',
      convertRegion: true,
    });
    if (!result.ok) throw new Error(result.error.message);
    const geometry = firstMesh(result.value.scene).geometry;
    const region = geometry.getAttribute(REGION_ATTRIBUTE);
    expect(region.array).toBeInstanceOf(Float32Array);
    expect(region.itemSize).toBe(1);
    expect(Array.from(region.array)).toEqual([0, 3, 10]);
    expect(geometry.getAttribute(SOURCE_REGION_ATTRIBUTE)).toBeUndefined();
  });

  it('AC-AST-028.3: a body without _REGION fails with region-missing', async () => {
    const files = new Map([[BODY_URL, buildTestGlb()]]);
    const loader = createGlbLoader({
      fetch: createTestFetch(files).fetch,
      origin: undefined,
    });
    const result = await loader.load(BODY_URL, {
      errorCode: 'CMP_PART_LOAD_FAILED',
      convertRegion: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CMP_PART_LOAD_FAILED');
    expect(result.error.details).toMatchObject({reason: 'region-missing'});
  });

  it('AC-AST-029.2: a GLB declaring KHR_texture_basisu is refused with extension-not-allowed', async () => {
    const files = new Map([
      [BODY_URL, buildTestGlb({extensions: ['KHR_texture_basisu']})],
      ['draco.glb', buildTestGlb({extensions: ['KHR_draco_mesh_compression']})],
    ]);
    const loader = createGlbLoader({
      fetch: createTestFetch(files).fetch,
      origin: undefined,
    });
    for (const url of [BODY_URL, 'draco.glb']) {
      const result = await loader.load(url, {
        errorCode: 'CMP_PART_LOAD_FAILED',
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('CMP_PART_LOAD_FAILED');
      expect(result.error.details).toMatchObject({
        reason: 'extension-not-allowed',
      });
    }
  });

  it('AC-AST-029.1 (loader part): Meshopt only, decoded on the calling thread: no Worker, no Draco/KTX2 loader, no decoder file request', async () => {
    let workers = 0;
    const original = (globalThis as {Worker?: unknown}).Worker;
    (globalThis as {Worker?: unknown}).Worker = class {
      constructor() {
        workers++;
      }
    };
    const meshopt = vi.spyOn(GLTFLoader.prototype, 'setMeshoptDecoder');
    const draco = vi.spyOn(GLTFLoader.prototype, 'setDRACOLoader');
    const ktx2 = vi.spyOn(GLTFLoader.prototype, 'setKTX2Loader');
    const useWorkers = vi.spyOn(MeshoptDecoder, 'useWorkers');
    try {
      const files = new Map([
        [BODY_URL, buildTestGlb({region: [0, 3, 10]})],
        ['packs/p/clip.glb', buildTestGlb({animations: ['walk']})],
      ]);
      const stub = createTestFetch(files);
      const loader = createGlbLoader({fetch: stub.fetch, origin: undefined});
      const body = await loader.load(BODY_URL, {
        errorCode: 'CMP_PART_LOAD_FAILED',
        convertRegion: true,
      });
      const clip = await loader.load('packs/p/clip.glb', {
        errorCode: 'ANM_CLIP_LOAD_FAILED',
      });
      expect(body.ok && clip.ok).toBe(true);
      // Every GLTFLoader got the in-thread Meshopt decoder and nothing else.
      expect(meshopt).toHaveBeenCalledTimes(2);
      for (const call of meshopt.mock.calls)
        expect(call[0]).toBe(MeshoptDecoder);
      for (const instance of meshopt.mock.contexts as GLTFLoader[]) {
        const fields = instance as unknown as {
          dracoLoader: unknown;
          ktx2Loader: unknown;
        };
        expect(fields.dracoLoader).toBeNull();
        expect(fields.ktx2Loader).toBeNull();
      }
      expect(draco).not.toHaveBeenCalled();
      expect(ktx2).not.toHaveBeenCalled();
      expect(useWorkers).not.toHaveBeenCalled();
      // The decoder's WASM instantiates from its embedded bytes on this thread.
      await MeshoptDecoder.ready;
      expect(MeshoptDecoder.supported).toBe(true);
      expect(workers).toBe(0);
      // Only the GLBs themselves were fetched: no Draco/Basis decoder files.
      expect(stub.requests).toEqual([BODY_URL, 'packs/p/clip.glb']);
      expect(stub.requests.some(u => /draco|basis|ktx2|\.wasm$/i.test(u))).toBe(
        false,
      );
    } finally {
      meshopt.mockRestore();
      draco.mockRestore();
      ktx2.mockRestore();
      useWorkers.mockRestore();
      (globalThis as {Worker?: unknown}).Worker = original;
    }
  });

  it('REQ-AST-029: a resource URL outside the origin is refused by the URL modifier', async () => {
    const files = new Map([
      [
        BODY_URL,
        buildTestGlb({externalBufferUri: 'https://evil.example/x.bin'}),
      ],
    ]);
    const stub = createTestFetch(files);
    const loader = createGlbLoader({fetch: stub.fetch, origin: undefined});
    const result = await loader.load(BODY_URL, {
      errorCode: 'CMP_PART_LOAD_FAILED',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('https://evil.example/x.bin');
    expect(stub.requests).toEqual([BODY_URL]);
  });

  it('REQ-AST-029: a cross-origin GLB URL is refused before any fetch', async () => {
    const stub = createTestFetch(new Map());
    const loader = createGlbLoader({
      fetch: stub.fetch,
      origin: 'https://app.example',
    });
    const result = await loader.load('https://cdn.example/a.glb', {
      errorCode: 'ANM_CLIP_LOAD_FAILED',
    });
    expect(result.ok).toBe(false);
    expect(stub.requests).toEqual([]);
  });

  it('REQ-ANM-021: caches by URL + sha256 and does not cache failures', async () => {
    const files = new Map([[BODY_URL, buildTestGlb({region: [0, 0, 0]})]]);
    const stub = createTestFetch(files);
    const loader = createGlbLoader({fetch: stub.fetch, origin: undefined});
    const sha256 = 'a'.repeat(64);
    const a = await loader.load(BODY_URL, {
      sha256,
      errorCode: 'CMP_PART_LOAD_FAILED',
    });
    const b = await loader.load(BODY_URL, {
      sha256,
      errorCode: 'CMP_PART_LOAD_FAILED',
    });
    expect(loader.fetchCount).toBe(1);
    expect(a.ok && b.ok && a.value === b.value).toBe(true);
    await loader.load(BODY_URL, {
      sha256: 'b'.repeat(64),
      errorCode: 'CMP_PART_LOAD_FAILED',
    });
    expect(loader.fetchCount).toBe(2);
    await loader.load('missing.glb', {errorCode: 'CMP_PART_LOAD_FAILED'});
    await loader.load('missing.glb', {errorCode: 'CMP_PART_LOAD_FAILED'});
    expect(loader.fetchCount).toBe(4);
  });

  it('inspectGlb rejects truncated and non-GLB input', () => {
    const glb = buildTestGlb();
    expect(inspectGlb(glb).ok).toBe(true);
    expect(inspectGlb(glb.slice(0, glb.byteLength - 8)).ok).toBe(false);
    expect(inspectGlb(new TextEncoder().encode('{"asset":{}}').buffer).ok).toBe(
      false,
    );
  });
});

/** 1x1 PNG; the fake `<img>` never decodes it, the bytes only travel through a blob: URL. */
const PNG_1X1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48,
  0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89,
]);

/** Minimal `<img>` stand-in: records `src` and fires `load` asynchronously. */
class FakeImage extends EventTarget {
  static readonly sources: string[] = [];
  crossOrigin: string | null = null;
  private source = '';
  get src(): string {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    FakeImage.sources.push(value);
    queueMicrotask(() => this.dispatchEvent(new Event('load')));
  }
}

describe('loaders: embedded textures under CSP (REQ-GEN-010, architecture 4.10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeImage.sources.length = 0;
  });

  /** Browser-like globals: createImageBitmap exists, fetch is recorded, <img> is fake. */
  function stubBrowser(): string[] {
    const fetched: string[] = [];
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('createImageBitmap', () =>
      Promise.reject(new Error('createImageBitmap must not be used')),
    );
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(String(url));
      return Promise.reject(new Error('connect-src blocked'));
    });
    vi.stubGlobal('document', {
      createElementNS: (_ns: string, name: string) => {
        if (name !== 'img') throw new Error(`unexpected element ${name}`);
        return new FakeImage();
      },
    });
    return fetched;
  }

  it('AC-GEN-010.2 (engine part): the parser loads textures with a TextureLoader even when createImageBitmap exists', async () => {
    stubBrowser();
    // Control: without the plugin, three r186 picks ImageBitmapLoader (fetch-based).
    let control: GLTFParser | undefined;
    await new GLTFLoader()
      .register(parser => {
        control = parser;
        return {name: 'spy'};
      })
      .parseAsync(buildTestGlb(), '');
    expect(control?.textureLoader).toBeInstanceOf(ImageBitmapLoader);

    let seen: GLTFParser | undefined;
    const loader = new GLTFLoader();
    loader.register(parser => {
      seen = parser;
      return {name: 'spy'};
    });
    loader.register(imageElementTexturesPlugin);
    await loader.parseAsync(buildTestGlb(), '');
    expect(seen?.textureLoader).toBeInstanceOf(TextureLoader);
    expect(seen?.plugins[IMAGE_ELEMENT_TEXTURES_PLUGIN]).toBeDefined();
  });

  it('AC-GEN-010.2 (engine part): an embedded GLB texture loads via <img> from blob:, never fetch; sRGB, flipY false', async () => {
    const fetched = stubBrowser();
    const files = new Map([[BODY_URL, buildTestGlb({embeddedImage: PNG_1X1})]]);
    const stub = createTestFetch(files);
    const glb = createGlbLoader({
      fetch: stub.fetch,
      origin: 'https://app.example',
    });
    const result = await glb.load(BODY_URL, {
      errorCode: 'CMP_PART_LOAD_FAILED',
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(fetched).toEqual([]);
    expect(FakeImage.sources).toHaveLength(1);
    expect(FakeImage.sources[0]?.startsWith('blob:')).toBe(true);
    const material = firstMesh(result.value.scene)
      .material as MeshStandardMaterial;
    const map = material.map;
    if (map === null) throw new Error('base color texture missing');
    expect(map.image).toBeInstanceOf(FakeImage);
    expect(map.colorSpace).toBe(SRGBColorSpace);
    expect(map.flipY).toBe(false);
  });
});
