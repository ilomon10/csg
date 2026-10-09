import type {ReactElement, ReactNode} from 'react';

/** Props of {@link VisuallyHidden}. */
export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  readonly id?: string;
}

/** Text available to assistive technology only. */
export function VisuallyHidden({
  children,
  id,
}: VisuallyHiddenProps): ReactElement {
  return (
    <span className="csg-sr" id={id}>
      {children}
    </span>
  );
}
