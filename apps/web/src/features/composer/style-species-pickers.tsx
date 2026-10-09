import type {ReactElement} from 'react';
import {
  CHARACTER_SPECIES,
  CHARACTER_STYLES,
  type CharacterSpecies,
  type CharacterStyle,
} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {
  setSpecies,
  setStyle,
  type CharacterTarget,
} from '../../shared/document';
import {t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {OptionCardGroup, type OptionCard} from '../../shared/ui';
import {isPairAvailable} from './style-gating';
import {useCharacterSpec} from './use-character-spec';

/** Props shared by {@link StylePicker} and {@link SpeciesPicker}. */
export interface CharacterPickerProps {
  readonly target: CharacterTarget;
  readonly catalog: Catalog;
  readonly className?: string;
}

/**
 * Style cards in the fixed order Realistic, Chibi, Stickman, Voxel (AC-CMP-045.1). Options
 * outside the gating rule show "Coming soon" as text, stay reachable by arrows and cannot be
 * chosen (REQ-CMP-045, REQ-UX-092). Shared by the composer and the wizard.
 */
export function StylePicker({
  target,
  catalog,
  className,
}: CharacterPickerProps): ReactElement {
  const spec = useCharacterSpec(target);
  const options: OptionCard[] = CHARACTER_STYLES.map(style => ({
    id: style,
    label: t(`composer.style.${style}` as MessageKey),
    disabled: !isPairAvailable(catalog, style, spec.species),
  }));
  return (
    <OptionCardGroup
      label={t('composer.style.label')}
      options={options}
      value={spec.style}
      disabledLabel={t('style.comingSoon')}
      disabledDescription={t('style.comingSoonDescription')}
      {...(className ? {className} : {})}
      onChange={id => target.apply(setStyle(id as CharacterStyle))}
    />
  );
}

/** Species cards: Human, Animal, Monster, gated by the same rule as {@link StylePicker}. */
export function SpeciesPicker({
  target,
  catalog,
  className,
}: CharacterPickerProps): ReactElement {
  const spec = useCharacterSpec(target);
  const options: OptionCard[] = CHARACTER_SPECIES.map(species => ({
    id: species,
    label: t(`composer.species.${species}` as MessageKey),
    disabled: !isPairAvailable(catalog, spec.style, species),
  }));
  return (
    <OptionCardGroup
      label={t('composer.species.label')}
      options={options}
      value={spec.species}
      disabledLabel={t('style.comingSoon')}
      disabledDescription={t('style.comingSoonDescription')}
      {...(className ? {className} : {})}
      onChange={id => target.apply(setSpecies(id as CharacterSpecies))}
    />
  );
}
