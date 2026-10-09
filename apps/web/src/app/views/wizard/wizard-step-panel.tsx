import {t} from '../../../shared/i18n';
import {useState} from 'react';
import type {ReactElement} from 'react';
import type {TintSlot} from '@csg/parts-schema';
import {BodyShapeCards} from '../../../features/anatomy';
import {
  SlotTileGroups,
  SpeciesPicker,
  StylePicker,
  TintSwatchRow,
  firstTintChannel,
  useCharacterSpec,
} from '../../../features/composer';
import type {Catalog} from '../../../shared/catalog';
import type {CharacterTarget} from '../../../shared/document';
import type {MessageKey} from '../../../shared/i18n';
import type {WizardStep} from './wizard-steps';

/** Props of {@link WizardStepPanel}. */
export interface WizardStepPanelProps {
  readonly step: WizardStep;
  readonly catalog: Catalog;
  readonly target: CharacterTarget;
  readonly name: string;
  readonly onName: (name: string) => void;
  /** Enter in the name field (a form submit): finish. */
  readonly onSubmit: () => void;
}

const tintName = (channel: string): string => {
  const key = `wiz.tint.${channel}`;
  return t(key as MessageKey);
};

/** Tile groups plus the swatch row of one Easy category (REQ-UX-094). */
function CategoryStep({
  step,
  catalog,
  target,
}: Pick<WizardStepPanelProps, 'step' | 'catalog' | 'target'>): ReactElement {
  const def = catalog.easyCategories.find(c => c.id === step.category);
  const [channel, setChannel] = useState<TintSlot | null>(null);
  const row = channel ?? (def?.tintChannels[0] as TintSlot | undefined);
  return (
    <>
      <SlotTileGroups
        target={target}
        catalog={catalog}
        slots={def?.slots ?? []}
        onSelect={(_slot, ref) => {
          if (ref === null) return;
          const next = firstTintChannel(catalog, ref);
          if (next !== null && def?.tintChannels.includes(next)) {
            setChannel(next);
          }
        }}
      />
      {row ? (
        <TintSwatchRow
          target={target}
          catalog={catalog}
          channel={row}
          name={tintName(row)}
        />
      ) : null}
    </>
  );
}

function Summary({target}: {readonly target: CharacterTarget}): ReactElement {
  const spec = useCharacterSpec(target);
  return (
    <ul className="wz-summary" aria-label={t('wiz.summary.label')}>
      <li>
        {t('composer.style.label')}:{' '}
        <b>{t(`composer.style.${spec.style}` as MessageKey)}</b>
      </li>
      <li>
        {t('composer.species.label')}:{' '}
        <b>{t(`composer.species.${spec.species}` as MessageKey)}</b>
      </li>
    </ul>
  );
}

/** The body of one wizard step (REQ-UX-090..094). */
export function WizardStepPanel({
  step,
  catalog,
  target,
  name,
  onName,
  onSubmit,
}: WizardStepPanelProps): ReactElement {
  switch (step.id) {
    case 'style':
      return <StylePicker target={target} catalog={catalog} />;
    case 'species':
      return <SpeciesPicker target={target} catalog={catalog} />;
    case 'body':
      return <BodyShapeCards target={target} catalog={catalog} />;
    case 'face':
    case 'hair':
    case 'outfit':
      return <CategoryStep step={step} catalog={catalog} target={target} />;
    case 'colors': {
      const def = catalog.easyCategories.find(c => c.id === 'colors');
      return (
        <div className="wz-colors">
          {(def?.tintChannels ?? []).map(channel => (
            <TintSwatchRow
              key={channel}
              target={target}
              catalog={catalog}
              channel={channel as TintSlot}
              name={tintName(channel)}
            />
          ))}
        </div>
      );
    }
    case 'name':
      return (
        <form
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="wz-field">
            <label htmlFor="wz-name">{t('wiz.name.label')}</label>
            <input
              id="wz-name"
              type="text"
              value={name}
              maxLength={64}
              autoComplete="off"
              placeholder={t('wiz.name.placeholder')}
              aria-describedby="wz-name-hint"
              onChange={e => onName(e.target.value)}
            />
            <span id="wz-name-hint" className="wz-hint">
              {t('wiz.name.hint')}
            </span>
          </div>
          <Summary target={target} />
        </form>
      );
  }
}
