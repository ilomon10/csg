import {describe, expect, it} from 'vitest';
import type {Mesh} from 'three';
import {
  REGION_ATTRIBUTE,
  SOURCE_REGION_ATTRIBUTE,
  createGlbLoader,
  inspectGlb,
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
