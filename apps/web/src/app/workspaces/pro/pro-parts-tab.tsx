import {MESSAGES, t} from '../../../shared/i18n';
import type {ReactElement} from 'react';
import {useCharacterSpec} from '../../../features/composer';
import type {Catalog} from '../../../shared/catalog';
import {clearSlot} from '../../../shared/document';
import type {CharacterTarget} from '../../../shared/document';
import type {MessageKey} from '../../../shared/i18n';
import {Button, announce} from '../../../shared/ui';

/** Props of {@link ProPartsTab}. */
export interface ProPartsTabProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
}

/**
 * The Pro Parts inspector tab: the equipped body and parts with a Remove button each. A part
 * the catalog does not know (a `user:` upload) shows as "Custom part"; this is where "Edit in
 * Pro" lands for such a part (REQ-UX-055).
 */
export function ProPartsTab({target, catalog}: ProPartsTabProps): ReactElement {
  const spec = useCharacterSpec(target);
  const slotName = (slot: string): string => {
    const key =
      catalog.slots.slots.find(s => s.id === slot)?.label ?? `slot.${slot}`;
    return Object.hasOwn(MESSAGES, key) ? t(key as MessageKey) : slot;
  };
  const nameOf = (ref: string): string =>
    catalog.parts.find(p => p.ref === ref)?.name ?? t('pro.parts.custom');
  const entries = Object.entries(spec.parts);
  return (
    <div className="pro-parts">
      <h3 className="csg-label">{t('pro.parts.title')}</h3>
      <ul className="pro-parts__list">
        <li className="pro-parts__row">
          <span className="pro-parts__slot">{t('pro.parts.body')}</span>
          <span className="pro-parts__name">{nameOf(spec.body.ref)}</span>
        </li>
        {entries.map(([slot, selection]) => (
          <li key={slot} className="pro-parts__row">
            <span className="pro-parts__slot">{slotName(slot)}</span>
            <span className="pro-parts__name">{nameOf(selection.ref)}</span>
            <span data-focus-key={`parts.${slot}`}>
              <Button
                small
                variant="ghost"
                aria-label={t('pro.parts.clear', {slot: slotName(slot)})}
                onClick={() => {
                  target.apply(clearSlot(slot));
                  announce(t('composer.part.cleared', {slot: slotName(slot)}));
                }}
              >
                {t('pro.parts.remove')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {entries.length === 0 ? (
        <p className="pro-hint">{t('pro.parts.empty')}</p>
      ) : null}
    </div>
  );
}
