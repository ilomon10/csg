import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type {Catalog, CatalogPart} from '../../shared/catalog';
import {
  clearSlot,
  equipPartNamed,
  type CharacterTarget,
} from '../../shared/document';
import {t} from '../../shared/i18n';
import {
  announce,
  Button,
  OptionTileGrid,
  type OptionTile,
} from '../../shared/ui';
import {incompatibleReason, slotLabel} from './labels';
import {PartArt} from './part-art';
import {useCharacterSpec} from './use-character-spec';

/** Props of {@link PartLibrary}. */
export interface PartLibraryProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
  /** Slot filter (null or omitted: all slots). Controlled when `onSlotChange` is given. */
  readonly slot?: string | null;
  readonly onSlotChange?: (slot: string | null) => void;
  /** Refs whose asset is still loading (`aria-busy`, REQ-UX-067). */
  readonly busyRefs?: ReadonlySet<string>;
  /** Tiles per row for Up/Down. Measured from layout when omitted. */
  readonly columns?: number;
}

/** Case-insensitive match on the name and tags of a part (REQ-CMP-030). */
export function matchesQuery(part: CatalogPart, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    part.name.toLowerCase().includes(q) ||
    part.tags.some(tag => tag.toLowerCase().includes(q))
  );
}

/**
 * The Pro part library (REQ-CMP-009, 029, 030, 032): search, slot filter, "Show incompatible"
 * and a keyboard grid. Arrows move, Enter or Space equips, Delete clears the focused part's
 * slot. Incompatible parts, when shown, are disabled and carry their reason in their
 * accessible name. Tiles show the manifest thumbnail or the slot icon.
 */
export function PartLibrary({
  target,
  catalog,
  slot: slotProp,
  onSlotChange,
  busyRefs,
  columns,
}: PartLibraryProps): ReactElement {
  const spec = useCharacterSpec(target);
  const [query, setQuery] = useState('');
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [slotState, setSlotState] = useState<string | null>(null);
  const slot = onSlotChange ? (slotProp ?? null) : slotState;
  const setSlot = (next: string | null) => {
    setSlotState(next);
    onSlotChange?.(next);
  };
  const base = useId();
  const gridWrap = useRef<HTMLDivElement>(null);

  const slotChips = useMemo(
    () =>
      [...catalog.slots.slots]
        .sort((a, b) => a.order - b.order)
        .filter(def => catalog.parts.some(p => p.slot === def.id)),
    [catalog],
  );

  const parts = useMemo(
    () =>
      catalog.parts.filter(
        part =>
          (slot === null || part.slot === slot) &&
          matchesQuery(part, query) &&
          (showIncompatible ||
            part.slot === 'body' ||
            catalog.compatible(part, spec).ok),
      ),
    [catalog, slot, query, showIncompatible, spec],
  );

  const equippedRef = (part: CatalogPart): string | undefined =>
    part.slot === 'body' ? spec.body.ref : spec.parts[part.slot]?.ref;

  const reasons = useMemo(() => {
    const map = new Map<string, string>();
    for (const part of parts) {
      if (part.slot === 'body') continue;
      const reason = incompatibleReason(catalog, part, spec);
      if (reason) map.set(part.ref, reason);
    }
    return map;
  }, [catalog, parts, spec]);

  const tiles: OptionTile[] = parts.map(part => {
    const reason = reasons.get(part.ref);
    const equipped = equippedRef(part) === part.ref;
    return {
      id: part.ref,
      label: part.name,
      sub: reason ?? (equipped ? t('composer.part.equippedSub') : undefined),
      art: <PartArt slot={part.slot} thumbnailUrl={part.thumbnailUrl} />,
      description: reason,
      disabled: reason !== undefined,
      busy: busyRefs?.has(part.ref) || undefined,
    };
  });

  const value =
    slot === null
      ? null
      : (parts.find(p => equippedRef(p) === p.ref)?.ref ?? null);

  const optionName = (option: OptionTile): string => {
    const part = parts.find(p => p.ref === option.id);
    if (!part) return option.label;
    // WCAG 2.5.3: the name starts with the visible text (label, then the sub line).
    const visible = [option.label, option.sub].filter(Boolean).join(' ');
    const equipped = equippedRef(part) === part.ref;
    const state = equipped
      ? option.sub === undefined
        ? t('composer.part.equipped')
        : ''
      : t('composer.part.notEquipped');
    return [visible, slotLabel(catalog, part.slot), state]
      .filter(Boolean)
      .join(', ');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Delete') return;
    const options = Array.from(
      gridWrap.current?.querySelectorAll('[role="option"]') ?? [],
    );
    const index = options.indexOf(document.activeElement as Element);
    const part = index >= 0 ? parts[index] : undefined;
    if (!part || part.slot === 'body') return;
    e.preventDefault();
    target.apply(clearSlot(part.slot));
    announce(t('composer.part.cleared', {slot: slotLabel(catalog, part.slot)}));
  };

  return (
    <div className="cmp-library" onKeyDown={onKeyDown}>
      <label className="cmp-field cmp-library__search">
        <span className="csg-sr">{t('composer.library.search')}</span>
        <input
          type="search"
          className="cmp-input"
          placeholder={t('composer.library.search')}
          autoComplete="off"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </label>
      <div
        className="cmp-chips"
        role="group"
        aria-label={t('composer.library.slotFilter')}
      >
        <button
          type="button"
          className="cmp-chip"
          aria-pressed={slot === null}
          onClick={() => setSlot(null)}
        >
          {t('composer.library.allSlots')}
        </button>
        {slotChips.map(def => (
          <button
            key={def.id}
            type="button"
            className="cmp-chip"
            aria-pressed={slot === def.id}
            onClick={() => setSlot(def.id)}
          >
            {slotLabel(catalog, def.id)}
          </button>
        ))}
      </div>
      <label className="cmp-check" htmlFor={`${base}-incompat`}>
        <input
          id={`${base}-incompat`}
          type="checkbox"
          checked={showIncompatible}
          onChange={e => setShowIncompatible(e.target.checked)}
        />
        {t('composer.library.showIncompatible')}
      </label>
      <div ref={gridWrap} className="cmp-library__grid">
        {tiles.length === 0 ? (
          <div className="cmp-library__empty" role="status">
            <p>{t('composer.library.empty')}</p>
            <Button small onClick={() => setQuery('')}>
              {t('composer.library.clearSearch')}
            </Button>
          </div>
        ) : (
          <OptionTileGrid
            label={t('composer.library.parts')}
            options={tiles}
            value={value}
            optionName={optionName}
            {...(columns === undefined ? {} : {columns})}
            tileWidth={96}
            onChange={ref => {
              const part = parts.find(p => p.ref === ref);
              if (!part) return;
              target.apply(equipPartNamed(part.slot, part.ref, part.name));
              announce(t('composer.part.selected', {name: part.name}));
            }}
          />
        )}
      </div>
    </div>
  );
}
