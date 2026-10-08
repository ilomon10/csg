/**
 * Bundled GLB loader (spec 011 REQ-AST-028/029, spec 004 REQ-ANM-021/022).
 *
 * `GLTFLoader` with the Meshopt decoder only: no Draco loader, no KTX2 loader, no workers
 * (the decoder runs on the calling thread; `useWorkers` is never called). Bytes are fetched by
 * this module, checked against the URL policy and the extension deny list, then parsed.
 * Textures decode through `<img>` (see `image-element-textures.ts`, REQ-GEN-010).
 */
import {LoadingManager} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {parseJson} from '@csg/parts-schema';
import type {EngineError, Result} from '../contracts/errors';
import type {LoadGlb, LoadGlbOptions} from '../contracts/loaders';
import {registerImageElementTextures} from './image-element-textures';
import {convertRegionAttribute} from './region';
import {BLOCKED_URL, isAllowedAssetUrl} from './url-policy';

/** glTF extensions a bundled GLB must not declare (REQ-AST-029). */
export const DISALLOWED_GLTF_EXTENSIONS: readonly string[] = [
  'KHR_draco_mesh_compression',
  'KHR_texture_basisu',
];

/** `details.reason` values the loader produces (subset shared by parts and clips). */
export type GlbFailureReason =
  'network' | 'parse' | 'region-missing' | 'extension-not-allowed';

/** Minimal `fetch` shape the loader needs; injectable for tests. */
export type GlbFetch = (url: string) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Options of {@link createGlbLoader}. */
export interface GlbLoaderConfig {
  /** Fetch implementation; default `globalThis.fetch`. */
  readonly fetch?: GlbFetch;
  /**
   * The app's own origin (for example `https://app.example`); default
   * `globalThis.location.origin` when present. Without one, only relative URLs and `blob:`
   * are allowed.
   */
  readonly origin?: string;
}

/** A bundled-GLB loader with its own cache keyed by URL and SHA-256. */
export interface GlbLoader {
  /** Loads a GLB; see {@link LoadGlb}. */
  readonly load: LoadGlb;
  /** Number of network fetches issued so far (cache hits issue none; AC-ANM-021.2). */
  readonly fetchCount: number;
  /** Drops every cached result. Parsed objects stay owned by whoever holds them. */
  clear(): void;
}

/** Facts read from a GLB container before parsing. */
export interface GlbInspection {
  /** Union of `extensionsUsed` and `extensionsRequired`, sorted. */
  readonly extensions: readonly string[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Reads the GLB header and JSON chunk without parsing buffers. Rejects non-GLB input,
 * truncated containers, invalid JSON and JSON with forbidden keys (REQ-GEN-011).
 *
 * @param data GLB bytes.
 * @returns The declared extensions, or an error message.
 */
export function inspectGlb(
  data: ArrayBuffer,
): {ok: true; value: GlbInspection} | {ok: false; message: string} {
  if (data.byteLength < HEADER_BYTES + CHUNK_HEADER_BYTES) {
    return {ok: false, message: 'file is shorter than a GLB header'};
  }
  const view = new DataView(data);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return {ok: false, message: 'not a binary glTF (bad magic)'};
  }
  if (view.getUint32(4, true) !== 2) {
    return {ok: false, message: 'unsupported GLB version'};
  }
  const declared = view.getUint32(8, true);
  if (declared > data.byteLength) {
    return {
      ok: false,
      message: `truncated GLB: header says ${declared} bytes, got ${data.byteLength}`,
    };
  }
  const jsonLength = view.getUint32(HEADER_BYTES, true);
  const jsonType = view.getUint32(HEADER_BYTES + 4, true);
  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (jsonType !== CHUNK_JSON || jsonStart + jsonLength > declared) {
    return {ok: false, message: 'GLB JSON chunk is missing or truncated'};
  }
  const text = new TextDecoder().decode(
    new Uint8Array(data, jsonStart, jsonLength),
  );
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `GLB JSON: ${parsed.issues.map(i => i.message).join('; ')}`,
    };
  }
  const json =
    typeof parsed.value === 'object' && parsed.value !== null
      ? (parsed.value as Record<string, unknown>)
      : {};
  const extensions = [
    ...new Set([
      ...stringList(json['extensionsUsed']),
      ...stringList(json['extensionsRequired']),
    ]),
  ].sort();
  return {ok: true, value: {extensions}};
}

function defaultOrigin(): string | undefined {
  const location = (globalThis as {location?: {origin?: unknown}}).location;
  const origin = location?.origin;
  return typeof origin === 'string' && origin !== 'null' ? origin : undefined;
}

function defaultFetch(): GlbFetch {
  return url => globalThis.fetch(url);
}

function resourcePathOf(url: string): string {
  const index = url.lastIndexOf('/');
  return index < 0 ? '' : url.slice(0, index + 1);
}

/**
 * Creates a bundled-GLB loader (REQ-AST-029). Results are cached by `url` + `sha256`
 * (REQ-ANM-021); failures are not cached, so a later call retries. With `convertRegion`, every
 * mesh's `_region` becomes Float32 `regionId` (REQ-AST-028).
 *
 * @param config Fetch and origin overrides.
 * @returns A loader whose `load` never throws.
 */
export function createGlbLoader(config: GlbLoaderConfig = {}): GlbLoader {
  const fetchImpl = config.fetch ?? defaultFetch();
  const origin = 'origin' in config ? config.origin : defaultOrigin();
  const cache = new Map<string, Promise<Result<GLTF, EngineError>>>();
  let fetchCount = 0;

  const fail = (
    url: string,
    options: LoadGlbOptions,
    reason: GlbFailureReason,
    message: string,
  ): Result<GLTF, EngineError> => ({
    ok: false,
    error: {
      code: options.errorCode,
      message: `${url}: ${message}`,
      details: {ref: url, reason},
    },
  });

  const parse = async (
    url: string,
    data: ArrayBuffer,
  ): Promise<{ok: true; gltf: GLTF} | {ok: false; message: string}> => {
    const refused: string[] = [];
    const manager = new LoadingManager();
    manager.setURLModifier(resource => {
      if (isAllowedAssetUrl(resource, origin)) return resource;
      refused.push(resource);
      return BLOCKED_URL;
    });
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    // Embedded textures load as <img> from blob: (CSP img-src), not fetch (REQ-GEN-010).
    registerImageElementTextures(loader);
    try {
      const gltf = await loader.parseAsync(data, resourcePathOf(url));
      if (refused.length > 0) {
        return {ok: false, message: `refused URLs: ${refused.join(', ')}`};
      }
      return {ok: true, gltf};
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message:
          refused.length > 0
            ? `refused URLs: ${refused.join(', ')} (${detail})`
            : detail,
      };
    }
  };

  const loadUncached = async (
    url: string,
    options: LoadGlbOptions,
  ): Promise<Result<GLTF, EngineError>> => {
    if (!isAllowedAssetUrl(url, origin)) {
      return fail(url, options, 'network', 'URL is not same-origin or blob:');
    }
    let data: ArrayBuffer;
    try {
      fetchCount++;
      const response = await fetchImpl(url);
      if (!response.ok) {
        return fail(url, options, 'network', `HTTP ${response.status}`);
      }
      data = await response.arrayBuffer();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail(url, options, 'network', detail);
    }
    const inspection = inspectGlb(data);
    if (!inspection.ok) return fail(url, options, 'parse', inspection.message);
    const denied = inspection.value.extensions.filter(name =>
      DISALLOWED_GLTF_EXTENSIONS.includes(name),
    );
    if (denied.length > 0) {
      return fail(
        url,
        options,
        'extension-not-allowed',
        `declares ${denied.join(', ')}`,
      );
    }
    const parsed = await parse(url, data);
    if (!parsed.ok) return fail(url, options, 'parse', parsed.message);
    return {ok: true, value: parsed.gltf};
  };

  const load: LoadGlb = async (url, options) => {
    const key = `${url}#${options.sha256 ?? ''}`;
    let pending = cache.get(key);
    if (pending === undefined) {
      pending = loadUncached(url, options);
      cache.set(key, pending);
    }
    const result = await pending;
    if (!result.ok) {
      if (cache.get(key) === pending) cache.delete(key);
      // Re-label a shared failure with this call's error code.
      return result.error.code === options.errorCode
        ? result
        : {ok: false, error: {...result.error, code: options.errorCode}};
    }
    if (
      options.convertRegion === true &&
      !convertRegionAttribute(result.value.scene)
    ) {
      return fail(
        url,
        options,
        'region-missing',
        'body part has no _REGION vertex attribute',
      );
    }
    return result;
  };

  return {
    load,
    get fetchCount() {
      return fetchCount;
    },
    clear() {
      cache.clear();
    },
  };
}
