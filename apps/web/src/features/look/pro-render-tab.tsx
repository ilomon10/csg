import {t} from '../../shared/i18n';
import type {MessageKey} from '../../shared/i18n';
import {useState, type ReactElement} from 'react';
import type {RenderSettings} from '@csg/parts-schema';
import type {DocumentStore} from '../../shared/document';
import {
  NumberField,
  RangeField,
  SelectField,
  SwitchField,
  TextField,
} from './fields';
import type {RenderIssue} from './render-model';
import type {StructuralTiming} from './structural-timing';
import {useRenderEditor} from './use-render-editor';
import './look.css';

/** Props of {@link ProRenderTab}. */
export interface ProRenderTabProps {
  readonly store: DocumentStore;
  /** Measures structural changes until they show (budget 300 ms); omit to skip. */
  readonly timing?: StructuralTiming;
}

const CAMERAS = ['side', 'three-quarter', 'isometric'] as const;
const PALETTES = ['none', 'pico-8', 'endesga-32'] as const;
const DITHERS = ['none', 'bayer2', 'bayer4', 'bayer8'] as const;
const DIRECTIONS = ['1', '2', '4', '8'] as const;
const BANDS = ['2', '3', '4'] as const;
const WIDTHS = ['1', '2', '3'] as const;

const option = (key: string) => ({
  value: key.slice(key.lastIndexOf('.') + 1),
  label: t(key as MessageKey),
});

const hasPrefix = (issue: RenderIssue, prefixes: readonly string[]) =>
  prefixes.some(p => issue.path === p || issue.path.startsWith(`${p}.`));

/**
 * The Pro Render inspector tab (spec 003, REQ-EDT-034): resolution, camera, directions,
 * palette, dither, outline and toon. Every change is one `render` command; an invalid value is
 * not applied and its RenderSettings field errors (path and code, REQ-PIX-037) show next to the
 * control. Structural changes report their time to show through `timing`.
 */
export function ProRenderTab({
  store,
  timing,
}: ProRenderTabProps): ReactElement | null {
  const editor = useRenderEditor(store, timing);
  const [customPending, setCustomPending] = useState(false);
  const render: RenderSettings | null = editor.render;
  if (!render) return null;

  const forControl = (...prefixes: string[]) =>
    editor.issues.filter(i => hasPrefix(i, prefixes));
  const claimed = [
    'resolution',
    'camera',
    'directions',
    'singleFacing',
    'palette',
    'outline.outer',
    'toon',
  ];
  const general = editor.issues.filter(i => !hasPrefix(i, claimed));
  const change = (
    label: MessageKey,
    kind: string | null,
    patch: Record<string, unknown>,
  ) =>
    editor.apply(
      t('render.apply.label', {label: t(label)}),
      patch,
      kind === null ? {} : {structural: kind},
    );

  const paletteId = customPending ? 'custom' : render.palette.id;
  const cameraOptions = [
    ...CAMERAS,
    ...(render.camera.preset === 'custom' ? ['custom' as const] : []),
  ];
  const paletteOptions = [...PALETTES, 'custom' as const];

  return (
    <fieldset className="csg-look" disabled={editor.readOnly}>
      <legend className="csg-look__legend csg-label">
        {t('render.title')}
      </legend>
      {general.length > 0 ? (
        <div className="csg-look-field__errors" role="alert">
          {general.map(e => (
            <p key={`${e.path}:${e.code}`}>
              {t('render.error', {
                code: e.code,
                message: `${e.path}: ${e.message}`,
              })}
            </p>
          ))}
        </div>
      ) : null}
      <NumberField
        label={`${t('render.resolution')}: ${t('render.width')}`}
        focusKey="render.resolution"
        value={render.resolution.width}
        min={32}
        max={128}
        errors={forControl('resolution.width', 'resolution')}
        onCommit={width =>
          change('render.resolution', 'resolution', {resolution: {width}})
        }
      />
      <NumberField
        label={`${t('render.resolution')}: ${t('render.height')}`}
        focusKey="render.resolution.height"
        value={render.resolution.height}
        min={32}
        max={128}
        errors={forControl('resolution.height')}
        onCommit={height =>
          change('render.resolution', 'resolution', {resolution: {height}})
        }
      />
      <SelectField
        label={t('render.camera')}
        focusKey="render.camera"
        value={render.camera.preset}
        options={cameraOptions.map(c => option(`render.camera.${c}`))}
        errors={forControl('camera')}
        onChange={preset =>
          change('render.camera', 'camera', {camera: {preset}})
        }
      />
      <SelectField
        label={t('render.directions')}
        focusKey="render.directions"
        value={String(render.directions)}
        options={DIRECTIONS.map(d => ({value: d, label: d}))}
        errors={forControl('directions', 'singleFacing')}
        onChange={d =>
          change('render.directions', 'directions', {directions: Number(d)})
        }
      />
      <SelectField
        label={t('render.palette')}
        focusKey="render.palette"
        value={paletteId}
        options={paletteOptions.map(p => option(`render.palette.${p}`))}
        errors={forControl('palette.id', 'palette.metric')}
        onChange={id => {
          if (id === 'custom') {
            if (render.palette.id !== 'custom') setCustomPending(true);
            return;
          }
          setCustomPending(false);
          change('render.palette', 'palette', {palette: {id}});
        }}
      />
      {paletteId === 'custom' ? (
        <TextField
          label={t('render.paletteColors')}
          focusKey="render.paletteColors"
          hint={t('render.paletteColorsHint')}
          value={(render.palette.colors ?? []).join(' ')}
          errors={forControl('palette.colors')}
          onCommit={text => {
            const colors = text.split(/[\s,]+/).filter(Boolean);
            const issues = change('render.palette', 'palette', {
              palette: {id: 'custom', colors},
            });
            if (issues.length === 0) setCustomPending(false);
            return issues;
          }}
        />
      ) : null}
      <SelectField
        label={t('render.dither')}
        focusKey="render.dither"
        value={render.palette.dither.mode}
        options={DITHERS.map(d => option(`render.dither.${d}`))}
        errors={forControl('palette.dither')}
        onChange={mode =>
          change('render.dither', 'dither', {palette: {dither: {mode}}})
        }
      />
      <SwitchField
        label={t('render.outline')}
        focusKey="render.outline"
        checked={render.outline.outer.enabled}
        errors={forControl('outline.outer')}
        onChange={enabled =>
          change('render.outline', 'outline', {outline: {outer: {enabled}}})
        }
      />
      <SelectField
        label={t('render.outlineWidth')}
        focusKey="render.outlineWidth"
        value={String(render.outline.outer.widthPx)}
        options={WIDTHS.map(w => ({value: w, label: `${w} px`}))}
        onChange={w =>
          change('render.outlineWidth', 'outline', {
            outline: {outer: {widthPx: Number(w)}},
          })
        }
      />
      <SelectField
        label={t('render.toon')}
        focusKey="render.toon"
        value={String(render.toon.bands)}
        options={BANDS.map(b => ({value: b, label: b}))}
        errors={forControl('toon')}
        onChange={b =>
          change('render.toon', 'toon', {toon: {bands: Number(b)}})
        }
      />
      <SwitchField
        label={t('render.rim')}
        focusKey="render.rim"
        checked={render.toon.rim.enabled}
        onChange={enabled =>
          change('render.rim', 'toon', {toon: {rim: {enabled}}})
        }
      />
      <SwitchField
        label={t('look.control.innerLines')}
        focusKey="render.innerLines"
        checked={render.outline.inner.enabled}
        onChange={enabled =>
          change('look.control.innerLines', 'outline', {
            outline: {inner: {enabled}},
          })
        }
      />
      <RangeField
        label={t('look.control.rimStrength')}
        focusKey="render.rimStrength"
        value={render.toon.rim.strength}
        min={0}
        max={1}
        step={0.05}
        gestureKey="render:rimStrength"
        gesture={store}
        onChange={strength =>
          change('look.control.rimStrength', null, {
            toon: {rim: {strength}},
          })
        }
      />
      <RangeField
        label={t('look.control.ditherStrength')}
        focusKey="render.ditherStrength"
        value={render.palette.dither.strength}
        min={0}
        max={1}
        step={0.05}
        gestureKey="render:ditherStrength"
        gesture={store}
        onChange={strength =>
          change('look.control.ditherStrength', null, {
            palette: {dither: {strength}},
          })
        }
      />
      <RangeField
        label={t('look.control.ambient')}
        focusKey="render.ambient"
        value={render.lighting.ambient}
        min={0}
        max={1}
        step={0.05}
        gestureKey="render:ambient"
        gesture={store}
        onChange={ambient =>
          change('look.control.ambient', null, {lighting: {ambient}})
        }
      />
    </fieldset>
  );
}
