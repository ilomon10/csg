import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {createPortal} from 'react-dom';
import {IconButton} from './button';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Props of {@link Dialog}. */
export interface DialogProps {
  readonly open: boolean;
  /** Called on Escape, the close button and backdrop click. */
  readonly onClose: () => void;
  /** Visible heading; labels the dialog (`aria-labelledby`). */
  readonly title: string;
  readonly children: ReactNode;
  /** Action buttons, right-aligned. */
  readonly footer?: ReactNode;
  /** Element focused on open (the safe choice in destructive dialogs). Defaults to the first focusable. */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /** `alertdialog` for confirmations that need an answer. */
  readonly role?: 'dialog' | 'alertdialog';
  /** Width in px. */
  readonly width?: number;
  /** Close on backdrop click (default true). Escape always closes. */
  readonly dismissOnBackdrop?: boolean;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => !el.hasAttribute('inert'),
  );
}

/**
 * Modal dialog (REQ-UX-037): labelled by its title, traps Tab, closes on Escape, makes the
 * rest of the page inert while open and returns focus to the invoking element on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocus,
  role = 'dialog',
  width,
  dismissOnBackdrop = true,
}: DialogProps): ReactElement | null {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const invoker = document.activeElement as HTMLElement | null;
    // Everything outside the dialog becomes inert (focus, clicks and the a11y tree).
    const inerted: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === portal.current?.parentElement || child === portal.current)
        continue;
      if (child.contains(panel.current)) continue;
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        inerted.push(child);
      }
    }
    const el = panel.current;
    if (el) {
      const target = initialFocus?.current ?? focusables(el)[0] ?? el;
      target.focus();
    }
    return () => {
      for (const c of inerted) c.removeAttribute('inert');
      if (invoker && invoker.isConnected) invoker.focus();
    };
    // `initialFocus` is read once on open.
  }, [open]);

  // A scrollable body must be keyboard reachable (axe scrollable-region-focusable, WCAG 2.1.1).
  useEffect(() => {
    const el = body.current;
    if (!open || !el) return;
    const measure = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [open, children]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = focusables(panel.current);
    if (items.length === 0) {
      e.preventDefault();
      panel.current.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="csg-scrim"
      ref={node => {
        portal.current = node;
      }}
      onMouseDown={e => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="csg-dialog"
        style={
          width ? ({'--dialog-w': `${width}px`} as CSSProperties) : undefined
        }
        onKeyDown={onKeyDown}
      >
        <div className="csg-dialog__head">
          <h2 id={titleId} className="csg-dialog__title">
            {title}
          </h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div
          ref={body}
          className="csg-dialog__body"
          {...(scrollable
            ? {tabIndex: 0, role: 'region', 'aria-labelledby': titleId}
            : {})}
        >
          {children}
        </div>
        {footer ? <div className="csg-dialog__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
