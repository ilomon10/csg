import {t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {useId, useState, type ReactElement} from 'react';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {LookPreset, RenderSettings} from '@csg/parts-schema';
import type {DocumentStore} from '../../shared/document';
import {Button, Dialog} from '../../shared/ui';
import {RangeField, SelectField, SwitchField} from './fields';
import {
  changedLookGroups,
  deepEqual,
  lookPatch,
  presetMatches,
  resolveRenderPatch,
} from './render-model';
import type {RenderPatch} from './render-model';
import type {StructuralTiming} from './structural-timing';
import {useRenderEditor} from './use-render-editor';
import './look.css';

/** The slice of the shared catalog the Look panel reads. `Catalog` satisfies it. */
export interface LookCatalog {
  readonly lookPresets: ReadonlyArray<
    LookPreset & {
      /** Local URL of the 64 x 64 thumbnail. */
      readonly thumbnailUrl?: string;
    }
  >;
}

/** Props of {@link LookPanel}. */
export interface LookPanelProps {
  readonly store: DocumentStore;
  readonly catalog: LookCatalog;
  /** Measures structural changes until they show (budget 300 ms); omit to skip. */
  readonly timing?: StructuralTiming;
  /**
   * Show only the preset picker and "Reset look". The Pro Render tab sets it because it
   * already offers every Look control, so no control appears twice (REQ-EDT-034).
   */
  readonly presetOnly?: boolean;
}

/** The look preset that is the default (REQ-EDT-044). */
const DEFAULT_LOOK = 'classic-16bit';

interface ControlDef {
  readonly id: string;
  readonly label: MessageKey;
  readonly kind: 'select' | 'switch' | 'range';
  /** Recompiles or resizes, so its time to show is measured. */
  readonly structural: boolean;
  readonly get: (r: RenderSettings) => string | number | boolean;
  readonly patch: (value: never) => RenderPatch;
  /** Patch that restores `baseline`'s value; defaults to `patch(get(baseline))`. */
  readonly resetPatch?: (baseline: RenderSettings) => RenderPatch;
  readonly options?: (
    r: RenderSettings,
  ) => ReadonlyArray<{value: string; label: string}>;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

const num = (values: readonly number[]) =>
  values.map(v => ({value: String(v), label: String(v)}));

/**
 * The 10 controls of the Look panel (AC-EDT-034.1). They map to typed RenderSettings fields in
 * M3; M4 adds the params that graphs mark "show in Look panel" (AC-EDT-034.2).
 */
const CONTROLS: readonly ControlDef[] = [
  {
    id: 'toonBands',
    label: 'look.control.toonBands',
    kind: 'select',
    structural: true,
    get: r => String(r.toon.bands),
    patch: ((v: string) => ({toon: {bands: Number(v)}})) as ControlDef['patch'],
    options: () => num([2, 3, 4]),
  },
  {
    id: 'rim',
    label: 'look.control.rim',
    kind: 'switch',
    structural: false,
    get: r => r.toon.rim.enabled,
    patch: ((v: boolean) => ({
      toon: {rim: {enabled: v}},
    })) as ControlDef['patch'],
  },
  {
    id: 'rimStrength',
    label: 'look.control.rimStrength',
    kind: 'range',
    structural: false,
    get: r => r.toon.rim.strength,
    patch: ((v: number) => ({
      toon: {rim: {strength: v}},
    })) as ControlDef['patch'],
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'outline',
    label: 'look.control.outline',
    kind: 'switch',
    structural: true,
    get: r => r.outline.outer.enabled,
    patch: ((v: boolean) => ({
      outline: {outer: {enabled: v}},
    })) as ControlDef['patch'],
  },
  {
    id: 'outlineWidth',
    label: 'look.control.outlineWidth',
    kind: 'select',
    structural: true,
    get: r => String(r.outline.outer.widthPx),
    patch: ((v: string) => ({
      outline: {outer: {widthPx: Number(v)}},
    })) as ControlDef['patch'],
    options: () => num([1, 2, 3]),
  },
  {
    id: 'innerLines',
    label: 'look.control.innerLines',
    kind: 'switch',
    structural: true,
    get: r => r.outline.inner.enabled,
    patch: ((v: boolean) => ({
      outline: {inner: {enabled: v}},
    })) as ControlDef['patch'],
  },
  {
    id: 'palette',
    label: 'look.control.palette',
    kind: 'select',
    structural: true,
    get: r => r.palette.id,
    patch: ((v: string) => ({palette: {id: v}})) as ControlDef['patch'],
    // A custom palette (GameBoy, NES) comes from a preset: its colors are edited in Pro.
    resetPatch: b => ({
      palette: {
        id: b.palette.id,
        ...(b.palette.colors ? {colors: b.palette.colors} : {}),
      },
    }),
    options: r =>
      (
        [
          'none',
          'pico-8',
          'endesga-32',
          ...(r.palette.id === 'custom' ? ['custom'] : []),
        ] as const
      ).map(id => ({
        value: id,
        label: t(`render.palette.${id}` as MessageKey),
      })),
  },
  {
    id: 'dither',
    label: 'look.control.dither',
    kind: 'select',
    structural: true,
    get: r => r.palette.dither.mode,
    patch: ((v: string) => ({
      palette: {dither: {mode: v}},
    })) as ControlDef['patch'],
    options: () =>
      (['none', 'bayer2', 'bayer4', 'bayer8'] as const).map(id => ({
        value: id,
        label: t(`render.dither.${id}` as MessageKey),
      })),
  },
  {
    id: 'ditherStrength',
    label: 'look.control.ditherStrength',
    kind: 'range',
    structural: false,
    get: r => r.palette.dither.strength,
    patch: ((v: number) => ({
      palette: {dither: {strength: v}},
    })) as ControlDef['patch'],
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'ambient',
    label: 'look.control.ambient',
    kind: 'range',
    structural: false,
    get: r => r.lighting.ambient,
    patch: ((v: number) => ({lighting: {ambient: v}})) as ControlDef['patch'],
    min: 0,
    max: 1,
    step: 0.05,
  },
];

/**
 * The simplified Look panel (REQ-EDT-034, REQ-EDT-044, REQ-EDT-045): a preset picker and ten
 * labelled controls, each with its own reset to the active preset's value. Applying a preset
 * or "Reset look" over customized values asks first, naming what is replaced, and is one
 * undoable `render` command. No graph UI is mounted.
 */
export function LookPanel({
  store,
  catalog,
  timing,
  presetOnly = false,
}: LookPanelProps): ReactElement | null {
  const editor = useRenderEditor(store, timing);
  const presetId = useId();
  const [remembered, setRemembered] = useState<string | null>(null);
  const [pending, setPending] = useState<LookPreset | null>(null);
  const render = editor.render;
  if (!render) return null;

  const presets = catalog.lookPresets;
  const matching = presets.find(p => presetMatches(render, p));
  const customized = !matching;
  const activeId = matching?.id ?? remembered;
  const active = presets.find(p => p.id === activeId);
  const resetTarget =
    active ?? presets.find(p => p.id === DEFAULT_LOOK) ?? presets[0];
  const baselineEdit = active
    ? resolveRenderPatch(defaultRenderSettings(), lookPatch(active))
    : null;
  const baseline = baselineEdit?.ok
    ? baselineEdit.render
    : defaultRenderSettings();

  const applyPreset = (preset: LookPreset) => {
    setRemembered(preset.id);
    editor.apply(
      t('look.apply.label', {label: preset.name}),
      lookPatch(preset),
      {
        structural: 'look-preset',
      },
    );
  };
  const request = (preset: LookPreset | undefined) => {
    if (!preset) return;
    if (customized) setPending(preset);
    else applyPreset(preset);
  };

  const pendingEdit = pending
    ? resolveRenderPatch(render, lookPatch(pending))
    : null;
  const replaced = pendingEdit?.ok
    ? changedLookGroups(render, pendingEdit.render)
    : [];

  const selectValue = activeId ?? '';
  const pickerOptions = [
    ...(activeId ? [] : [{value: '', label: t('look.preset.custom')}]),
    ...presets.map(p => ({
      value: p.id,
      label:
        p.id === activeId && customized
          ? t('look.preset.modified', {label: p.name})
          : p.name,
    })),
  ];

  return (
    <fieldset className="csg-look" disabled={editor.readOnly}>
      <legend className="csg-look__legend csg-label">{t('look.title')}</legend>
      <div className="csg-look-preset" data-focus-key="look.preset">
        <SelectField
          label={t('look.preset')}
          focusKey="look.preset.select"
          value={selectValue}
          options={pickerOptions}
          onChange={id => request(presets.find(p => p.id === id))}
        />
        {(active ?? matching) ? (
          <div className="csg-look-preset__about">
            {(active ?? matching)?.thumbnailUrl ? (
              <img
                className="csg-look-preset__thumb"
                src={(active ?? matching)?.thumbnailUrl}
                alt=""
                width={64}
                height={64}
                draggable={false}
              />
            ) : null}
            <p className="csg-look-preset__desc" id={presetId}>
              {(active ?? matching)?.description}
            </p>
          </div>
        ) : null}
        {customized && resetTarget ? (
          <Button
            small
            variant="secondary"
            title={t('look.reset.title', {label: resetTarget.name})}
            onClick={() => request(resetTarget)}
          >
            {t('look.reset')}
          </Button>
        ) : null}
      </div>
      <div
        role="group"
        aria-label={t('look.controls')}
        className="csg-look__controls"
        hidden={presetOnly}
      >
        {(presetOnly ? [] : CONTROLS).map(def => {
          const label = t(def.label);
          const value = def.get(render);
          const atBaseline = deepEqual(value, def.get(baseline));
          const common = {
            label,
            focusKey: `look.${def.id}`,
            resetDisabled: atBaseline,
            onReset: () =>
              editor.apply(
                t('look.reset.control', {label}),
                def.resetPatch
                  ? def.resetPatch(baseline)
                  : def.patch(def.get(baseline) as never),
                def.structural ? {structural: def.id} : {},
              ),
          };
          const commit = (v: string | number | boolean) =>
            editor.apply(
              t('render.apply.label', {label}),
              def.patch(v as never),
              {
                coalesceKey: `look:${def.id}`,
                ...(def.structural ? {structural: def.id} : {}),
              },
            );
          if (def.kind === 'switch') {
            return (
              <SwitchField
                key={def.id}
                {...common}
                checked={value === true}
                onChange={commit}
              />
            );
          }
          if (def.kind === 'range') {
            return (
              <RangeField
                key={def.id}
                {...common}
                value={Number(value)}
                min={def.min ?? 0}
                max={def.max ?? 1}
                step={def.step ?? 0.05}
                gestureKey={`look:${def.id}`}
                gesture={store}
                onChange={commit}
              />
            );
          }
          return (
            <SelectField
              key={def.id}
              {...common}
              value={String(value)}
              options={def.options?.(render) ?? []}
              onChange={commit}
            />
          );
        })}
      </div>
      <Dialog
        open={pending !== null}
        role="alertdialog"
        title={t('look.confirm.title')}
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t('look.confirm.cancel')}
            </Button>
            <Button
              variant="primary"
              small
              onClick={() => {
                if (pending) applyPreset(pending);
                setPending(null);
              }}
            >
              {t('look.confirm.replace')}
            </Button>
          </>
        }
      >
        <p>
          {t('look.confirm.body', {
            label: pending?.name ?? '',
            fields: replaced
              .map(g => t(`look.group.${g}` as MessageKey))
              .join(', '),
          })}
        </p>
      </Dialog>
    </fieldset>
  );
}
