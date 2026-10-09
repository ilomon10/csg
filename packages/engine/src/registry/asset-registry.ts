/**
 * Asset registry of bundled parts and clips (architecture 3.6, spec 001 REQ-CMP-008, spec 004
 * REQ-ANM-001/002/021/022, spec 011 REQ-AST-022/028/029). User assets arrive in M5 (spec 008).
 */
import type {
  AssetLicense,
  AssetRef,
  ClipEntry,
  ClipManifest,
  ClipRef,
  PartEntry,
  PartManifest,
  RigDefinition,
  RigId,
  SlotId,
} from '@csg/parts-schema';
import type {
  ClipLoadFailedReason,
  EngineError,
  PartLoadFailedReason,
  Result,
} from '../contracts/errors';
import type {
  AssetRegistry,
  ClipEntryView,
  LoadedClip,
  LoadedPartInternal,
  PartEntryView,
} from '../contracts/registry';
import {createGlbLoader} from '../loaders/glb-loader';
import type {GlbLoader} from '../loaders/glb-loader';
import {joinPackUrl} from '../loaders/url-policy';
import {restPoseOf} from './rest-pose';

/** Options of {@link createAssetRegistry}. */
export interface AssetRegistryOptions {
  /** GLB loader (and its cache); default a new {@link createGlbLoader} loader. */
  readonly loader?: GlbLoader;
}

/**
 * The engine's registry: the {@link AssetRegistry} contract, with `resolve` returning the
 * engine-internal part view, plus lookups the composition and animation modules need.
 */
export interface EngineAssetRegistry extends AssetRegistry {
  /** The GLB loader this registry loads through (exposes `fetchCount`). */
  readonly loader: GlbLoader;
  /** Loads a part; failures return `CMP_PART_LOAD_FAILED`, never throw. */
  resolve(ref: AssetRef): Promise<Result<LoadedPartInternal, EngineError>>;
  /**
   * Registers a rig definition so clips on it can resolve without a part pack. Part packs
   * register their embedded `rigs[]` automatically; the first definition of a rig ID wins.
   */
  registerRig(rig: RigDefinition): void;
  /** Registered part entry, or `undefined`. */
  partEntry(ref: AssetRef): PartEntryView | undefined;
  /** Registered clip entry, or `undefined`. */
  clipEntry(ref: ClipRef): ClipEntryView | undefined;
}

interface PartRecord {
  readonly view: PartEntryView;
  readonly packId: string;
  readonly url: string;
  /** `part.rig`, or for static props the pack's first embedded rig. */
  readonly rigId: RigId | undefined;
}

interface ClipRecord {
  readonly view: ClipEntryView;
  readonly packId: string;
  readonly url: string;
}

const NOT_IMPLEMENTED_M5 = 'not implemented (M5)';

function partError(
  ref: string,
  reason: PartLoadFailedReason,
  message: string,
): {ok: false; error: EngineError} {
  return {
    ok: false,
    error: {
      code: 'CMP_PART_LOAD_FAILED',
      message: `${ref}: ${message}`,
      details: {ref, reason},
    },
  };
}

function clipError(
  ref: string,
  reason: ClipLoadFailedReason,
  message: string,
  extra: Record<string, unknown> = {},
): {ok: false; error: EngineError} {
  return {
    ok: false,
    error: {
      code: 'ANM_CLIP_LOAD_FAILED',
      message: `${ref}: ${message}`,
      details: {...extra, ref, reason},
    },
  };
}

/** Re-labels a loader error with the asset ref instead of the file URL. */
function withRef(
  error: EngineError,
  ref: string,
): {ok: false; error: EngineError} {
  return {
    ok: false,
    error: {
      ...error,
      message: `${ref}: ${error.message}`,
      details: {...error.details, ref, url: error.details?.['ref']},
    },
  };
}

/**
 * Creates the asset registry. Listing order is registration order (packs, then manifest
 * order), so it is deterministic. Resolved parts and clips are cached per ref; GLBs are cached
 * by URL and SHA-256 in the loader (REQ-ANM-021); failures are not cached.
 *
 * @param options Loader override (tests inject a fetch-counting loader).
 * @returns A registry whose `resolve`/`resolveClip` never throw.
 */
export function createAssetRegistry(
  options: AssetRegistryOptions = {},
): EngineAssetRegistry {
  const loader = options.loader ?? createGlbLoader();
  const rigs = new Map<RigId, RigDefinition>();
  const packLicenses = new Map<string, AssetLicense>();
  const parts = new Map<string, PartRecord>();
  const clips = new Map<string, ClipRecord>();
  const partCache = new Map<
    string,
    Promise<Result<LoadedPartInternal, EngineError>>
  >();
  const clipCache = new Map<string, Promise<Result<LoadedClip, EngineError>>>();

  const registerRig = (rig: RigDefinition): void => {
    if (!rigs.has(rig.id)) rigs.set(rig.id, rig);
  };

  const dropPack = <T extends {packId: string}>(
    map: Map<string, T>,
    cache: Map<string, unknown>,
    packId: string,
  ): void => {
    for (const [ref, record] of [...map]) {
      if (record.packId === packId) {
        map.delete(ref);
        cache.delete(ref);
      }
    }
  };

  const resolvePart = async (
    ref: AssetRef,
  ): Promise<Result<LoadedPartInternal, EngineError>> => {
    const record = parts.get(ref);
    if (record === undefined) {
      return partError(ref, 'not-registered', 'part is not registered');
    }
    const entry: PartEntry = record.view;
    const rig = record.rigId === undefined ? undefined : rigs.get(record.rigId);
    if (rig === undefined) {
      return partError(
        ref,
        'not-registered',
        `rig "${record.rigId ?? ''}" is not registered`,
      );
    }
    const loaded = await loader.load(record.url, {
      sha256: entry.sha256,
      errorCode: 'CMP_PART_LOAD_FAILED',
      convertRegion: entry.slot === 'body',
    });
    if (!loaded.ok) return withRef(loaded.error, ref);
    return {ok: true, value: {ref, entry, rig, scene: loaded.value.scene}};
  };

  const resolveClipUncached = async (
    ref: ClipRef,
  ): Promise<Result<LoadedClip, EngineError>> => {
    const record = clips.get(ref);
    if (record === undefined) {
      return clipError(ref, 'not-registered', 'clip is not registered');
    }
    const entry: ClipEntry = record.view;
    const rig = rigs.get(entry.rig);
    if (rig === undefined) {
      return clipError(
        ref,
        'not-registered',
        `rig "${entry.rig}" is not registered`,
      );
    }
    const source = restPoseOf(rig, entry.skeletonGroup);
    if (!source.ok) {
      return clipError(ref, 'not-registered', source.error.message, {
        cause: source.error.code,
      });
    }
    const loaded = await loader.load(record.url, {
      sha256: entry.sha256,
      errorCode: 'ANM_CLIP_LOAD_FAILED',
    });
    if (!loaded.ok) return withRef(loaded.error, ref);
    const clip = loaded.value.animations.find(a => a.name === entry.sourceName);
    if (clip === undefined) {
      return clipError(
        ref,
        'animation-missing',
        `no animation named "${entry.sourceName}" in ${record.url}`,
      );
    }
    return {
      ok: true,
      value: {
        ref,
        entry,
        durationSec: entry.durationSec,
        clip,
        rig,
        source: source.value,
      },
    };
  };

  const cached = <T>(
    cache: Map<string, Promise<Result<T, EngineError>>>,
    ref: string,
    run: () => Promise<Result<T, EngineError>>,
  ): Promise<Result<T, EngineError>> => {
    const hit = cache.get(ref);
    if (hit !== undefined) return hit;
    const pending = run().then(result => {
      if (!result.ok && cache.get(ref) === pending) cache.delete(ref);
      return result;
    });
    cache.set(ref, pending);
    return pending;
  };

  return {
    loader,
    registerRig,

    registerPack(manifest: PartManifest, baseUrl: string): void {
      for (const rig of manifest.rigs) registerRig(rig);
      dropPack(parts, partCache, manifest.packId);
      packLicenses.set(manifest.packId, manifest.license);
      for (const part of manifest.parts) {
        const ref: AssetRef = `builtin:${manifest.packId}/${part.id}`;
        parts.set(ref, {
          view: {...part, ref, source: 'builtin'},
          packId: manifest.packId,
          url: joinPackUrl(baseUrl, part.file),
          rigId: part.rig ?? manifest.rigs[0]?.id,
        });
      }
    },

    registerClips(manifest: ClipManifest, baseUrl: string): void {
      dropPack(clips, clipCache, manifest.packId);
      packLicenses.set(`clips:${manifest.packId}`, manifest.license);
      for (const clip of manifest.clips) {
        const ref: ClipRef = `builtin:${manifest.packId}/${clip.id}`;
        clips.set(ref, {
          view: {...clip, ref, source: 'builtin'},
          packId: manifest.packId,
          url: joinPackUrl(baseUrl, clip.file),
        });
      }
    },

    registerUserAsset(): void {
      throw new Error(NOT_IMPLEMENTED_M5);
    },

    unregisterUserAsset(): void {
      throw new Error(NOT_IMPLEMENTED_M5);
    },

    list(filter: {slot?: SlotId; rig?: RigId} = {}): PartEntryView[] {
      const out: PartEntryView[] = [];
      for (const {view} of parts.values()) {
        if (filter.slot !== undefined && view.slot !== filter.slot) continue;
        // Static props carry no rig and fit every rig.
        if (
          filter.rig !== undefined &&
          view.rig !== undefined &&
          view.rig !== filter.rig
        ) {
          continue;
        }
        out.push(view);
      }
      return out;
    },

    listClips(filter: {rig?: RigId} = {}): ClipEntryView[] {
      // REQ-ANM-002: same rig, any skeleton group. Bone maps to other rigs arrive in M5.
      const out: ClipEntryView[] = [];
      for (const {view} of clips.values()) {
        if (filter.rig !== undefined && view.rig !== filter.rig) continue;
        out.push(view);
      }
      return out;
    },

    resolve(ref: AssetRef) {
      return cached(partCache, ref, () => resolvePart(ref));
    },

    resolveClip(ref: ClipRef) {
      return cached(clipCache, ref, () => resolveClipUncached(ref));
    },

    licenseOf(ref: AssetRef | ClipRef): AssetLicense {
      const part = parts.get(ref);
      if (part !== undefined) {
        const license = part.view.license ?? packLicenses.get(part.packId);
        if (license !== undefined) return license;
      }
      const clip = clips.get(ref);
      if (clip !== undefined) {
        const license =
          clip.view.license ?? packLicenses.get(`clips:${clip.packId}`);
        if (license !== undefined) return license;
      }
      throw new Error(`licenseOf: "${ref}" is not registered`);
    },

    rigOf(ref: AssetRef | ClipRef): RigDefinition | undefined {
      const rigId = parts.get(ref)?.view.rig ?? clips.get(ref)?.view.rig;
      return rigId === undefined ? undefined : rigs.get(rigId);
    },

    partEntry(ref: AssetRef): PartEntryView | undefined {
      return parts.get(ref)?.view;
    },

    clipEntry(ref: ClipRef): ClipEntryView | undefined {
      return clips.get(ref)?.view;
    },
  };
}
