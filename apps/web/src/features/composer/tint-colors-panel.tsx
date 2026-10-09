import {useEffect, useRef, useState, type ReactElement} from 'react';
import {TINT_SLOTS, type TintSlot} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {setTint, type CharacterTarget} from '../../shared/document';
import {t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {ColorPicker} from './color-picker';
import {channelSwatches} from './tint-swatch-row';
import {useCharacterSpec} from './use-character-spec';

/** Props of {@link TintColorsPanel}. */
export interface TintColorsPanelProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
  /** Colors of the active palette (spec 003), shown as swatches instead of the sets (AC-CMP-016.1). */
  readonly palette?: readonly string[];
  /** Focus the control of this channel, for the "Edit in Pro" hand-off (AC-UX-055.2). */
  readonly focusChannel?: TintSlot;
  /** A slider drag starts or ends: the host wraps it in one history gesture (REQ-CMP-017). */
  readonly onGestureStart?: () => void;
  readonly onGestureEnd?: () => void;
}

/** DOM id of the trigger of a channel, for focus hand-off. */
export const tintTriggerId = (channel: TintSlot): string =>
  `cmp-tint-${channel}`;

/**
 * The Pro Colors tab (REQ-CMP-016): one row per tint channel with its current color, opening a
 * picker with hex field, HSV sliders and swatches. Enter or Space opens it, every swatch is
 * reachable by arrows, and Escape closes it and returns focus to the row's button.
 */
export function TintColorsPanel({
  target,
  catalog,
  palette,
  focusChannel,
  onGestureStart,
  onGestureEnd,
}: TintColorsPanelProps): ReactElement {
  const spec = useCharacterSpec(target);
  const [open, setOpen] = useState<TintSlot | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusChannel) return;
    root.current
      ?.querySelector<HTMLElement>(`#${tintTriggerId(focusChannel)}`)
      ?.focus();
  }, [focusChannel]);

  const close = (channel: TintSlot) => {
    setOpen(null);
    root.current
      ?.querySelector<HTMLElement>(`#${tintTriggerId(channel)}`)
      ?.focus();
  };

  return (
    <div className="cmp-tint-panel" ref={root}>
      {TINT_SLOTS.map(channel => {
        const hex = spec.tints[channel] ?? '#000000';
        const label = t(`composer.color.channel.${channel}` as MessageKey);
        const isOpen = open === channel;
        const swatches = palette
          ? palette.map(color => ({hex: color}))
          : channelSwatches(catalog, channel);
        return (
          <div key={channel} className="cmp-tint-panel__row">
            <button
              id={tintTriggerId(channel)}
              type="button"
              className="cmp-tint-panel__trigger"
              aria-expanded={isOpen}
              aria-label={`${label} ${hex}`}
              onClick={() => setOpen(isOpen ? null : channel)}
            >
              <span
                className="cmp-tint-panel__chip"
                style={{backgroundColor: hex}}
                aria-hidden="true"
              />
              <span>{label}</span>
              <span className="csg-mono cmp-tint-panel__hex">{hex}</span>
            </button>
            {isOpen ? (
              <div
                role="group"
                aria-label={t('composer.color.picker', {slot: label})}
                className="cmp-tint-panel__picker"
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    e.preventDefault();
                    close(channel);
                  }
                }}
              >
                <ColorPicker
                  value={hex}
                  swatches={swatches}
                  swatchLabel={
                    palette
                      ? t('composer.color.palette')
                      : t('composer.color.swatches')
                  }
                  onChange={next => target.apply(setTint(channel, next))}
                  {...(onGestureStart ? {onGestureStart} : {})}
                  {...(onGestureEnd ? {onGestureEnd} : {})}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
