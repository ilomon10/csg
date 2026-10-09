/** Budget from change to visible result for a structural render change, in ms (M3-12). */
export const STRUCTURAL_BUDGET_MS = 300;

/** One measured structural change. */
export interface StructuralSample {
  /** What changed, for example `look-preset` or `resolution`. */
  readonly kind: string;
  readonly ms: number;
  readonly withinBudget: boolean;
}

/**
 * How a panel measures "dispatched until it shows". The shell injects `whenShown`, which
 * resolves once the viewport presented a frame with the new settings; the clock is injected
 * so tests stay deterministic.
 */
export interface StructuralTiming {
  now(): number;
  whenShown(): Promise<void>;
  report(sample: StructuralSample): void;
}

/** Runs `change`, waits until it shows and reports the elapsed time. */
export async function measureStructural(
  kind: string,
  change: () => void,
  timing: StructuralTiming,
): Promise<StructuralSample> {
  const start = timing.now();
  change();
  await timing.whenShown();
  const ms = timing.now() - start;
  const sample = {kind, ms, withinBudget: ms <= STRUCTURAL_BUDGET_MS};
  timing.report(sample);
  return sample;
}

/**
 * A timing for a shell without a viewport hook: the change shows after two animation frames
 * (the store notifies synchronously, the viewport renders on the next frame).
 */
export function createFrameTiming(
  report: (sample: StructuralSample) => void,
): StructuralTiming {
  const frame = () =>
    new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  return {
    now: () => performance.now(),
    whenShown: async () => {
      await frame();
      await frame();
    },
    report,
  };
}
