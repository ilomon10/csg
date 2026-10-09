/**
 * Longest wait for the paint entry before the fallback fires. It stays well above the LCP budget
 * (2.5 s, P-07), so a slow but legitimate first paint is never overtaken by the engine request.
 */
const FALLBACK_MS = 4000;

/**
 * Runs `run` once, after the first contentful paint (AC-GEN-007.3 c, AC-UX-083.1). Uses the
 * `paint` timing entry; falls back to a double `requestAnimationFrame` when the entry type is
 * unsupported or no FCP arrives within `fallbackMs` (default 4 s). The engine chunk is requested from here
 * only, so the home screen and the wizard paint without it (REQ-UX-083).
 *
 * @param run Called at most once.
 * @param fallbackMs Longest wait for the paint entry.
 * @returns A cancel function.
 */
export function afterFirstContentfulPaint(
  run: () => void,
  fallbackMs = FALLBACK_MS,
): () => void {
  let done = false;
  let observer: PerformanceObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;
  const fire = (): void => {
    if (done) return;
    done = true;
    observer?.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    run();
  };
  const doubleRaf = (): void => {
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(fire);
    });
  };
  try {
    observer = new PerformanceObserver(list => {
      if (list.getEntries().some(e => e.name === 'first-contentful-paint')) {
        fire();
      }
    });
    observer.observe({type: 'paint', buffered: true});
    timer = setTimeout(doubleRaf, fallbackMs);
  } catch {
    doubleRaf();
  }
  return () => {
    done = true;
    observer?.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(raf);
  };
}
