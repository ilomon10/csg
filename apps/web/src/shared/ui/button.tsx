import type {ButtonHTMLAttributes, ReactElement, ReactNode, Ref} from 'react';
import {Icon, type IconName} from './icon';

/** Visual variants of {@link Button}. `primary` is the chamfered pixel-corner call to action. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Props of {@link Button}. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Compact primary button (toolbars, dialogs). */
  readonly small?: boolean;
  readonly icon?: IconName;
  readonly children: ReactNode;
  /** React 19 passes `ref` as a prop; it is forwarded to the `<button>` (initial focus in dialogs). */
  readonly ref?: Ref<HTMLButtonElement>;
}

/** Text button. Defaults to `type="button"`. */
export function Button({
  variant = 'secondary',
  small = false,
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): ReactElement {
  const cls = [
    'csg-btn',
    variant === 'secondary' ? '' : `csg-btn--${variant}`,
    small ? 'csg-btn--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} type={type} className={cls}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/** Props of {@link IconButton}. The accessible name is mandatory. */
export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  readonly icon: IconName;
  /** Accessible name (also the tooltip). */
  readonly label: string;
  /** Forwarded to the `<button>`, as for {@link Button}. */
  readonly ref?: Ref<HTMLButtonElement>;
}

/** Square icon-only button; `label` becomes `aria-label` and `title`. */
export function IconButton({
  icon,
  label,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactElement {
  return (
    <button
      title={label}
      {...rest}
      type={type}
      aria-label={label}
      className={`csg-btn csg-btn--icon${className ? ` ${className}` : ''}`}
    >
      <Icon name={icon} />
    </button>
  );
}
