import {useRef, useState, type ReactElement} from 'react';
import type {CharacterSpec} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {replaceCharacter, type CharacterTarget} from '../../shared/document';
import {t} from '../../shared/i18n';
import {
  Button,
  Dialog,
  MenuButton,
  toastQueue,
  type MenuItem,
} from '../../shared/ui';
import {
  MAX_CHARACTER_FILE_BYTES,
  characterFileName,
  downloadTextFile,
  loadCharacterFile,
  serializeCharacter,
} from './character-file';
import {refName, slotLabel} from './labels';
import {buildShareUrl, userPartSlots, withoutUserParts} from './share-link';

/** Props of {@link CharacterFileMenu}. */
export interface CharacterFileMenuProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
  /** Download sink; defaults to a Blob download. Injectable for tests. */
  readonly download?: (fileName: string, text: string) => void;
  /** Clipboard sink; defaults to `navigator.clipboard.writeText`. */
  readonly copyText?: (text: string) => Promise<void>;
  /** Builds the share URL; defaults to the current page plus `#c=`. */
  readonly shareUrl?: (spec: CharacterSpec) => Promise<string>;
}

/**
 * Character file and share menu (REQ-CMP-022, 023, 024, 025, 026): save, load and copy share
 * link. A load is one undoable command and a failed load changes nothing. Results are
 * non-blocking toasts with their error code. A link to a character with `user:` parts first
 * asks, listing them, and shares without them on confirmation.
 */
export function CharacterFileMenu({
  target,
  catalog,
  download = downloadTextFile,
  copyText = text => navigator.clipboard.writeText(text),
  shareUrl = buildShareUrl,
}: CharacterFileMenuProps): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<CharacterSpec | null>(null);

  const save = () => {
    const spec = target.getSpec();
    const file = characterFileName(spec.name);
    download(file, serializeCharacter(spec));
    toastQueue.push({
      tone: 'success',
      message: t('composer.file.saved', {file}),
    });
  };

  const load = async (file: File) => {
    if (file.size > MAX_CHARACTER_FILE_BYTES) {
      toastQueue.push({
        tone: 'error',
        code: 'CMP_SPEC_INVALID',
        message: t('composer.file.tooLarge'),
      });
      return;
    }
    const result = loadCharacterFile(await file.text(), catalog);
    if (!result.ok) {
      toastQueue.push({
        tone: 'error',
        code: result.code,
        message: result.message,
      });
      return;
    }
    target.apply(replaceCharacter(result.spec, `Load ${result.spec.name}`));
    toastQueue.push({
      tone: 'success',
      message: t('composer.file.loaded', {name: result.spec.name}),
    });
    if (result.missing.length > 0) {
      toastQueue.push({
        tone: 'warning',
        message: t(
          result.missing.length === 1
            ? 'composer.file.missingParts'
            : 'composer.file.missingPartsMany',
          {count: result.missing.length, names: result.missing.join(', ')},
        ),
      });
    }
  };

  const copy = async (spec: CharacterSpec) => {
    try {
      await copyText(await shareUrl(spec));
      toastQueue.push({tone: 'success', message: t('composer.share.copied')});
    } catch {
      toastQueue.push({
        tone: 'error',
        code: 'CMP_SPEC_INVALID',
        message: t('composer.share.copyFailed'),
      });
    }
  };

  const share = () => {
    const spec = target.getSpec();
    if (spec.body.ref.startsWith('user:')) {
      toastQueue.push({tone: 'error', message: t('composer.share.bodyIsUser')});
      return;
    }
    if (userPartSlots(spec).length > 0) setPending(spec);
    else void copy(spec);
  };

  const items: MenuItem[] = [
    {
      id: 'save',
      label: t('composer.file.save'),
      icon: 'download',
      onSelect: save,
    },
    {
      id: 'load',
      label: t('composer.file.load'),
      onSelect: () => input.current?.click(),
    },
    {id: 'share', label: t('composer.file.share'), onSelect: share},
  ];

  return (
    <>
      <MenuButton items={items} ariaLabel={t('composer.file.menu')}>
        {t('composer.file.menu')}
      </MenuButton>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="character-file-input"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(file);
        }}
      />
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('composer.share.userPartsTitle')}
        role="alertdialog"
        footer={
          <>
            <Button small onClick={() => setPending(null)}>
              {t('share.cancel')}
            </Button>
            <Button
              variant="primary"
              small
              onClick={() => {
                const spec = pending;
                setPending(null);
                if (spec) void copy(withoutUserParts(spec));
              }}
            >
              {t('composer.share.without')}
            </Button>
          </>
        }
      >
        <p>{t('composer.share.userPartsBody')}</p>
        <ul>
          {pending
            ? userPartSlots(pending).map(({slot, ref}) => (
                <li key={slot}>
                  {slotLabel(catalog, slot)}: {refName(ref)}
                </li>
              ))
            : null}
        </ul>
      </Dialog>
    </>
  );
}
