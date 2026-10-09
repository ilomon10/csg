import type {ReactElement, ReactNode} from 'react';
import {Icon, type IconName} from './icon';
import {useActiveItem, useRoving} from './use-roving';

/** One segment. */
export interface Segment {
  readonly id: string;
  readonly label: ReactNode;
  /** Plain-text name when `label` is not text. */
  readonly ariaLabel?: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}

/** Props of {@link SegmentedControl}. */
export interface SegmentedControlProps {
  /**
   * `radio`: a radiogroup, one tab stop, arrows move and check (workspace toggle).
   * `pressed`: a group of toggle buttons, each its own tab stop (Pixel/3D, Idle/Walk).
   */
  readonly mode: 'radio' | 'pressed';
  readonly label?: string;
  readonly labelledBy?: string;
  readonly segments: readonly Segment[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly className?: string;
}

/** Compact segmented switch (spec 009 toolbar, spec 014 workspace toggle). */
export function SegmentedControl({
  mode,
  label,
  labelledBy,
  segments,
  value,
  onChange,
  className,
}: SegmentedControlProps): ReactElement {
  const [active, setFocus] = useActiveItem(
    segments.map(s => s.id),
    value,
    i => segments[i]?.disabled === true,
  );
  const {register, onKeyDown} = useRoving({
    count: segments.length,
    activeIndex: active,
    wrap: true,
    axis: 'list',
    onMove: i => {
      const s = segments[i];
      if (!s) return;
      setFocus(s.id);
      if (!s.disabled) onChange(s.id);
    },
  });
  const radio = mode === 'radio';
  return (
    <div
      role={radio ? 'radiogroup' : 'group'}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`csg-seg${className ? ` ${className}` : ''}`}
      onKeyDown={radio ? onKeyDown : undefined}
    >
      {segments.map((s, i) => {
        const on = s.id === value;
        return (
          <button
            key={s.id}
            ref={register(i)}
            type="button"
            role={radio ? 'radio' : undefined}
            aria-checked={radio ? on : undefined}
            aria-pressed={radio ? undefined : on}
            aria-label={s.ariaLabel}
            disabled={s.disabled}
            data-on={on}
            tabIndex={radio ? (i === active ? 0 : -1) : undefined}
            className="csg-seg__btn"
            onClick={() => {
              setFocus(s.id);
              onChange(s.id);
            }}
            onFocus={() => setFocus(s.id)}
          >
            {s.icon ? <Icon name={s.icon} /> : null}
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
