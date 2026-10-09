import {useMemo, type ReactElement} from 'react';
import type {TintSlot} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {setTint, type CharacterTarget} from '../../shared/document';
import {t} from '../../shared/i18n';
import {Button, SwatchRow, type Swatch} from '../../shared/ui';
import {messageOr} from './labels';
import {useCharacterSpec} from './use-character-spec';

/** Id of the synthetic checked swatch for a tint that is in no swatch set (REQ-UX-055). */
const CUSTOM_PREFIX = 'custom:';

/** Props of {@link TintSwatchRow}. */
export interface TintSwatchRowProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
  /** The tint channel this row edits. */
  readonly channel: TintSlot;
  /** Name of the part (or channel) the color belongs to: the group is "Color: <name>". */
  readonly name: string;
  /** "Edit in Pro" on a custom color; `field` is `tints.<channel>` (REQ-UX-055). */
  readonly onEditInPro?: (field: string) => void;
}

/** The swatches of every set that lists `channel`, de-duplicated by hex, with spoken names. */
export function channelSwatches(
  catalog: Catalog,
  channel: TintSlot,
): Array<{readonly id: string; readonly hex: string; readonly name: string}> {
  const seen = new Set<string>();
  const out: Array<{id: string; hex: string; name: string}> = [];
  for (const set of catalog.swatchSets) {
    if (!set.channels.includes(channel)) continue;
    for (const swatch of set.swatches) {
      const hex = swatch.hex.toLowerCase();
      if (seen.has(hex)) continue;
      seen.add(hex);
      out.push({id: hex, hex, name: messageOr(swatch.nameKey, hex)});
    }
  }
  return out;
}

/**
 * Swatch row for one tint channel (REQ-UX-062): a radiogroup "Color: <name>" whose swatches
 * carry spoken names from the swatch-set data; each check commits one tint (the store folds a
 * keyboard burst into one entry through the command's coalesce key). A tint outside the set
 * shows as a checked "Custom color #rrggbb" swatch and never changes by being displayed
 * (REQ-UX-055).
 */
export function TintSwatchRow({
  target,
  catalog,
  channel,
  name,
  onEditInPro,
}: TintSwatchRowProps): ReactElement {
  const spec = useCharacterSpec(target);
  const current = spec.tints[channel]?.toLowerCase() ?? null;
  const swatches = useMemo<Swatch[]>(() => {
    const list: Swatch[] = channelSwatches(catalog, channel).map(s => ({
      id: s.id,
      name: s.name,
      color: s.hex,
    }));
    if (current !== null && !list.some(s => s.id === current)) {
      list.push({
        id: `${CUSTOM_PREFIX}${current}`,
        name: t('composer.color.custom', {hex: current}),
        color: current,
      });
    }
    return list;
  }, [catalog, channel, current]);
  const custom = swatches.find(s => s.id.startsWith(CUSTOM_PREFIX));
  return (
    <div className="cmp-tint-row">
      <SwatchRow
        label={t('composer.color.group', {name})}
        swatches={swatches}
        value={custom ? custom.id : current}
        onChange={id => {
          if (id.startsWith(CUSTOM_PREFIX)) return;
          target.apply(setTint(channel, id));
        }}
      />
      {custom && onEditInPro ? (
        <Button
          variant="ghost"
          small
          onClick={() => onEditInPro(`tints.${channel}`)}
        >
          {t('composer.editInPro')}
        </Button>
      ) : null}
    </div>
  );
}
