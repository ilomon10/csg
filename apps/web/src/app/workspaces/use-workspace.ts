import {useCallback, useMemo, useSyncExternalStore} from 'react';
import type {RenderSettings} from '@csg/parts-schema';
import {createFrameTiming} from '../../features/look';
import type {StructuralTiming} from '../../features/look';
import type {Catalog} from '../../shared/catalog';
import {projectCharacterTarget, useDocument} from '../../shared/document';
import type {CharacterTarget} from '../../shared/document';
import {createPreviewSettings} from '../viewport';
import {useMiniStore} from '../shell/mini-store';
import {useShell} from '../shell/shell-context';
import {focusRequestForField, queueFocusRequest} from './focus-request';

/** Below this width the workspaces show the view-only layout (REQ-UX-008, REQ-UX-068). */
export const VIEW_ONLY_BELOW = 768;

/** The shared catalog, or `null` while it loads. */
export function useCatalog(): Catalog | null {
  const {catalog} = useShell();
  return useMiniStore(catalog, s => s.catalog);
}

/** The open project's character as a {@link CharacterTarget} on the one shared history (REQ-UX-051). */
export function useProjectTarget(catalog: Catalog): CharacterTarget {
  const {store} = useShell();
  return useMemo(
    () => projectCharacterTarget(store, () => catalog),
    [store, catalog],
  );
}

/** The project's render settings, read fresh by the viewport on every change. */
export function useRenderSource(): () => RenderSettings {
  const {store} = useShell();
  return useCallback(
    () => store.getState().doc?.render ?? createPreviewSettings(),
    [store],
  );
}

/** Name of the open character, for the viewport label. */
export function useCharacterName(): string {
  const {store} = useShell();
  return useDocument(store, s => s.doc?.character.name ?? '');
}

/** Longest a structural change waits for its frame before it counts as shown (ms). */
const PRESENT_TIMEOUT_MS = 1000;

/** The timing for the look panel and the viewport callback that feeds it. */
export interface StructuralTimingHandle {
  readonly timing: StructuralTiming;
  /** Pass to the viewport's `onFramePresented`. */
  readonly onFramePresented: () => void;
}

/**
 * Timing for structural render changes (spec 003 budget 300 ms). `whenShown` resolves when the
 * viewport reports the frame of the change presented; if no frame arrives (no viewport, the
 * engine is still loading) it resolves after {@link PRESENT_TIMEOUT_MS}.
 */
export function useStructuralTiming(): StructuralTimingHandle {
  return useMemo(() => {
    const waiters = new Set<() => void>();
    const base = createFrameTiming(() => undefined);
    return {
      timing: {
        ...base,
        whenShown: () =>
          new Promise<void>(resolve => {
            const done = () => {
              clearTimeout(timer);
              waiters.delete(done);
              resolve();
            };
            const timer = setTimeout(done, PRESENT_TIMEOUT_MS);
            waiters.add(done);
          }),
      },
      onFramePresented: () => {
        for (const w of [...waiters]) w();
      },
    };
  }, []);
}

/** Switches to Pro and focuses the control that edits `field` ("Edit in Pro", REQ-UX-055). */
export function useEditInPro(): (field: string) => void {
  const {prefs} = useShell();
  return useCallback(
    (field: string) => {
      const request = focusRequestForField(field);
      queueFocusRequest(request);
      prefs.set({workspace: 'pro', inspectorTab: request.tab});
    },
    [prefs],
  );
}

function subscribeResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** The window's inner size in CSS px, kept current on resize. */
export function useWindowSize(): {
  readonly width: number;
  readonly height: number;
} {
  const width = useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth,
    () => 1280,
  );
  const height = useSyncExternalStore(
    subscribeResize,
    () => window.innerHeight,
    () => 800,
  );
  return {width, height};
}
