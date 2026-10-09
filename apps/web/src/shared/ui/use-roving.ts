import {useCallback, useRef, useState, type KeyboardEvent} from 'react';
import {isNavKey, nextIndex, type NextIndexOptions} from './grid-nav';

/** Options for {@link useRoving}. */
export interface UseRovingOptions extends Omit<NextIndexOptions, 'count'> {
  readonly count: number;
  /** Index that currently owns tabindex 0. */
  readonly activeIndex: number;
  /** Called with the new index after focus moved (selection-follows-focus widgets select here). */
  readonly onMove: (index: number) => void;
}

/**
 * Roving-tabindex helper. Register each item element with `register(index)` and spread
 * `onKeyDown` on the container; arrows, Home and End move DOM focus and call `onMove`.
 */
export function useRoving({
  count,
  activeIndex,
  onMove,
  columns,
  wrap,
  axis,
}: UseRovingOptions) {
  const items = useRef<Array<HTMLElement | null>>([]);

  const register = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      items.current[index] = el;
    },
    [],
  );

  /** Measures items per row from layout; falls back to 1 when there is none (jsdom). */
  const measureColumns = useCallback((): number => {
    if (columns !== undefined) return columns;
    const first = items.current[0];
    if (!first) return 1;
    let n = 0;
    for (const el of items.current) {
      if (el && el.offsetTop === first.offsetTop) n++;
      else if (el) break;
    }
    return Math.max(1, n);
  }, [columns]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (!isNavKey(event.key)) return;
      const target = nextIndex(event.key, activeIndex, {
        count,
        columns: measureColumns(),
        wrap,
        axis,
      });
      if (target === null) return;
      event.preventDefault();
      items.current[target]?.focus();
      onMove(target);
    },
    [activeIndex, count, measureColumns, wrap, axis, onMove],
  );

  return {register, onKeyDown};
}

/**
 * Tracks which item owns tabindex 0. It follows `value` (the checked or selected id) and
 * is overridden by focus moves until `value` changes again.
 *
 * @returns the active index into `ids` and a setter taking an id.
 */
export function useActiveItem(
  ids: readonly string[],
  value: string | null,
  skipDisabled?: (index: number) => boolean,
): [number, (id: string) => void] {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setFocusId(null);
  }
  let index = ids.indexOf(focusId ?? value ?? '');
  if (index < 0) {
    index = 0;
    if (skipDisabled) {
      const first = ids.findIndex((_, i) => !skipDisabled(i));
      if (first >= 0) index = first;
    }
  }
  return [index, setFocusId];
}
