import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {Icon, type IconName} from './icon';

/** One entry of a {@link MenuButton}. */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Focusable but not activatable (APG). */
  readonly disabled?: boolean;
  /** Draw a separator above. */
  readonly separatorBefore?: boolean;
  readonly onSelect: () => void;
}

/** Props of {@link MenuButton}. */
export interface MenuButtonProps {
  /** Button content. For an icon-only trigger pass `ariaLabel` too. */
  readonly children: ReactNode;
  readonly ariaLabel?: string;
  readonly items: readonly MenuItem[];
  readonly variant?: 'secondary' | 'ghost' | 'icon';
  /** Open above the button (home bottom bar). */
  readonly placement?: 'down' | 'up';
  /** Align the menu to the button's end. */
  readonly alignEnd?: boolean;
  readonly disabled?: boolean;
}

/**
 * APG menu button: Enter/Space/Down open on the first item, Up on the last; arrows, Home/End and
 * type-ahead move, Enter/Space activate, Escape closes and returns focus, Tab closes.
 */
export function MenuButton({
  children,
  ariaLabel,
  items,
  variant = 'secondary',
  placement = 'down',
  alignEnd = false,
  disabled,
}: MenuButtonProps): ReactElement {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [focusAt, setFocusAt] = useState<number | 'first' | 'last'>('first');
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const typed = useRef({text: '', at: 0});

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const idx =
      focusAt === 'first' ? 0 : focusAt === 'last' ? items.length - 1 : focusAt;
    refs.current[idx]?.focus();
    // Focus only when opening.
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openAt = (at: 'first' | 'last') => {
    setFocusAt(at);
    setOpen(true);
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAt('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const n = items.length;
    const cur = refs.current.findIndex(el => el === document.activeElement);
    const go = (i: number) => {
      e.preventDefault();
      refs.current[((i % n) + n) % n]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        return go(cur + 1);
      case 'ArrowUp':
        return go(cur - 1);
      case 'Home':
        return go(0);
      case 'End':
        return go(n - 1);
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        return close(true);
      case 'Tab':
        return close(false);
      default:
        if (
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          e.key !== ' '
        ) {
          const t = typed.current;
          const stamp = e.timeStamp;
          t.text =
            stamp - t.at > 600
              ? e.key.toLowerCase()
              : t.text + e.key.toLowerCase();
          t.at = stamp;
          const from = t.text.length === 1 ? cur + 1 : cur;
          for (let k = 0; k < n; k++) {
            const i = (from + k) % n;
            if (items[i]?.label.toLowerCase().startsWith(t.text)) return go(i);
          }
        }
    }
  };

  const triggerClass =
    variant === 'icon'
      ? 'csg-btn csg-btn--icon'
      : variant === 'ghost'
        ? 'csg-btn csg-btn--ghost'
        : 'csg-btn';

  return (
    <div className="csg-menuwrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close(false) : openAt('first'))}
        onKeyDown={onTriggerKey}
      >
        {children}
        {variant === 'icon' ? null : <Icon name="chevron-down" />}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className={`csg-menu${placement === 'up' ? ' csg-menu--up' : ''}${alignEnd ? ' csg-menu--end' : ''}`}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <div key={item.id} role="none">
              {item.separatorBefore ? <hr className="csg-menu__sep" /> : null}
              <button
                ref={el => {
                  refs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                className="csg-menu__item"
                onClick={() => {
                  if (item.disabled) return;
                  close(true);
                  item.onSelect();
                }}
              >
                {item.icon ? <Icon name={item.icon} /> : null}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
