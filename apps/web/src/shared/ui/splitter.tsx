import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';

/** Keyboard step of a {@link Splitter} in px (REQ-UX-040: non-drag alternative). */
export const SPLITTER_STEP = 16;

/** Props of {@link Splitter}. */
export interface SplitterProps {
  /**
   * `vertical` is a vertical bar between side-by-side panels (resizes a width, Left/Right
   * keys); `horizontal` is a horizontal bar between stacked panels (resizes a height, Up/Down).
   */
  readonly orientation: 'vertical' | 'horizontal';
  /** Current size in px of the panel being resized. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** Accessible name, e.g. "Resize library panel". */
  readonly label: string;
  /**
   * +1 when moving right/down grows the panel (panel before the bar), -1 when it shrinks it
   * (panel after the bar: inspector, dock). Defaults to 1.
   */
  readonly direction?: 1 | -1;
  /** Id of the panel the bar controls. */
  readonly controls?: string;
  /** Called on double click (reset to default). */
  readonly onReset?: () => void;
}

/**
 * Window splitter (APG): `role="separator"` with `aria-valuenow/min/max`, arrows move it by
 * 16 px, Home/End jump to min/max, and pointer drag works with capture.
 */
export function Splitter({
  orientation,
  value,
  min,
  max,
  onChange,
  label,
  direction = 1,
  controls,
  onReset,
}: SplitterProps): ReactElement {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{pos: number; value: number} | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  const vertical = orientation === 'vertical';

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const grow = vertical ? 'ArrowRight' : 'ArrowDown';
    const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
    let next: number | null = null;
    if (e.key === grow) next = value + SPLITTER_STEP * direction;
    else if (e.key === shrink) next = value - SPLITTER_STEP * direction;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = {pos: vertical ? e.clientX : e.clientY, value};
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const delta = (vertical ? e.clientX : e.clientY) - s.pos;
    onChange(clamp(s.value + delta * direction));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-controls={controls}
      data-drag={dragging}
      className="csg-split"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
    />
  );
}
