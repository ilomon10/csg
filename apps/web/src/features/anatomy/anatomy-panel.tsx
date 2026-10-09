import {t} from '../../shared/i18n';
import {useRef, useState, type ReactElement} from 'react';
import {ANATOMY_PARAM_KEYS, ANATOMY_PARAM_SPECS} from '@csg/parts-schema';
import {applyAnatomyPreset} from '../../shared/document';
import type {CharacterTarget} from '../../shared/document';
import {resolvePreset} from './anatomy-model';
import type {AnatomyCatalog} from './anatomy-model';
import {setAnatomyValue} from './anatomy-model';
import {AnatomySlider} from './anatomy-slider';
import type {AnatomyGesture} from './anatomy-slider';
import {BodyShapeCards} from './body-shape-cards';
import {PresetSelector} from './preset-selector';
import {ReadabilityHint} from './readability-hint';
import type {ReadabilityEstimate} from './readability-hint';
import {useCharacterSpec} from './use-character-spec';
import './anatomy.css';

/** Props of {@link AnatomyPanel}. */
export interface AnatomyPanelProps {
  readonly target: CharacterTarget;
  readonly catalog: AnatomyCatalog;
  /** The document store (`beginGesture`/`endGesture`); omit for a history-free draft. */
  readonly gesture?: AnatomyGesture;
  /** Output resolution and projected sizes for the readability hint (REQ-ANA-015). */
  readonly readability?: {
    readonly resolutionPx: number;
    readonly estimate: ReadabilityEstimate | null;
  };
}

/**
 * The Pro Anatomy inspector tab (REQ-ANA-013, 014, 017, 022, 023): preset selector with
 * "(modified)" and Reset, body-shape cards, nine sliders with numeric inputs, and the
 * readability hint. Every control carries `data-focus-key` (`anatomy.preset`, `anatomy.<key>`,
 * `anatomy.shape`) so the shell can focus it ("Edit in Pro", AC-UX-055.1).
 */
export function AnatomyPanel({
  target,
  catalog,
  gesture,
  readability,
}: AnatomyPanelProps): ReactElement {
  const spec = useCharacterSpec(target);
  const root = useRef<HTMLDivElement>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const presets = [...catalog.anatomyPresets.values()];
  const state = resolvePreset(spec.anatomy, spec.style, catalog, remembered);
  const baseline = state ? catalog.anatomyPresets.get(state.id) : undefined;

  const applyPreset = (id: string) => {
    setRemembered(id);
    target.apply(applyAnatomyPreset(id));
  };

  return (
    <div className="csg-anat" ref={root}>
      <PresetSelector
        presets={presets}
        state={state}
        onSelect={applyPreset}
        onReset={() => state && applyPreset(state.id)}
      />
      {readability ? (
        <ReadabilityHint
          resolutionPx={readability.resolutionPx}
          estimate={readability.estimate}
          onFocusLimbThickness={() =>
            root.current
              ?.querySelector<HTMLElement>(
                '[data-focus-key="anatomy.limbThickness"] input[type="range"]',
              )
              ?.focus()
          }
        />
      ) : null}
      <h3 className="csg-label csg-anat__heading">
        {t('anatomy.shape.title')}
      </h3>
      <BodyShapeCards target={target} catalog={catalog} />
      <div className="csg-anat__sliders">
        {ANATOMY_PARAM_KEYS.map(key => (
          <AnatomySlider
            key={key}
            paramKey={key}
            value={spec.anatomy[key]}
            resetValue={
              baseline?.values[key] ?? ANATOMY_PARAM_SPECS[key].default
            }
            gesture={gesture}
            onChange={value =>
              target.apply(
                setAnatomyValue(key, value, t(`anatomy.param.${key}`)),
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
