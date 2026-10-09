import {useId, useMemo, type ReactElement} from 'react';
import type {CharacterSpec} from '@csg/parts-schema';
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
  Icon,
  OptionTileGrid,
  type OptionTile,
} from '../../shared/ui';
import {slotLabel} from './labels';
import {PartArt} from './part-art';
import {useCharacterSpec} from './use-character-spec';

const NONE = '__none';
const CUSTOM = '__custom';

/** Props of {@link SlotTileGroups}. */
export interface SlotTileGroupsProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
  /** Slot IDs to show, in order: `EasyCategoryDef.slots` (REQ-UX-060). */
  readonly slots: readonly string[];
  /** Tiles per row, for Up/Down. Measured from layout when omitted. */
  readonly columns?: number;
  /** Refs whose asset is still loading; their tiles are `aria-busy` (REQ-UX-067). */
  readonly busyRefs?: ReadonlySet<string>;
  /** A part was chosen (`ref` null for None): drives the swatch row of the category (REQ-UX-062). */
  readonly onSelect?: (slot: string, ref: string | null) => void;
  /** "Edit in Pro" on a Custom tile; `field` is `parts.<slot>` (REQ-UX-055). */
  readonly onEditInPro?: (field: string) => void;
  readonly tileWidth?: number;
}

interface GroupModel {
  readonly slot: string;
  readonly tiles: readonly OptionTile[];
  readonly value: string | null;
  readonly custom: boolean;
  readonly byId: ReadonlyMap<string, CatalogPart>;
}

function buildGroup(
  catalog: Catalog,
  spec: CharacterSpec,
  slot: string,
  busyRefs: ReadonlySet<string> | undefined,
): GroupModel {
  const optional =
    catalog.slots.slots.find(s => s.id === slot)?.required !== true;
  const parts = catalog.parts.filter(
    part =>
      part.slot === slot &&
      (slot === 'body' || catalog.compatible(part, spec).ok),
  );
  const equipped = slot === 'body' ? spec.body.ref : spec.parts[slot]?.ref;
  const tiles: OptionTile[] = [];
  if (optional) {
    tiles.push({
      id: NONE,
      label: t('composer.part.none'),
      art: <Icon name="x" size={32} />,
    });
  }
  for (const part of parts) {
    tiles.push({
      id: part.ref,
      label: part.name,
      art: <PartArt slot={slot} thumbnailUrl={part.thumbnailUrl} />,
      busy: busyRefs?.has(part.ref) || undefined,
    });
  }
  const listed = equipped !== undefined && parts.some(p => p.ref === equipped);
  const custom = equipped !== undefined && !listed;
  if (custom) {
    tiles.push({
      id: CUSTOM,
      label: t('composer.part.custom'),
      art: <PartArt slot={slot} />,
    });
  }
  return {
    slot,
    tiles,
    value: custom ? CUSTOM : (equipped ?? (optional ? NONE : null)),
    custom,
    byId: new Map(parts.map(p => [p.ref, p])),
  };
}

/**
 * One option-tile group per slot (REQ-UX-061, REQ-UX-094): a `listbox` with a visible heading,
 * a "None" tile first for optional slots, only parts compatible with the current body, style
 * and species, and a "Custom" tile with "Edit in Pro" for a part the tiles cannot show
 * (REQ-UX-055). Bound to a {@link CharacterTarget}, so the wizard binds it to its draft.
 */
export function SlotTileGroups({
  target,
  catalog,
  slots,
  columns,
  busyRefs,
  onSelect,
  onEditInPro,
  tileWidth,
}: SlotTileGroupsProps): ReactElement {
  const spec = useCharacterSpec(target);
  const base = useId();
  const groups = useMemo(
    () => slots.map(slot => buildGroup(catalog, spec, slot, busyRefs)),
    [catalog, spec, slots, busyRefs],
  );

  const choose = (group: GroupModel, id: string) => {
    if (id === CUSTOM) return;
    if (id === NONE) {
      target.apply(clearSlot(group.slot));
      announce(t('composer.part.selected', {name: t('composer.part.none')}));
      onSelect?.(group.slot, null);
      return;
    }
    const part = group.byId.get(id);
    if (!part) return;
    target.apply(equipPartNamed(group.slot, part.ref, part.name));
    announce(t('composer.part.selected', {name: part.name}));
    onSelect?.(group.slot, part.ref);
  };

  return (
    <div className="cmp-slot-groups">
      {groups.map(group => {
        const headingId = `${base}-${group.slot}`;
        return (
          <section key={group.slot} className="cmp-slot-group">
            <div className="cmp-slot-group__head">
              <h3 id={headingId} className="cmp-slot-group__title">
                {slotLabel(catalog, group.slot)}
              </h3>
              {group.custom && onEditInPro ? (
                <Button
                  variant="ghost"
                  small
                  onClick={() => onEditInPro(`parts.${group.slot}`)}
                >
                  {t('composer.editInPro')}
                </Button>
              ) : null}
            </div>
            <OptionTileGrid
              labelledBy={headingId}
              options={group.tiles}
              value={group.value}
              onChange={id => choose(group, id)}
              {...(columns === undefined ? {} : {columns})}
              {...(tileWidth === undefined ? {} : {tileWidth})}
            />
          </section>
        );
      })}
    </div>
  );
}
