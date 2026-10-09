import {t} from '../../../shared/i18n';
import type {ReactElement} from 'react';
import type {EasyCategoryId} from '@csg/parts-schema';
import {openExport} from '../../../features/export';
import {RandomizeMenu} from '../../../features/composer';
import {resetCategory, useDocument} from '../../../shared/document';
import type {CharacterTarget} from '../../../shared/document';
import {Button, announce} from '../../../shared/ui';
import {useShell} from '../../shell/shell-context';

/** Props of {@link EasyBottomBar}. */
export interface EasyBottomBarProps {
  readonly target: CharacterTarget;
  readonly category: EasyCategoryId;
  /** Visible name of the active category, for the "Reset <category>" history entry. */
  readonly categoryName: string;
}

/**
 * The Easy bottom bar (REQ-UX-064): Undo and Redo (names include the entry label), Randomize,
 * Reset tab and Export. The workspace toggle lives in the top bar only (REQ-UX-053).
 */
export function EasyBottomBar({
  target,
  category,
  categoryName,
}: EasyBottomBarProps): ReactElement {
  const {store, stepHistory} = useShell();
  const undo = useDocument(store, s => s.undo);
  const redo = useDocument(store, s => s.redo);
  const readOnly = useDocument(store, s => s.readOnly);
  return (
    <section
      className="ez-bar"
      role="region"
      aria-label={t('easy.actions')}
      data-region={t('easy.actions')}
    >
      <Button
        icon="undo"
        disabled={undo === null || readOnly}
        aria-label={
          undo === null
            ? t('easy.undo')
            : t('easy.undoLabel', {label: undo.label})
        }
        onClick={() => stepHistory('undo')}
      >
        {t('easy.undo')}
      </Button>
      <Button
        icon="redo"
        disabled={redo === null || readOnly}
        aria-label={
          redo === null
            ? t('easy.redo')
            : t('easy.redoLabel', {label: redo.label})
        }
        onClick={() => stepHistory('redo')}
      >
        {t('easy.redo')}
      </Button>
      <RandomizeMenu target={target} category={category} />
      <Button
        icon="dice"
        disabled={readOnly}
        aria-label={t('easy.resetLabel', {category: categoryName})}
        onClick={() => {
          target.apply(resetCategory(category, categoryName));
          announce(t('easy.reset.done', {category: categoryName}));
        }}
      >
        {t('easy.resetTab')}
      </Button>
      <span className="ez-bar__grow" />
      <Button
        variant="primary"
        icon="download"
        onClick={() => openExport()}
        aria-keyshortcuts="Control+E Meta+E"
      >
        {t('easy.export')}
      </Button>
    </section>
  );
}
