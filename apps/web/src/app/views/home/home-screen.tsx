import {formatEditedDate, t} from '../../../shared/i18n';
import {useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import {announce, Button, Icon, MenuButton} from '../../../shared/ui';
import type {MenuItem} from '../../../shared/ui';
import {DeleteDialog, RenameDialog} from './home-dialogs';
import {HomeLineup} from './home-lineup';
import {HomeStrip, optionName} from './home-strip';
import type {HomeItem} from './lineup-model';
import type {FrameSource} from './use-home-frames';
import './home.css';

/** Actions on the selected saved character (REQ-UX-079). */
export interface HomeItemActions {
  open(item: HomeItem): void;
  duplicate(item: HomeItem): void;
  rename(item: HomeItem, name: string): void;
  exportProject(item: HomeItem): void;
  togglePin(item: HomeItem): void;
  remove(item: HomeItem): void;
}

/** Props of {@link HomeScreen}. */
export interface HomeScreenProps {
  readonly items: readonly HomeItem[];
  /** The list of saved characters was read (the empty state waits for it). */
  readonly savedLoaded: boolean;
  /** The catalog (presets) is loaded. */
  readonly catalogReady: boolean;
  readonly frames: FrameSource | null;
  readonly reducedMotion: boolean;
  readonly selectedId: string | null;
  readonly locale?: string;
  /** Focus "New character" on load while no saved character exists (REQ-UX-085). */
  readonly autoFocusNew: boolean;
  readonly onSelect: (id: string) => void;
  /** Runs the primary action for the selected item, or creates one (`null`). */
  readonly onPrimary: (item: HomeItem | null) => void;
  readonly onNew: () => void;
  readonly onRandom: () => void;
  readonly onOpenFile: (file: File) => void;
  readonly actions: HomeItemActions;
}

/** Label of the primary action by what is selected (REQ-UX-078). */
export function primaryLabel(item: HomeItem | null): string {
  if (item === null) return t('home.create');
  return item.kind === 'saved' ? t('home.edit') : t('home.startPreset');
}

/**
 * The home screen (spec 014 REQ-UX-071 to 088): the lobby lineup, the details line, the avatar
 * strip with its New and Random tiles, the bottom-center primary action and the ⋯ menu.
 * Presentational: data and side effects come in through props.
 */
export function HomeScreen({
  items,
  savedLoaded,
  catalogReady,
  frames,
  reducedMotion,
  selectedId,
  locale,
  autoFocusNew,
  onSelect,
  onPrimary,
  onNew,
  onRandom,
  onOpenFile,
  actions,
}: HomeScreenProps): ReactElement {
  const [version, setVersion] = useState(0);
  const [renaming, setRenaming] = useState<HomeItem | null>(null);
  const [deleting, setDeleting] = useState<HomeItem | null>(null);
  const newTile = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const focused = useRef(false);

  const found = items.findIndex(i => i.id === selectedId);
  const selectedIndex = found >= 0 ? found : items.length > 0 ? 0 : -1;
  const selected = items[selectedIndex] ?? null;
  const hasSaved = items.some(i => i.kind === 'saved');
  const presets = items.filter(i => i.kind === 'preset');

  useEffect(() => frames?.subscribe(() => setVersion(v => v + 1)), [frames]);

  useEffect(() => {
    if (focused.current || !savedLoaded || !autoFocusNew || hasSaved) return;
    focused.current = true;
    newTile.current?.focus();
  }, [savedLoaded, autoFocusNew, hasSaved]);

  const select = (id: string): void => {
    if (id === selected?.id) return;
    onSelect(id);
    const index = items.findIndex(i => i.id === id);
    const item = items[index];
    const inStrip =
      (document.activeElement?.closest('[role="listbox"]') ?? null) !== null;
    // Focus on an option already announces its name; mouse and Random need the live region.
    if (item !== undefined && !inStrip) {
      announce(optionName(item, index, items.length));
    }
  };

  const menu: MenuItem[] =
    selected !== null && selected.kind === 'saved'
      ? [
          {
            id: 'open',
            label: t('home.menu.open'),
            onSelect: () => actions.open(selected),
          },
          {
            id: 'duplicate',
            label: t('home.menu.duplicate'),
            onSelect: () => actions.duplicate(selected),
          },
          {
            id: 'rename',
            label: t('home.menu.rename'),
            onSelect: () => setRenaming(selected),
          },
          {
            id: 'export',
            label: t('home.menu.export'),
            onSelect: () => actions.exportProject(selected),
          },
          {
            id: 'pin',
            label: t(selected.pinned ? 'home.menu.unpin' : 'home.menu.pin'),
            onSelect: () => actions.togglePin(selected),
          },
          {
            id: 'delete',
            label: t('home.menu.delete'),
            separatorBefore: true,
            onSelect: () => setDeleting(selected),
          },
        ]
      : [];

  const details =
    selected === null
      ? ''
      : selected.kind === 'saved' && selected.editedAt !== null
        ? t('home.details.saved', {
            name: selected.name,
            date: formatEditedDate(selected.editedAt, locale),
          })
        : t('home.details.preset', {name: selected.name});

  return (
    <div className="home" data-testid="home" data-ready={savedLoaded}>
      <div className="home-header">
        <button
          type="button"
          className="csg-btn csg-btn--ghost"
          data-testid="home-open-file"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="download" />
          {t('home.openFile')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file !== undefined) onOpenFile(file);
          }}
        />
      </div>
      {items.length === 0 ? (
        <div className="home-stage home-stage--empty" data-testid="home-lineup">
          <div className="home-floor" />
          <p className="home-empty-lineup">
            {catalogReady ? t('home.noPresets') : t('home.sprite.loading')}
          </p>
        </div>
      ) : (
        <HomeLineup
          items={items}
          selectedIndex={selectedIndex}
          frames={frames}
          reducedMotion={reducedMotion}
          framesVersion={version}
          onSelect={select}
        />
      )}
      <p className="home-details csg-mono" data-testid="home-details">
        {details}
      </p>
      {savedLoaded && !hasSaved ? (
        <p className="home-empty" data-testid="home-empty">
          {t('home.empty')}
        </p>
      ) : null}
      <HomeStrip
        items={items}
        selectedIndex={selectedIndex}
        frames={frames}
        framesVersion={version}
        reducedMotion={reducedMotion}
        showTiles
        canRandom={presets.length > 0}
        newTileRef={newTile}
        onSelect={select}
        onPrimary={() => onPrimary(selected)}
        onNew={onNew}
        onRandom={onRandom}
      />
      <div className="home-actions">
        <Button
          variant="primary"
          data-testid="home-primary"
          onClick={() => onPrimary(selected)}
        >
          {primaryLabel(selected)}
        </Button>
        {menu.length > 0 && selected !== null ? (
          <MenuButton
            variant="icon"
            ariaLabel={t('home.more', {name: selected.name})}
            placement="up"
            items={menu}
          >
            <Icon name="dots" />
          </MenuButton>
        ) : null}
      </div>
      <RenameDialog
        item={renaming}
        onClose={() => setRenaming(null)}
        onRename={(item, name) => {
          setRenaming(null);
          actions.rename(item, name);
        }}
      />
      <DeleteDialog
        item={deleting}
        onClose={() => setDeleting(null)}
        onDelete={item => {
          setDeleting(null);
          actions.remove(item);
        }}
      />
    </div>
  );
}
