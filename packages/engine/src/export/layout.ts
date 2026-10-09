/** Sheet layout arithmetic (REQ-EXP-003..007, REQ-EXP-009). Pure. */

/** One (clip, direction) run of frames. */
export interface LayoutGroup {
  /** Index into the animation list. */
  readonly clip: number;
  readonly direction: number;
  /** Frames in the run. */
  readonly count: number;
}

/** Layout options shared by planning and writing. */
export interface LayoutOptions {
  readonly layout: 'grid-by-animation' | 'strip-per-animation';
  readonly rowOrder: 'clip-major' | 'direction-major';
  readonly maxColumns: number | null;
}

/** Position (in cells) of one frame of a group. */
export interface PlacedCell {
  /** Index into the groups array. */
  readonly group: number;
  /** Frame position within the group. */
  readonly k: number;
  readonly col: number;
  readonly row: number;
}

/** One sheet: its grid size in cells and where every frame goes. */
export interface SheetGrid {
  /** Animation index of a strip sheet; `null` for the single grid sheet. */
  readonly clip: number | null;
  readonly cols: number;
  readonly rows: number;
  readonly cells: PlacedCell[];
}

/**
 * Places groups on one or more sheets. Each group starts on a new row and wraps after
 * `maxColumns` frames, so a row never mixes two groups (REQ-EXP-004). `grid-by-animation` is one
 * sheet ordered clip-major or direction-major; `strip-per-animation` is one sheet per clip with
 * one row set per direction.
 *
 * @param groups Runs in clip, direction order.
 * @param options Layout, row order, wrap.
 * @returns The sheets; empty when there are no groups.
 */
export function layoutSheets(
  groups: readonly LayoutGroup[],
  options: LayoutOptions,
): SheetGrid[] {
  const place = (clip: number | null, indices: number[]): SheetGrid => {
    const cells: PlacedCell[] = [];
    let row = 0;
    let cols = 0;
    for (const g of indices) {
      const group = groups[g];
      if (group === undefined) continue;
      const wrap = options.maxColumns ?? group.count;
      cols = Math.max(cols, Math.min(group.count, wrap));
      for (let k = 0; k < group.count; k++) {
        cells.push({
          group: g,
          k,
          col: k % wrap,
          row: row + Math.floor(k / wrap),
        });
      }
      row += Math.ceil(group.count / wrap);
    }
    return {clip, cols, rows: row, cells};
  };
  const all = groups.map((_, i) => i);
  if (options.layout === 'strip-per-animation') {
    const clips = [...new Set(groups.map(g => g.clip))];
    return clips.map(clip =>
      place(
        clip,
        all.filter(i => groups[i]?.clip === clip),
      ),
    );
  }
  if (all.length === 0) return [];
  if (options.rowOrder === 'direction-major') {
    all.sort((a, b) => {
      const ga = groups[a];
      const gb = groups[b];
      if (ga === undefined || gb === undefined) return 0;
      return ga.direction - gb.direction || ga.clip - gb.clip;
    });
  }
  return [place(null, all)];
}

/** Smallest power of two that is at least `n` (`n >= 1`). */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Sheet size options. */
export interface SheetMetrics {
  readonly cellW: number;
  readonly cellH: number;
  readonly paddingPx: number;
  readonly marginPx: number;
  readonly powerOfTwo: boolean;
}

/** Top-left of cell (`col`, `row`) at scale 1. */
export function cellOrigin(
  m: SheetMetrics,
  col: number,
  row: number,
): {x: number; y: number} {
  return {
    x: m.marginPx + col * (m.cellW + m.paddingPx),
    y: m.marginPx + row * (m.cellH + m.paddingPx),
  };
}

/**
 * Pixel size of a sheet at `scale`: margins, cells and padding all scale, then power-of-two
 * rounding applies to each axis independently (REQ-EXP-006, 007, 009).
 */
export function sheetSize(
  m: SheetMetrics,
  grid: Pick<SheetGrid, 'cols' | 'rows'>,
  scale: number,
): {width: number; height: number} {
  const w1 =
    2 * m.marginPx + grid.cols * m.cellW + (grid.cols - 1) * m.paddingPx;
  const h1 =
    2 * m.marginPx + grid.rows * m.cellH + (grid.rows - 1) * m.paddingPx;
  const width = w1 * scale;
  const height = h1 * scale;
  return m.powerOfTwo
    ? {width: nextPowerOfTwo(width), height: nextPowerOfTwo(height)}
    : {width, height};
}
