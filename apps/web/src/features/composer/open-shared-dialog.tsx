import {useRef, type ReactElement} from 'react';
import type {CharacterSpec} from '@csg/parts-schema';
import {t} from '../../shared/i18n';
import {Button, Dialog} from '../../shared/ui';

/** Props of {@link OpenSharedDialog}. */
export interface OpenSharedDialogProps {
  readonly open: boolean;
  /** The decoded, validated character of the `#c=` link. */
  readonly spec: CharacterSpec | null;
  /** "Open as new project": the host creates a new unsaved project (REQ-CMP-035). */
  readonly onOpenAsNew: (spec: CharacterSpec) => void;
  /** Cancel, Escape or backdrop: no project is created. */
  readonly onCancel: () => void;
}

/**
 * Confirmation before a shared link opens (REQ-CMP-035, AC-CMP-035.1/.2). It never replaces or
 * modifies the open project: the only way forward is a new one. Cancel has initial focus, the
 * safe choice. The host removes the fragment with `clearShareFragment` after either answer.
 */
export function OpenSharedDialog({
  open,
  spec,
  onOpenAsNew,
  onCancel,
}: OpenSharedDialogProps): ReactElement | null {
  const cancel = useRef<HTMLButtonElement>(null);
  if (!spec) return null;
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={t('share.confirmTitle')}
      role="alertdialog"
      initialFocus={cancel}
      footer={
        <>
          <button
            ref={cancel}
            type="button"
            className="csg-btn"
            onClick={onCancel}
          >
            {t('share.cancel')}
          </button>
          <Button variant="primary" small onClick={() => onOpenAsNew(spec)}>
            {t('share.openAsNew')}
          </Button>
        </>
      }
    >
      <p>{t('composer.share.confirmBody', {name: spec.name})}</p>
    </Dialog>
  );
}
