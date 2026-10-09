import type {ReactElement} from 'react';
import type {ExportSettings} from '@csg/parts-schema';
import {SegmentedControl} from '../../shared/ui';
import {EXPORT_TEXT} from './export-text';
import type {ExportPatch} from './use-export-controller';

const SCALES = [1, 2, 4, 8] as const;

function clampInt(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}

/** Props of {@link ExportSettingsForm}. */
export interface ExportSettingsFormProps {
  readonly settings: ExportSettings;
  readonly onChange: (next: ExportPatch) => void;
  readonly disabled?: boolean;
  /** Placeholder of the file name field: the sanitized character name. */
  readonly namePlaceholder: string;
}

/** The P1 export settings (spec 005 REQ-EXP-003 to 009, 010, 016). */
export function ExportSettingsForm({
  settings,
  onChange,
  disabled = false,
  namePlaceholder,
}: ExportSettingsFormProps): ReactElement {
  return (
    <form
      className="exp-form"
      onSubmit={e => e.preventDefault()}
      aria-label="Export settings"
    >
      <fieldset className="exp-field" disabled={disabled}>
        <legend className="csg-label">{EXPORT_TEXT.layout}</legend>
        <SegmentedControl
          mode="radio"
          label={EXPORT_TEXT.layout}
          value={settings.layout}
          onChange={id => onChange({layout: id as ExportSettings['layout']})}
          segments={[
            {id: 'grid-by-animation', label: EXPORT_TEXT.layoutGrid},
            {id: 'strip-per-animation', label: EXPORT_TEXT.layoutStrip},
            {id: 'frames-zip', label: EXPORT_TEXT.layoutFrames},
          ]}
        />
      </fieldset>
      {settings.layout === 'grid-by-animation' ? (
        <fieldset className="exp-field" disabled={disabled}>
          <legend className="csg-label">{EXPORT_TEXT.rowOrder}</legend>
          <SegmentedControl
            mode="radio"
            label={EXPORT_TEXT.rowOrder}
            value={settings.rowOrder}
            onChange={id =>
              onChange({rowOrder: id as ExportSettings['rowOrder']})
            }
            segments={[
              {id: 'clip-major', label: EXPORT_TEXT.rowClip},
              {id: 'direction-major', label: EXPORT_TEXT.rowDirection},
            ]}
          />
        </fieldset>
      ) : null}
      <fieldset className="exp-field" disabled={disabled}>
        <legend className="csg-label">{EXPORT_TEXT.scales}</legend>
        <div className="exp-checks">
          {SCALES.map(s => {
            const on = settings.scales.includes(s);
            const last = on && settings.scales.length === 1;
            return (
              <label key={s} className="exp-check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={last}
                  onChange={() =>
                    onChange({
                      scales: on
                        ? settings.scales.filter(x => x !== s)
                        : [...settings.scales, s].sort((a, b) => a - b),
                    })
                  }
                />
                {s}×
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="exp-grid" aria-disabled={disabled}>
        <label className="exp-num">
          <span className="csg-label">{EXPORT_TEXT.padding}</span>
          <input
            type="number"
            min={0}
            max={16}
            step={1}
            disabled={disabled}
            value={settings.paddingPx}
            onChange={e => {
              const v = clampInt(e.target.value, 0, 16);
              if (v !== null) onChange({paddingPx: v});
            }}
          />
        </label>
        <label className="exp-num">
          <span className="csg-label">{EXPORT_TEXT.margin}</span>
          <input
            type="number"
            min={0}
            max={16}
            step={1}
            disabled={disabled}
            value={settings.marginPx}
            onChange={e => {
              const v = clampInt(e.target.value, 0, 16);
              if (v !== null) onChange({marginPx: v});
            }}
          />
        </label>
        <label className="exp-num">
          <span className="csg-label">{EXPORT_TEXT.maxColumns}</span>
          <input
            type="number"
            min={1}
            max={256}
            step={1}
            disabled={disabled}
            placeholder="None"
            aria-label={`${EXPORT_TEXT.maxColumns}. ${EXPORT_TEXT.maxColumnsHint}`}
            value={settings.maxColumns ?? ''}
            onChange={e =>
              onChange({maxColumns: clampInt(e.target.value, 1, 256)})
            }
          />
        </label>
      </div>
      <label className="exp-check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={settings.powerOfTwo}
          onChange={e => onChange({powerOfTwo: e.target.checked})}
        />
        {EXPORT_TEXT.powerOfTwo}
      </label>
      <fieldset className="exp-field" disabled={disabled}>
        <legend className="csg-label">{EXPORT_TEXT.metadata}</legend>
        <SegmentedControl
          mode="radio"
          label={EXPORT_TEXT.metadata}
          value={settings.metadata}
          onChange={id =>
            onChange({metadata: id as ExportSettings['metadata']})
          }
          segments={[
            {id: 'aseprite-json', label: EXPORT_TEXT.metaAseprite},
            {id: 'json', label: EXPORT_TEXT.metaJson},
            {id: 'none', label: EXPORT_TEXT.metaNone},
          ]}
        />
      </fieldset>
      <label className="exp-num">
        <span className="csg-label">{EXPORT_TEXT.baseName}</span>
        <input
          type="text"
          maxLength={64}
          disabled={disabled}
          placeholder={namePlaceholder}
          aria-label={`${EXPORT_TEXT.baseName}. ${EXPORT_TEXT.baseNameHint}`}
          value={settings.baseName ?? ''}
          onChange={e => {
            onChange({
              baseName: e.target.value === '' ? undefined : e.target.value,
            });
          }}
        />
      </label>
    </form>
  );
}
