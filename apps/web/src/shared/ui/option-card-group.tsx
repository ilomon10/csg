import {useId, type ReactElement, type ReactNode} from 'react';
import {Icon} from './icon';
import {useActiveItem, useRoving} from './use-roving';

/** One card of an {@link OptionCardGroup}. */
export interface OptionCard {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly art?: ReactNode;
  /**
   * Not available (REQ-UX-092): shows "Coming soon", stays reachable by arrows, cannot be
   * checked.
   */
  readonly disabled?: boolean;
}

/** Props of {@link OptionCardGroup}. */
export interface OptionCardGroupProps {
  readonly label?: string;
  readonly labelledBy?: string;
  readonly options: readonly OptionCard[];
  readonly value: string | null;
  readonly onChange: (id: string) => void;
  /** Text on disabled cards. Defaults to "Coming soon". */
  readonly disabledLabel?: string;
  /** Spoken description of disabled cards. */
  readonly disabledDescription?: string;
  readonly className?: string;
}

/**
 * Radiogroup of large cards (REQ-UX-092, REQ-UX-089): arrows move focus and check, disabled
 * ("Coming soon") cards are reachable by arrows but never checked, Tab leaves the group.
 */
export function OptionCardGroup({
  label,
  labelledBy,
  options,
  value,
  onChange,
  disabledLabel = 'Coming soon',
  disabledDescription = 'Coming soon. Available in a later update.',
  className,
}: OptionCardGroupProps): ReactElement {
  const base = useId();
  const [active, setFocus] = useActiveItem(
    options.map(o => o.id),
    value,
    i => options[i]?.disabled === true,
  );
  const {register, onKeyDown} = useRoving({
    count: options.length,
    activeIndex: active,
    wrap: true,
    axis: 'list',
    onMove: i => {
      const o = options[i];
      if (!o) return;
      setFocus(o.id);
      if (!o.disabled) onChange(o.id);
    },
  });
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`csg-tiles${className ? ` ${className}` : ''}`}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const descId = `${base}-d${i}`;
        return (
          <div
            key={o.id}
            ref={register(i)}
            role="radio"
            tabIndex={i === active ? 0 : -1}
            aria-checked={o.id === value}
            aria-disabled={o.disabled || undefined}
            aria-describedby={o.disabled || o.description ? descId : undefined}
            className="csg-tile"
            onClick={() => {
              setFocus(o.id);
              if (!o.disabled) onChange(o.id);
            }}
            onFocus={() => setFocus(o.id)}
            onKeyDown={e => {
              if (e.key === ' ') {
                e.preventDefault();
                if (!o.disabled) onChange(o.id);
              }
            }}
          >
            <span className="csg-tile__mark" aria-hidden="true">
              <Icon name="check" />
            </span>
            {o.disabled ? (
              <span className="csg-tile__soon" aria-hidden="true">
                {disabledLabel}
              </span>
            ) : null}
            <span className="csg-tile__art" aria-hidden="true">
              {o.art}
            </span>
            <span className="csg-tile__label">{o.label}</span>
            {o.description && !o.disabled ? (
              <span className="csg-tile__sub" id={descId}>
                {o.description}
              </span>
            ) : null}
            {o.disabled ? (
              <span className="csg-sr" id={descId}>
                {disabledDescription}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
