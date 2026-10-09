import {useId, type ReactElement, type ReactNode} from 'react';
import {Icon, type IconName} from './icon';
import {useRoving} from './use-roving';

/** One tab. */
export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}

/** Props of {@link Tabs}. */
export interface TabsProps {
  readonly label?: string;
  readonly labelledBy?: string;
  readonly tabs: readonly TabItem[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** Renders the panel of the active tab (the `tabpanel` wrapper is provided). */
  readonly children?: (activeId: string) => ReactNode;
  readonly orientation?: 'horizontal' | 'vertical';
  /** Icon above the label (Easy categories). */
  readonly stacked?: boolean;
  readonly className?: string;
  readonly panelClassName?: string;
}

/**
 * APG tabs with automatic activation: arrows move focus and select, Home/End jump, only the
 * selected tab is in the tab order, and the panel is `aria-labelledby` its tab.
 */
export function Tabs({
  label,
  labelledBy,
  tabs,
  value,
  onChange,
  children,
  orientation = 'horizontal',
  stacked = false,
  className,
  panelClassName,
}: TabsProps): ReactElement {
  const base = useId();
  const activeIndex = Math.max(
    0,
    tabs.findIndex(t => t.id === value),
  );
  const {register, onKeyDown} = useRoving({
    count: tabs.length,
    activeIndex,
    wrap: true,
    axis: orientation,
    onMove: i => {
      const t = tabs[i];
      if (t) onChange(t.id);
    },
  });
  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-orientation={orientation}
        className={`csg-tabs${stacked ? ' csg-tabs--stack' : ''}${className ? ` ${className}` : ''}`}
        onKeyDown={onKeyDown}
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={register(i)}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={t.id === value ? `${base}-panel` : undefined}
            tabIndex={i === activeIndex ? 0 : -1}
            disabled={t.disabled}
            className="csg-tab"
            onClick={() => onChange(t.id)}
          >
            {t.icon ? <Icon name={t.icon} /> : null}
            {t.label}
          </button>
        ))}
      </div>
      {children ? (
        <div
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${value}`}
          tabIndex={0}
          className={panelClassName}
        >
          {children(value)}
        </div>
      ) : null}
    </>
  );
}
