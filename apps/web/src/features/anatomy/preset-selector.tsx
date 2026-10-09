import {t} from '../../shared/i18n';
import {useId, type ReactElement} from 'react';
import type {AnatomyPreset} from '@csg/parts-schema';
import {Button} from '../../shared/ui';
import type {PresetState} from './anatomy-model';

/** Props of {@link PresetSelector}. */
export interface PresetSelectorProps {
  readonly presets: readonly AnatomyPreset[];
  /** Null when no preset exists at all. */
  readonly state: PresetState | null;
  readonly onSelect: (id: string) => void;
  readonly onReset: () => void;
}

/**
 * Anatomy preset menu with the "(modified)" label and a Reset to that preset (REQ-ANA-013,
 * REQ-ANA-014). Presets come from data, so a new file appears without code (AC-ANA-013.2).
 */
export function PresetSelector({
  presets,
  state,
  onSelect,
  onReset,
}: PresetSelectorProps): ReactElement {
  const id = useId();
  const current = presets.find(p => p.id === state?.id);
  return (
    <div className="csg-anat-preset" data-focus-key="anatomy.preset">
      <label className="csg-label" htmlFor={id}>
        {t('anatomy.preset')}
      </label>
      <select
        id={id}
        className="csg-anat-select"
        value={state?.id ?? ''}
        onChange={e => onSelect(e.target.value)}
      >
        {presets.map(p => (
          <option key={p.id} value={p.id}>
            {p.id === state?.id && state.modified
              ? t('anatomy.preset.modified', {label: p.label})
              : p.label}
          </option>
        ))}
      </select>
      {state?.modified && current ? (
        <Button
          small
          variant="secondary"
          title={t('anatomy.reset.preset', {label: current.label})}
          onClick={onReset}
        >
          {t('anatomy.reset')}
        </Button>
      ) : null}
    </div>
  );
}
