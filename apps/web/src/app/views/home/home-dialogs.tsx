import {t} from '../../../shared/i18n';
import {useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import {Button, Dialog} from '../../../shared/ui';
import type {HomeItem} from './lineup-model';

/** Longest project name (REQ-UX-079). */
export const MAX_NAME_CHARS = 64;

/** Props of {@link RenameDialog}. */
export interface RenameDialogProps {
  readonly item: HomeItem | null;
  readonly onClose: () => void;
  readonly onRename: (item: HomeItem, name: string) => void;
}

/** Rename dialog: 1 to 64 characters after trimming (REQ-UX-079). */
export function RenameDialog({
  item,
  onClose,
  onRename,
}: RenameDialogProps): ReactElement {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (item !== null) setDraft(item.name);
  }, [item]);
  const trimmed = draft.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_NAME_CHARS;
  const submit = (): void => {
    if (item !== null && valid) onRename(item, trimmed);
  };
  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title={t('home.rename.title')}
      initialFocus={input}
      width={420}
      footer={
        <>
          <Button onClick={onClose}>{t('home.cancel')}</Button>
          <Button variant="primary" small disabled={!valid} onClick={submit}>
            {t('home.rename.save')}
          </Button>
        </>
      }
    >
      <label className="home-field">
        <span>{t('home.rename.label')}</span>
        <input
          ref={input}
          className="home-input"
          value={draft}
          maxLength={MAX_NAME_CHARS}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => e.currentTarget.select()}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Dialog>
  );
}

/** Props of {@link DeleteDialog}. */
export interface DeleteDialogProps {
  readonly item: HomeItem | null;
  readonly onClose: () => void;
  readonly onDelete: (item: HomeItem) => void;
}

/** Delete confirmation; the default focus is Cancel (REQ-UX-079). */
export function DeleteDialog({
  item,
  onClose,
  onDelete,
}: DeleteDialogProps): ReactElement {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      title={t('home.delete.title')}
      role="alertdialog"
      initialFocus={cancel}
      width={440}
      footer={
        <>
          <Button ref={cancel} onClick={onClose}>
            {t('home.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (item !== null) onDelete(item);
            }}
          >
            {t('home.delete.confirm')}
          </Button>
        </>
      }
    >
      <p className="home-dialog-text">
        {t('home.delete.body', {name: item?.name ?? ''})}
      </p>
    </Dialog>
  );
}
