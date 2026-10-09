import {MESSAGES, t} from '../../../shared/i18n';
import {useMemo, useRef} from 'react';
import type {ReactElement} from 'react';
import {EASY_CATEGORY_IDS} from '@csg/parts-schema';
import type {EasyCategoryId} from '@csg/parts-schema';
import type {MessageKey} from '../../../shared/i18n';
import {useShortcutScope} from '../../../shared/shortcuts';
import {Tabs, categoryIconName} from '../../../shared/ui';
import {CharacterViewport} from '../../viewport';
import {WorkspaceExportDialog} from '../export-host';
import {usePrefs, useShell} from '../../shell/shell-context';
import {
  VIEW_ONLY_BELOW,
  useCatalog,
  useCharacterName,
  useEditInPro,
  useProjectTarget,
  useRenderSource,
  useWindowSize,
} from '../use-workspace';
import {useWorkspaceCommands} from '../use-workspace-commands';
import {EasyBottomBar} from './easy-bottom-bar';
import {withEasyContext} from './easy-model';
import {EasyCategoryPanel} from './easy-panel';
import './easy.css';

/**
 * The Easy workspace (spec 014 REQ-UX-056 to REQ-UX-068): a large preview on the left (55 %),
 * the Customize panel with category tabs on the right and the actions bar below. It edits the
 * one open project through the shared document store, so switching to Pro converts nothing.
 */
export function EasyView(): ReactElement {
  const catalog = useCatalog();
  if (catalog === null) {
    return (
      <p className="ez-status" role="status">
        {t('ws.loading')}
      </p>
    );
  }
  return <EasyBody catalog={catalog} />;
}

function EasyBody({
  catalog,
}: {
  readonly catalog: NonNullable<ReturnType<typeof useCatalog>>;
}): ReactElement {
  const services = useShell();
  const {easyTab} = usePrefs();
  const target = useProjectTarget(catalog);
  const render = useRenderSource();
  const name = useCharacterName();
  const editInPro = useEditInPro();
  const {width} = useWindowSize();
  const previewRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useShortcutScope('easy-preview', previewRef);
  useShortcutScope('easy-panel', panelRef);
  useWorkspaceCommands();

  // Tab order is the schema's, not the order the data files were read in (REQ-UX-060).
  const categories = useMemo(
    () =>
      [...catalog.easyCategories].sort(
        (a, b) =>
          EASY_CATEGORY_IDS.indexOf(a.id) - EASY_CATEGORY_IDS.indexOf(b.id),
      ),
    [catalog],
  );
  const active = categories.find(c => c.id === easyTab) ?? categories[0];
  const scoped = useMemo(
    () => (active ? withEasyContext(target, active.id) : target),
    [target, active],
  );
  const label = name === '' ? t('ws.character') : name;
  const viewport = (
    <CharacterViewport
      target={target}
      render={render}
      label={label}
      variant="easy"
      onBackend={backend => services.diagnostics.reportRenderer({backend})}
    />
  );
  const categoryName = (id: string, key: string): string =>
    Object.hasOwn(MESSAGES, key) ? t(key as MessageKey) : id;

  if (width < VIEW_ONLY_BELOW) {
    return (
      <div className="ez ez--view-only" data-testid="easy">
        <div
          ref={previewRef}
          className="ez-preview"
          role="region"
          aria-label={t('ws.preview')}
          data-region={t('ws.preview')}
        >
          {viewport}
        </div>
        <p className="ez-hint ez-hint--center">{t('ws.viewOnly')}</p>
      </div>
    );
  }

  return (
    <div className="ez" data-testid="easy">
      <div
        ref={previewRef}
        className="ez-preview"
        role="region"
        aria-label={t('ws.preview')}
        data-region={t('ws.preview')}
      >
        {viewport}
      </div>
      <section
        ref={panelRef}
        className="ez-customize"
        aria-label={t('easy.customize')}
        data-region={t('easy.customize')}
      >
        {active ? (
          <Tabs
            label={t('easy.categories')}
            stacked
            className="ez-tabs"
            panelClassName="ez-panel"
            tabs={categories.map(c => ({
              id: c.id,
              label: categoryName(c.id, c.labelKey),
              icon: categoryIconName(c.icon),
            }))}
            value={active.id}
            onChange={id => services.prefs.set({easyTab: id as EasyCategoryId})}
          >
            {() => (
              <EasyCategoryPanel
                key={active.id}
                def={active}
                catalog={catalog}
                target={scoped}
                onEditInPro={editInPro}
              />
            )}
          </Tabs>
        ) : null}
      </section>
      {active ? (
        <EasyBottomBar
          target={scoped}
          category={active.id}
          categoryName={categoryName(active.id, active.labelKey)}
        />
      ) : null}
      <WorkspaceExportDialog catalog={catalog} />
    </div>
  );
}
