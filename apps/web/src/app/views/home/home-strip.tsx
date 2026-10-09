import {t} from '../../../shared/i18n';
import {useEffect, useRef} from 'react';
import type {KeyboardEvent, ReactElement, Ref} from 'react';
import {Icon} from '../../../shared/ui';
import type {HomeItem} from './lineup-model';
import {PlaceholderFigure, StillImage} from './sprite';
import type {FrameSource} from './use-home-frames';

/** Props of {@link HomeStrip}. */
export interface HomeStripProps {
  readonly items: readonly HomeItem[];
  readonly selectedIndex: number;
  readonly frames: FrameSource | null;
  readonly framesVersion: number;
  readonly reducedMotion: boolean;
  /** Show "New character" and "Random preset" (hidden in the view-only layout, REQ-UX-088). */
  readonly showTiles: boolean;
  readonly canRandom: boolean;
  readonly newTileRef: Ref<HTMLButtonElement>;
  readonly onSelect: (id: string) => void;
  readonly onPrimary: () => void;
  readonly onNew: () => void;
  readonly onRandom: () => void;
}

/** Accessible name of an avatar: "<name>, <n> of <N>, saved|preset" (REQ-UX-075). */
export function optionName(
  item: HomeItem,
  index: number,
  total: number,
): string {
  return t('home.option', {
    name: item.name,
    n: index + 1,
    total,
    kind: t(item.kind === 'saved' ? 'home.kind.saved' : 'home.kind.preset'),
  });
}

/**
 * The avatar strip (REQ-UX-075, REQ-UX-076, REQ-UX-077): a "New character" button, a "Random
 * preset" button and a horizontal single-select listbox of still avatars. Selection follows
 * focus; arrows, Home and End move the selection of strip and lineup together; Enter runs the
 * primary action. The selected avatar is scrolled fully into view.
 */
export function HomeStrip({
  items,
  selectedIndex,
  frames,
  framesVersion,
  reducedMotion,
  showTiles,
  canRandom,
  newTileRef,
  onSelect,
  onPrimary,
  onNew,
  onRandom,
}: HomeStripProps): ReactElement {
  const options = useRef(new Map<string, HTMLElement>());
  const moveFocus = useRef(false);
  const selected = items[selectedIndex];

  useEffect(() => {
    if (selected === undefined) return;
    const el = options.current.get(selected.id);
    if (el === undefined) return;
    if (moveFocus.current) {
      moveFocus.current = false;
      el.focus({preventScroll: true});
    }
    el.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [selected?.id, reducedMotion]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let next = selectedIndex;
    switch (e.key) {
      case 'ArrowLeft':
        next = Math.max(0, selectedIndex - 1);
        break;
      case 'ArrowRight':
        next = Math.min(items.length - 1, selectedIndex + 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Enter':
        e.preventDefault();
        onPrimary();
        return;
      default:
        return;
    }
    e.preventDefault();
    const target = items[next];
    if (target === undefined) return;
    moveFocus.current = true;
    onSelect(target.id);
    // Selection did not change (an end of the row): the focus already is where it belongs.
    if (next === selectedIndex) moveFocus.current = false;
  };

  return (
    <div className="home-strip">
      {showTiles ? (
        <div className="home-tiles">
          <button
            ref={newTileRef}
            type="button"
            className="home-tile home-tile--new"
            data-testid="home-new"
            onClick={onNew}
          >
            <span className="home-tile__art">
              <Icon name="plus" />
            </span>
            <span className="home-tile__label">{t('home.new')}</span>
          </button>
          <button
            type="button"
            className="home-tile"
            data-testid="home-random"
            disabled={!canRandom}
            onClick={onRandom}
          >
            <span className="home-tile__art">
              <Icon name="dice" />
            </span>
            <span className="home-tile__label">{t('home.random')}</span>
          </button>
        </div>
      ) : null}
      <div
        role="listbox"
        aria-orientation="horizontal"
        aria-label={t('home.strip')}
        className="home-avatars"
        data-version={framesVersion}
        onKeyDown={onKeyDown}
      >
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const view = frames?.view(item.id);
          return (
            <div
              key={item.id}
              ref={el => {
                if (el === null) options.current.delete(item.id);
                else options.current.set(item.id, el);
              }}
              role="option"
              aria-selected={isSelected}
              aria-label={optionName(item, index, items.length)}
              tabIndex={isSelected ? 0 : -1}
              className="home-option"
              data-kind={item.kind}
              data-id={item.id}
              onClick={() => onSelect(item.id)}
              onFocus={() => {
                if (!isSelected) onSelect(item.id);
              }}
            >
              <span className="home-option__art">
                {view === undefined ? (
                  <PlaceholderFigure
                    url={item.thumbnailUrl}
                    className="home-avatar-pending"
                  />
                ) : (
                  <StillImage blob={view.avatarBlob} className="home-avatar" />
                )}
              </span>
              <span className="home-option__label" aria-hidden="true">
                {item.name}
              </span>
              {item.pinned ? (
                <span className="home-option__pin" aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
