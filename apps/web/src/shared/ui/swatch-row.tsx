import type {CSSProperties, ReactElement} from 'react';
import {Icon} from './icon';
import {useActiveItem, useRoving} from './use-roving';

/** One swatch. */
export interface Swatch {
  readonly id: string;
  /** Spoken color name (REQ-UX-062). */
  readonly name: string;
  /** CSS color, set through the style object (never parsed as markup). */
  readonly color: string;
}

/** Props of {@link SwatchRow}. */
export interface SwatchRowProps {
  readonly label?: string;
  readonly labelledBy?: string;
  readonly swatches: readonly Swatch[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  readonly className?: string;
}

/**
 * Radiogroup of color swatches (REQ-UX-062): arrows move and check, the checked swatch shows
 * a check mark as well as a ring.
 */
export function SwatchRow({
  label,
  labelledBy,
  swatches,
  value,
  onChange,
  className,
}: SwatchRowProps): ReactElement {
  const [active, setFocus] = useActiveItem(
    swatches.map(s => s.id),
    value,
  );
  const {register, onKeyDown} = useRoving({
    count: swatches.length,
    activeIndex: active,
    wrap: true,
    axis: 'list',
    onMove: i => {
      const s = swatches[i];
      if (!s) return;
      setFocus(s.id);
      onChange(s.id);
    },
  });
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`csg-swatches${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
    >
      {swatches.map((s, i) => (
        <button
          key={s.id}
          ref={register(i)}
          type="button"
          role="radio"
          aria-label={s.name}
          aria-checked={s.id === value}
          tabIndex={i === active ? 0 : -1}
          className="csg-swatch"
          style={{backgroundColor: s.color} as CSSProperties}
          onClick={() => {
            setFocus(s.id);
            onChange(s.id);
          }}
          onFocus={() => setFocus(s.id)}
        >
          {s.id === value ? <Icon name="check" /> : null}
        </button>
      ))}
    </div>
  );
}
