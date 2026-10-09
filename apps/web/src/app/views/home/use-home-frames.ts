import {useEffect, useMemo, useRef, useState} from 'react';
import type {CharacterSpec} from '@csg/parts-schema';
import type {Catalog} from '../../../shared/catalog';
import {
  createHomeFramesRepository,
  openCsgDatabase,
} from '../../../shared/persistence';
import type {DecodedImage} from '../../../shared/persistence';
import {createHomeFrameService} from '../../home-frames';
import type {HomeFrameService, HomeIdleClip} from '../../home-frames';
import {IDLE_CLIP, engineHost} from '../../viewport';
import type {EngineHost} from '../../viewport';
import type {Diagnostics} from '../../shell/renderer-status';

/** What the screen needs to know about the frames of one character. */
export interface FrameView {
  /** Decoded strip; only for the at most 7 animated characters (REQ-UX-080). */
  readonly strip: DecodedImage | null;
  readonly frameCount: number;
  readonly fps: number;
  /** PNG of the still avatar (REQ-UX-075). */
  readonly avatarBlob: Blob;
}

/** Read access to the frames of the lineup (a view over {@link HomeFrameService}). */
export interface FrameSource {
  view(id: string): FrameView | undefined;
  /** Calls `listener` when frames arrive or decoded images change. */
  subscribe(listener: () => void): () => void;
}

/** A lineup entry whose spec is known, in the shape of the frame service. */
export interface FrameRequestEntry {
  readonly id: string;
  readonly spec: CharacterSpec;
}

/** The idle clip with its manifest frame count and fps (REQ-UX-080). */
export function idleClipOf(catalog: Catalog): HomeIdleClip {
  const clip = catalog.clips.find(c => c.id === 'idle');
  if (clip === undefined) return {ref: IDLE_CLIP, frameCount: 12, fps: 5};
  const frameCount = Math.min(32, Math.max(1, clip.defaultFrameCount));
  const fps = Math.min(
    30,
    Math.max(1, Math.round(frameCount / Math.max(0.1, clip.durationSec))),
  );
  return {ref: clip.ref as HomeIdleClip['ref'], frameCount, fps};
}

/** Wraps a frame service as a {@link FrameSource}. */
export function frameSourceOf(service: HomeFrameService): FrameSource {
  return {
    view(id) {
      const key = service.keyOf(id);
      const frames = key === undefined ? undefined : service.frames(key);
      return frames === undefined
        ? undefined
        : {
            strip: frames.strip,
            frameCount: frames.frameCount,
            fps: frames.fps,
            avatarBlob: frames.avatarBlob,
          };
    },
    subscribe: l => service.subscribe(l),
  };
}

/** The host the home renderer leases from; reports the backend to the badge (REQ-GEN-002). */
function reportingHost(host: EngineHost, diagnostics: Diagnostics): EngineHost {
  return {
    ...host,
    async lease(canvas, options) {
      const result = await host.lease(canvas, options);
      if (result.ok) {
        diagnostics.reportRenderer({backend: result.value.renderer.backend});
      }
      return result;
    },
  };
}

/** Dependencies of {@link useHomeFrames}; injectable for tests. */
export interface HomeFramesDeps {
  readonly diagnostics: Diagnostics;
  readonly host?: EngineHost;
  /** Creates the service; the default opens its own IndexedDB connection. */
  readonly create?: (catalog: Catalog) => Promise<HomeFrameService | null>;
}

/**
 * Owns the home frame service for the life of the view: created once the catalog is known,
 * disposed (releasing the renderer lease) on unmount. The engine is not touched here; the
 * service takes its lease only on a cache miss and after first contentful paint (REQ-UX-083).
 */
export function useHomeFrames(
  catalog: Catalog | null,
  deps: HomeFramesDeps,
): {
  readonly source: FrameSource | null;
  readonly service: HomeFrameService | null;
} {
  const [service, setService] = useState<HomeFrameService | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  useEffect(() => {
    if (catalog === null) return;
    let cancelled = false;
    let created: HomeFrameService | null = null;
    void (async () => {
      try {
        const d = depsRef.current;
        let next: HomeFrameService | null;
        if (d.create !== undefined) {
          next = await d.create(catalog);
        } else {
          const opened = await openCsgDatabase();
          if (!opened.ok) return;
          const idle = idleClipOf(catalog);
          next = createHomeFrameService({
            host: reportingHost(d.host ?? engineHost, d.diagnostics),
            repository: createHomeFramesRepository(opened.value),
            packVersions: catalog.packVersions,
            idleClip: () => idle,
            onError: (_id, error) => d.diagnostics.recordError(error.code),
          });
        }
        if (cancelled) {
          next?.dispose();
          return;
        }
        created = next;
        setService(next);
      } catch {
        // No home renderer: the lineup keeps its placeholders.
      }
    })();
    return () => {
      cancelled = true;
      created?.dispose();
      setService(null);
    };
  }, [catalog]);
  const source = useMemo(
    () => (service === null ? null : frameSourceOf(service)),
    [service],
  );
  return {source, service};
}
