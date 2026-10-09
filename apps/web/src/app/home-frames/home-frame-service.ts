import type {EngineError} from '@csg/engine';
import type {CharacterSpec} from '@csg/parts-schema';
import type {
  DecodedImage,
  HomeFramesRecord,
  HomeFramesRepository,
  ImageDecoder,
} from '../../shared/persistence';
import {afterFirstContentfulPaint} from '../viewport/after-first-paint';
import type {EngineHost, RendererLease} from '../viewport/engine-host';
import {AVATAR_PX, composeStrip, cropAvatar} from './avatar-crop';
import type {PixelFrame} from './avatar-crop';
import {
  createHomeCanvas,
  decodeImage,
  documentVisibility,
  encodePng,
  yieldToMain,
} from './browser-deps';
import type {VisibilitySource} from './browser-deps';
import {homeFramesKey} from './home-frames-key';
import {HOME_RENDER_PROFILE, homeRenderSettings} from './home-profile';
import type {HomeIdleClip} from './home-profile';

/** At most this many lineup characters animate: the selected one plus or minus 3 (REQ-UX-080). */
export const MAX_ANIMATED = 7;

/** One character of the lineup. */
export interface LineupEntry {
  /** Stable ID (the project ID, or the preset ID). */
  readonly id: string;
  readonly spec: CharacterSpec;
}

/** The frames of one character (REQ-UX-080, REQ-UX-082). */
export interface HomeFrames {
  readonly key: string;
  readonly frameCount: number;
  readonly fps: number;
  /** PNG, (64 x frameCount) x 64 px. */
  readonly stripBlob: Blob;
  /** PNG, 64 x 64 px. */
  readonly avatarBlob: Blob;
  /** Decoded strip (an `ImageBitmap`); only for the at most 7 animated characters. */
  readonly strip: DecodedImage | null;
  /** Decoded avatar (an `ImageBitmap`); only for the animated characters. */
  readonly avatar: DecodedImage | null;
}

/** Pre-renders the lineup's idle frames and avatars one character at a time (REQ-UX-080). */
export interface HomeFrameService {
  /**
   * Asks for the frames of `order`, the selected character first and then outward (+1, -1, +2,
   * ...). A later call supersedes an earlier one at the next character boundary.
   */
  request(order: readonly LineupEntry[], selectedIndex: number): void;
  /** The frames for a cache key, once ready. */
  frames(key: string): HomeFrames | undefined;
  /** The cache key of a lineup entry once computed. */
  keyOf(entryId: string): string | undefined;
  /** Whether playback is paused because the page is hidden. */
  isPaused(): boolean;
  /** Calls `listener` when frames arrive, decoded images change or playback pauses or resumes. */
  subscribe(listener: () => void): () => void;
  /** Stops work, releases the renderer lease and closes decoded images. */
  dispose(): void;
}

/** Dependencies of {@link createHomeFrameService}; everything browser-bound is injectable. */
export interface HomeFrameServiceOptions {
  readonly host: EngineHost;
  readonly repository: Pick<
    HomeFramesRepository,
    'get' | 'put' | 'touch' | 'evictUnreferenced'
  >;
  /** `packId@<hash>` per pack (catalog `packVersions`, decision D10). */
  readonly packVersions: readonly string[];
  /** The idle clip with its manifest frame count and fps. */
  readonly idleClip: () => HomeIdleClip;
  /** Called when a character cannot be rendered (it keeps its placeholder). */
  readonly onError?: (entryId: string, error: EngineError) => void;
  readonly decode?: ImageDecoder;
  readonly encodePng?: (
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ) => Promise<Blob>;
  readonly yieldToMain?: () => Promise<void>;
  readonly visibility?: VisibilitySource;
  /** Resolves when the engine chunk may be requested (after first contentful paint). */
  readonly afterFirstPaint?: () => Promise<void>;
  readonly createCanvas?: () => HTMLCanvasElement | OffscreenCanvas;
  readonly now?: () => number;
}

interface Entry {
  readonly key: string;
  readonly frameCount: number;
  readonly fps: number;
  readonly stripBlob: Blob;
  readonly avatarBlob: Blob;
  strip: DecodedImage | null;
  avatar: DecodedImage | null;
  /** True while a decode is running. */
  decoding: boolean;
}

/** Indexes from `selected` outward: selected, +1, -1, +2, -2, ... */
export function outwardOrder(count: number, selected: number): number[] {
  const start = Math.min(Math.max(0, selected), Math.max(0, count - 1));
  const out: number[] = count > 0 ? [start] : [];
  for (let d = 1; out.length < count; d++) {
    if (start + d < count) out.push(start + d);
    if (start - d >= 0) out.push(start - d);
  }
  return out;
}

function firstPaint(): Promise<void> {
  return new Promise(resolve => {
    afterFirstContentfulPaint(resolve);
  });
}

/**
 * Creates the home frame service. One offscreen renderer (taken from the engine host only on a
 * cache miss and after first contentful paint, REQ-UX-083) renders one character at a time with
 * `renderFrames` and the fixed home profile; between characters the main thread is yielded
 * (`scheduler.yield`, else `setTimeout`). Results are cached in memory and persisted through the
 * validated `home-frames` repository (REQ-UX-082). Playback pauses while the page is hidden.
 */
export function createHomeFrameService(
  options: HomeFrameServiceOptions,
): HomeFrameService {
  const decode = options.decode ?? decodeImage;
  const encode = options.encodePng ?? encodePng;
  const yieldFn = options.yieldToMain ?? yieldToMain;
  const visibility = options.visibility ?? documentVisibility;
  const afterPaint = options.afterFirstPaint ?? firstPaint;
  const createCanvas = options.createCanvas ?? createHomeCanvas;
  const now = options.now ?? (() => Date.now());

  const entries = new Map<string, Entry>();
  const keyById = new Map<string, string>();
  const failed = new Set<string>();
  const keyCache = new WeakMap<CharacterSpec, Promise<string>>();
  const listeners = new Set<() => void>();
  let order: readonly LineupEntry[] = [];
  let selected = 0;
  let generation = 0;
  let disposed = false;
  let paused = visibility.isHidden();
  let lease: Promise<RendererLease | null> | null = null;
  let abort = new AbortController();
  let drainChain: Promise<void> = Promise.resolve();
  let releaseWanted = false;
  let leaseError: EngineError = {
    code: 'PIX_BACKEND_UNAVAILABLE',
    message: 'The home renderer is unavailable',
  };
  let visibleWaiters: Array<() => void> = [];

  const emit = (): void => {
    for (const l of [...listeners]) l();
  };

  const stopVisibility = visibility.subscribe(() => {
    const hidden = visibility.isHidden();
    if (hidden === paused) return;
    paused = hidden;
    if (!paused) {
      const waiters = visibleWaiters;
      visibleWaiters = [];
      for (const w of waiters) w();
    }
    emit();
  });

  const whenVisible = (): Promise<void> =>
    paused
      ? new Promise<void>(resolve => visibleWaiters.push(resolve))
      : Promise.resolve();

  const keyFor = (spec: CharacterSpec): Promise<string> => {
    let key = keyCache.get(spec);
    if (key === undefined) {
      key = homeFramesKey(spec, options.packVersions);
      keyCache.set(spec, key);
    }
    return key;
  };

  /** The decoded set: the selected character plus or minus 3, at most 7 (REQ-UX-080). */
  const windowKeys = (): Set<string> => {
    const keys = new Set<string>();
    const half = (MAX_ANIMATED - 1) / 2;
    for (let i = selected - half; i <= selected + half; i++) {
      const id = order[i]?.id;
      const key = id === undefined ? undefined : keyById.get(id);
      if (key !== undefined) keys.add(key);
    }
    return keys;
  };

  const close = (entry: Entry): void => {
    entry.strip?.close?.();
    entry.avatar?.close?.();
    entry.strip = null;
    entry.avatar = null;
  };

  /** Decodes what is inside the window and closes what is outside (no off-screen decoding). */
  async function reconcile(): Promise<void> {
    const inside = windowKeys();
    for (const [key, entry] of entries) {
      if (!inside.has(key)) {
        close(entry);
        continue;
      }
      if (entry.strip !== null || entry.decoding) continue;
      entry.decoding = true;
      try {
        const [strip, avatar] = await Promise.all([
          decode(entry.stripBlob),
          decode(entry.avatarBlob),
        ]);
        if (disposed || !windowKeys().has(key) || entries.get(key) !== entry) {
          strip.close?.();
          avatar.close?.();
        } else {
          entry.strip = strip;
          entry.avatar = avatar;
        }
      } catch {
        // The blobs were encoded here or validated by the repository; a decode failure
        // leaves the character on its placeholder.
      } finally {
        entry.decoding = false;
      }
    }
    emit();
  }

  const accept = (
    record: Pick<
      HomeFramesRecord,
      'key' | 'frameCount' | 'fps' | 'strip' | 'avatar'
    >,
    decoded?: {strip: DecodedImage; avatar: DecodedImage},
  ): void => {
    const entry: Entry = {
      key: record.key,
      frameCount: record.frameCount,
      fps: record.fps,
      stripBlob: record.strip,
      avatarBlob: record.avatar,
      strip: decoded?.strip ?? null,
      avatar: decoded?.avatar ?? null,
      decoding: false,
    };
    entries.get(record.key)?.strip?.close?.();
    entries.set(record.key, entry);
    if (!windowKeys().has(record.key)) close(entry);
  };

  const acquire = (): Promise<RendererLease | null> => {
    lease ??= (async () => {
      await afterPaint();
      if (disposed) return null;
      const idle = options.idleClip();
      const result = await options.host.lease(createCanvas(), {
        settings: homeRenderSettings(idle),
        onError: () => undefined,
        onPreempt: () => {
          // Another view wants the renderer: stop after the current character.
          releaseWanted = true;
          generation++;
          abort.abort();
          // A hidden tab parks the drain in `whenVisible`: wake it so it releases now.
          const waiters = visibleWaiters;
          visibleWaiters = [];
          for (const w of waiters) w();
        },
      });
      if (result.ok) return result.value;
      lease = null;
      leaseError = result.error;
      return null;
    })();
    return lease;
  };

  const release = async (): Promise<void> => {
    const held = lease;
    lease = null;
    releaseWanted = false;
    abort = new AbortController();
    (await held)?.release();
  };

  async function renderEntry(entry: LineupEntry, key: string): Promise<void> {
    const held = await acquire();
    if (disposed) return;
    if (held === null) {
      failed.add(key);
      options.onError?.(entry.id, leaseError);
      return;
    }
    const {renderer} = held;
    const set = await renderer.setCharacter(entry.spec);
    if (!set.ok) {
      failed.add(key);
      options.onError?.(entry.id, set.error);
      return;
    }
    const settings = homeRenderSettings(options.idleClip());
    const prepared = await renderer.prepareFrames(settings, {
      signal: abort.signal,
    });
    if (!prepared.ok) {
      failed.add(key);
      options.onError?.(entry.id, prepared.error);
      return;
    }
    const frames: PixelFrame[] = [];
    for await (const f of renderer.renderFrames(prepared.value, {
      signal: abort.signal,
    })) {
      frames.push({width: f.width, height: f.height, pixels: f.pixels});
    }
    const first = frames[0];
    const cell = HOME_RENDER_PROFILE.resolution;
    if (
      first === undefined ||
      frames.length > 32 ||
      frames.some(f => f.width !== cell || f.height !== cell)
    ) {
      failed.add(key);
      return;
    }
    const strip = composeStrip(frames);
    const [stripBlob, avatarBlob] = await Promise.all([
      encode(strip.pixels, strip.width, strip.height),
      encode(cropAvatar(first), AVATAR_PX, AVATAR_PX),
    ]);
    const animation = settings.animations[0];
    const record: HomeFramesRecord = {
      format: 'sprite-home-frames',
      version: 1,
      key,
      frameCount: frames.length,
      fps: animation?.fps ?? 1,
      strip: stripBlob,
      avatar: avatarBlob,
      lastUsed: now(),
    };
    await options.repository.put(record);
    accept(record);
  }

  async function drain(gen: number): Promise<void> {
    const list = order;
    try {
      for (const index of outwardOrder(list.length, selected)) {
        if (disposed || gen !== generation) return;
        await whenVisible();
        if (disposed || gen !== generation) return;
        const entry = list[index];
        if (entry === undefined) continue;
        const key = await keyFor(entry.spec);
        keyById.set(entry.id, key);
        if (entries.has(key)) {
          void reconcile();
          continue;
        }
        if (failed.has(key)) continue;
        const stored = await options.repository.get(key, decode);
        if (disposed || gen !== generation) {
          stored?.strip.close?.();
          stored?.avatar.close?.();
          return;
        }
        if (stored !== null) {
          accept(stored.record, {strip: stored.strip, avatar: stored.avatar});
          void options.repository.touch(key);
          await reconcile();
          await yieldFn();
          continue;
        }
        await yieldFn();
        if (disposed || gen !== generation) return;
        try {
          await renderEntry(entry, key);
        } catch (error) {
          // A superseded or preempted render is not a failure: the character is retried.
          if (
            abort.signal.aborted ||
            (error as {code?: unknown}).code === 'EXP_CANCELLED'
          ) {
            return;
          }
          failed.add(key);
          options.onError?.(entry.id, {
            code: 'PIX_PREVIEW_FAILED',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        await reconcile();
        await yieldFn();
      }
      if (gen === generation && !disposed) {
        await options.repository.evictUnreferenced(
          new Set(
            list.map(e => keyById.get(e.id)).filter(k => k !== undefined),
          ),
        );
      }
    } finally {
      if (releaseWanted || gen === generation) await release();
    }
  }

  return {
    request(next, selectedIndex) {
      if (disposed) return;
      order = next;
      selected = selectedIndex;
      const gen = ++generation;
      releaseWanted = false;
      for (const e of next) {
        const known = keyCache.get(e.spec);
        if (known !== undefined) void known.then(k => keyById.set(e.id, k));
      }
      drainChain = drainChain.then(() => drain(gen)).catch(() => undefined);
    },
    frames(key) {
      const e = entries.get(key);
      return e === undefined
        ? undefined
        : {
            key: e.key,
            frameCount: e.frameCount,
            fps: e.fps,
            stripBlob: e.stripBlob,
            avatarBlob: e.avatarBlob,
            strip: e.strip,
            avatar: e.avatar,
          };
    },
    keyOf: id => keyById.get(id),
    isPaused: () => paused,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      abort.abort();
      stopVisibility();
      for (const w of visibleWaiters) w();
      visibleWaiters = [];
      for (const entry of entries.values()) close(entry);
      entries.clear();
      listeners.clear();
      void release();
    },
  };
}
