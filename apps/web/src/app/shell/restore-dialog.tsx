import {t} from '../../shared/i18n';
import {useRef} from 'react';
import type {ReactElement} from 'react';
import {useShortcutScope} from '../../shared/shortcuts';
import {Button, Dialog} from '../../shared/ui';
import {useMiniStore} from './mini-store';
import {useShell} from './shell-context';

function RestoreBody(): ReactElement {
  const {state} = useShell();
  const offer = useMiniStore(state, s => s.restore);
  const ref = useRef<HTMLDivElement>(null);
  useShortcutScope('modal', ref);
  if (offer === null) return <div ref={ref} />;
  const time = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(offer.savedAt));
  return (
    <div ref={ref}>
      <p>{t('recovery.body', {name: offer.name, time})}</p>
      {offer.inProgress ? <p>{t('recovery.previousCrash')}</p> : null}
      {offer.error === null ? null : (
        <p role="alert">
          {t('recovery.failed', {code: offer.error})} <code>{offer.error}</code>
        </p>
      )}
    </div>
  );
}

/**
 * "Restore your last session?" over home (REQ-UX-045, REQ-UX-086). Nothing is loaded until the
 * user answers; "Start without restoring" is the default action after a failed or interrupted
 * restore and is always one Escape away.
 */
export function RestoreDialog(): ReactElement {
  const services = useShell();
  const offer = useMiniStore(services.state, s => s.restore);
  const safeDefault =
    offer?.inProgress === true ||
    (offer?.error !== null && offer?.error !== undefined);
  // The Dialog reads this once when it opens; the buttons are mounted by then.
  const initialFocus = {
    get current(): HTMLElement | null {
      return document.querySelector<HTMLElement>('[data-restore-default]');
    },
  };
  return (
    <Dialog
      open={offer !== null}
      role="alertdialog"
      title={t('recovery.title')}
      dismissOnBackdrop={false}
      initialFocus={initialFocus}
      onClose={() => void services.declineRestore()}
      footer={
        <>
          <Button
            {...(safeDefault ? {'data-restore-default': ''} : {})}
            onClick={() => void services.declineRestore()}
          >
            {t('recovery.skip')}
          </Button>
          {(offer?.error ?? null) === null ? (
            <Button
              variant="primary"
              small
              style={{minWidth: 0}}
              {...(safeDefault ? {} : {'data-restore-default': ''})}
              onClick={() => void services.acceptRestore()}
            >
              {t('recovery.restore')}
            </Button>
          ) : null}
        </>
      }
    >
      <RestoreBody />
    </Dialog>
  );
}
