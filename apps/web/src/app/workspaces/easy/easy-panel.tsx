import {t} from '../../../shared/i18n';
import {useEffect, useRef, useState} from 'react';
import type {ReactElement} from 'react';
import type {EasyCategoryDef, TintSlot} from '@csg/parts-schema';
import {BodyShapeCards} from '../../../features/anatomy';
import {
  SlotTileGroups,
  TintSwatchRow,
  firstTintChannel,
  useCharacterSpec,
} from '../../../features/composer';
import type {Catalog} from '../../../shared/catalog';
import type {CharacterTarget} from '../../../shared/document';
import type {MessageKey} from '../../../shared/i18n';
import {OptionTileGrid} from '../../../shared/ui';
import type {OptionTile} from '../../../shared/ui';
import {useBusyRefs} from '../../viewport';
import {activeChannel, equippedName, swatchFocusKey} from './easy-model';

/** Props of {@link EasyCategoryPanel}. */
export interface EasyCategoryPanelProps {
  readonly def: EasyCategoryDef;
  readonly catalog: Catalog;
  /** Target whose commands carry the Easy context (see `withEasyContext`). */
  readonly target: CharacterTarget;
  readonly onEditInPro: (field: string) => void;
}

const channelName = (channel: string): string =>
  t(`easy.tint.${channel}` as MessageKey);

/** Tags the checked swatch so undo can focus it by key (AC-UX-051.3). */
function SwatchRowHost({
  focusKey,
  children,
}: {
  readonly focusKey: string;
  readonly children: ReactElement;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    for (const old of root.querySelectorAll('[data-focus-key]')) {
      old.removeAttribute('data-focus-key');
    }
    root
      .querySelector('[role="radio"][aria-checked="true"]')
      ?.setAttribute('data-focus-key', focusKey);
  });
  return (
    <div ref={ref} className="ez-swatches">
      {children}
    </div>
  );
}

/**
 * Tiles, shape cards and the one swatch row of an Easy category (REQ-UX-060 to REQ-UX-063).
 * Everything comes from the category's data file; there are no sliders, number fields or free
 * color pickers (REQ-UX-063). Custom values show as selected Custom tiles, cards or swatches
 * with "Edit in Pro" and are never changed by being shown (REQ-UX-055).
 */
export function EasyCategoryPanel({
  def,
  catalog,
  target,
  onEditInPro,
}: EasyCategoryPanelProps): ReactElement {
  const spec = useCharacterSpec(target);
  const busyRefs = useBusyRefs();
  const [chosen, setChosen] = useState<{
    readonly category: string;
    readonly channel: string;
    readonly name: string | null;
  } | null>(null);
  const mine = chosen?.category === def.id ? chosen : null;
  const channel = activeChannel(def, mine?.channel ?? null);
  const isColors = def.id === 'colors';
  const nameOf = (ref: string) => catalog.parts.find(p => p.ref === ref)?.name;
  const rowName = isColors
    ? channel === null
      ? ''
      : channelName(channel)
    : (mine?.name ??
      equippedName(def, spec, nameOf) ??
      (channel === null ? '' : channelName(channel)));

  const channelTiles: OptionTile[] = isColors
    ? def.tintChannels.map(c => ({
        id: c,
        label: channelName(c),
        art: (
          <span
            className="ez-chip"
            style={{backgroundColor: spec.tints[c as TintSlot] ?? '#000000'}}
          />
        ),
      }))
    : [];

  return (
    <>
      <div className="ez-panel__scroll">
        {def.slots.length > 0 ? (
          <SlotTileGroups
            busyRefs={busyRefs}
            target={target}
            catalog={catalog}
            slots={def.slots}
            onEditInPro={onEditInPro}
            onSelect={(_slot, ref) => {
              if (ref === null) return;
              const next = firstTintChannel(catalog, ref);
              if (next !== null && def.tintChannels.includes(next)) {
                setChosen({
                  category: def.id,
                  channel: next,
                  name: nameOf(ref) ?? null,
                });
              }
            }}
          />
        ) : null}
        {def.anatomyPresets ? (
          <section className="ez-group" aria-labelledby={`ez-shape-${def.id}`}>
            <h3 id={`ez-shape-${def.id}`} className="ez-group__title">
              {t('easy.shape')}
            </h3>
            <BodyShapeCards
              target={target}
              catalog={catalog}
              label={t('easy.shapeGroup')}
              onEditInPro={() => onEditInPro('anatomy')}
            />
          </section>
        ) : null}
        {isColors ? (
          <section className="ez-group" aria-labelledby="ez-channels">
            <h3 id="ez-channels" className="ez-group__title">
              {t('ux.easy.colors' as MessageKey)}
            </h3>
            <OptionTileGrid
              labelledBy="ez-channels"
              options={channelTiles}
              value={channel}
              onChange={id =>
                setChosen({category: def.id, channel: id, name: null})
              }
            />
          </section>
        ) : null}
        {def.slots.length === 0 && !isColors ? (
          <p className="ez-hint">{t('easy.skin.hint')}</p>
        ) : null}
      </div>
      {channel === null ? null : (
        <SwatchRowHost focusKey={swatchFocusKey(channel)}>
          <TintSwatchRow
            key={channel}
            target={target}
            catalog={catalog}
            channel={channel as TintSlot}
            name={rowName}
            onEditInPro={onEditInPro}
          />
        </SwatchRowHost>
      )}
    </>
  );
}
