import type {UiPrefs} from '../../../shared/persistence';

/** Layout modes by window width (REQ-UX-006). */
export type LayoutMode = 'full' | 'compact' | 'tablet' | 'view-only';

/** Size limits in px (REQ-UX-002). */
export const LIMITS = {
  library: {min: 200, max: 480},
  inspector: {min: 280, max: 560},
  dockMin: 120,
  /** Collapsed dock: its tab strip only. */
  dockStrip: 36,
  /** The viewport keeps at least this much room while the dock is not maximized (REQ-UX-005). */
  viewportMin: 240,
  /** Height of the viewport toolbar and the drawer strip above the canvas. */
  viewportChrome: 64,
} as const;

/** The mode for a window width: docked at 1280+, library drawer at 1024+, both drawers at 768+. */
export function layoutMode(width: number): LayoutMode {
  if (width >= 1280) return 'full';
  if (width >= 1024) return 'compact';
  if (width >= 768) return 'tablet';
  return 'view-only';
}

/** Persisted layout sizes. */
export type LayoutPrefs = UiPrefs['layout'];

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(v)));

/**
 * Largest dock height: 60 % of the window, and never so tall that the viewport drops below its
 * minimum (REQ-UX-002, REQ-UX-005). `areaHeight` is the height below the top bar.
 */
export function dockMax(windowHeight: number, areaHeight: number): number {
  const byViewport =
    areaHeight - LIMITS.viewportMin - LIMITS.viewportChrome - 6;
  return Math.max(
    LIMITS.dockMin,
    Math.min(Math.floor(windowHeight * 0.6), byViewport),
  );
}

/** Clamps stored sizes into their limits. */
export function clampLayout(
  layout: LayoutPrefs,
  windowHeight: number,
  areaHeight: number,
): LayoutPrefs {
  return {
    ...layout,
    libraryPx: clamp(layout.libraryPx, LIMITS.library.min, LIMITS.library.max),
    inspectorPx: clamp(
      layout.inspectorPx,
      LIMITS.inspector.min,
      LIMITS.inspector.max,
    ),
    dockPx: clamp(
      layout.dockPx,
      LIMITS.dockMin,
      dockMax(windowHeight, areaHeight),
    ),
  };
}
