import {useId} from 'react';
import type {CSSProperties, ReactElement, ReactNode} from 'react';
import {Icon} from './icon';
import {useActiveItem, useRoving} from './use-roving';

/** One tile of an {@link OptionTileGrid}. */
export interface OptionTile {
  readonly id: string;
  /** Visible and accessible name. */
  readonly label: string;
  /** Optional second line (shown under the name, included in the description). */
  readonly sub?: string;
  /**
   * Extra spoken detail (for example why a tile is disabled). Rendered in a `hidden` node (it still describes, but stays out of the name) and linked with
   * `aria-describedby`, so the accessible name stays short.
   */
  readonly description?: string;
  /** Thumbnail or placeholder. Decorative: the label names the tile. */
  readonly art?: ReactNode;
  /** Reachable by arrows but not selectable. */
  readonly disabled?: boolean;
  /** Thumbnail still loading (`aria-busy`). */
  readonly busy?: boolean;
}

/** Props of {@link OptionTileGrid}. */
export interface OptionTileGridProps {
  /** Accessible name of the listbox (or use `labelledBy`). */
  readonly label?: string;
  readonly labelledBy?: string;
  readonly options: readonly OptionTile[];
  /** Selected id, or null. */
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  /** Home avatar strip: arrows change the selection, not only the focus. */
  readonly selectionFollowsFocus?: boolean;
  /** Enter on a tile (home strip: runs the primary action). Enter selects when omitted. */
  readonly onActivate?: (id: string) => void;
  /** Tiles per row, for Up/Down. Measured from layout when omitted. */
  readonly columns?: number;
  /** Single horizontally scrolling row instead of a wrapping grid. */
  readonly row?: boolean;
  /** Minimum tile width in px (CSS `--tile-w`). Defaults to 124. */
  readonly tileWidth?: number;
  /** Accessible name builder, e.g. "Rowan, 2 of 5, saved". Defaults to the label. */
  readonly optionName?: (
    option: OptionTile,
    index: number,
    count: number,
  ) => string;
  readonly className?: string;
}

/**
 * Single-select listbox of picture tiles (APG listbox, REQ-UX-061 / REQ-UX-075): roving
 * tabindex, 2-D arrows, Home/End, Enter/Space select. A check mark shows the selection, not
 * only the color.
 */
export function OptionTileGrid({
  label,
  labelledBy,
  options,
  value,
  onChange,
  selectionFollowsFocus = false,
  onActivate,
  columns,
  row = false,
  tileWidth,
  optionName,
  className,
}: OptionTileGridProps): ReactElement {
  const base = useId();
  const [active, setFocus] = useActiveItem(
    options.map(o => o.id),
    value,
  );

  const {register, onKeyDown} = useRoving({
    count: options.length,
    activeIndex: active,
    columns: row ? options.length : columns,
    axis: row ? 'horizontal' : 'grid',
    onMove: i => {
      const o = options[i];
      if (o) setFocus(o.id);
      if (selectionFollowsFocus && o && !o.disabled) onChange(o.id);
    },
  });

  const choose = (o: OptionTile) => {
    if (!o.disabled) onChange(o.id);
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-orientation={row ? 'horizontal' : undefined}
      className={`${row ? 'csg-tiles--row' : 'csg-tiles'}${className ? ` ${className}` : ''}`}
      style={
        tileWidth
          ? ({'--tile-w': `${tileWidth}px`} as CSSProperties)
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => (
        <div
          key={o.id}
          ref={register(i)}
          role="option"
          tabIndex={i === active ? 0 : -1}
          aria-selected={o.id === value}
          aria-disabled={o.disabled || undefined}
          aria-busy={o.busy || undefined}
          aria-describedby={o.description ? `${base}-d${i}` : undefined}
          aria-label={optionName ? optionName(o, i, options.length) : undefined}
          className="csg-tile"
          onClick={() => {
            setFocus(o.id);
            choose(o);
          }}
          onFocus={() => setFocus(o.id)}
          onKeyDown={e => {
            if (e.key === ' ') {
              e.preventDefault();
              choose(o);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (onActivate && !o.disabled) onActivate(o.id);
              else choose(o);
            }
          }}
        >
          <span className="csg-tile__mark" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span className="csg-tile__art" aria-hidden="true">
            {o.art}
          </span>
          <span className="csg-tile__label">{o.label}</span>
          {o.sub ? (
            <>
              {/* A real space keeps the label and sub line apart in the text axe reads (WCAG 2.5.3). */}{' '}
              <span className="csg-tile__sub">{o.sub}</span>
            </>
          ) : null}
          {o.description ? (
            <span hidden id={`${base}-d${i}`}>
              {o.description}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
