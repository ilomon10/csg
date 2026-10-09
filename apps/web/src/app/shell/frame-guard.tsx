import {t} from '../../shared/i18n';
import type {ReactElement} from 'react';

/** True when the editor runs inside a frame, or when reading `window.top` throws (REQ-GEN-012). */
export function isFramed(win: Window = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/**
 * The only thing a framed editor renders (REQ-GEN-012, spec 008 threat T16): a link that opens
 * the editor in its own tab. It touches no storage and loads no engine.
 */
export function FramedNotice({href}: {readonly href: string}): ReactElement {
  return (
    <main className="shell-framed">
      <h1 className="csg-display">{t('frame.title')}</h1>
      <a
        className="csg-btn"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('frame.open')}
      </a>
    </main>
  );
}
