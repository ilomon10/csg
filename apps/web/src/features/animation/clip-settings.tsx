import {t} from '../../shared/i18n';
import {useId, type ReactElement} from 'react';
import type {AnimationSelection} from '@csg/parts-schema';
import {
  LABEL_PATTERN,
  parseFps,
  parseFrames,
  parseRange,
  playbackSpeed,
  defaultFps,
} from './animation-model';
import type {Parsed, PanelClip} from './animation-model';
import {CommitField} from './commit-field';

type Patch = {
  [K in keyof AnimationSelection]?: AnimationSelection[K] | undefined;
};

/** Props of {@link ClipSettings}. */
export interface ClipSettingsProps {
  readonly selection: AnimationSelection;
  /** Null when the clip is not in the catalog (settings stay editable except range). */
  readonly clip: PanelClip | null;
  /** Labels of the other entries (uniqueness, REQ-ANM-006). */
  readonly otherLabels: ReadonlySet<string>;
  readonly onPatch: (patch: Patch) => void;
}

const message = <T,>(result: Parsed<T>): string | null =>
  result.ok ? null : t(result.error);

/**
 * Per-clip settings (REQ-ANM-004, 005, 009): label, frames 1-64, fps 1-60, loop, ping-pong,
 * timing and range. Invalid input is rejected with its message and the previous value kept.
 */
export function ClipSettings({
  selection,
  clip,
  otherLabels,
  onPatch,
}: ClipSettingsProps): ReactElement {
  const id = useId();
  const duration = clip?.durationSec;
  const timing = selection.timing ?? 'fit';
  const speedShown =
    timing === 'fit' &&
    duration !== undefined &&
    selection.fps !==
      defaultFps(
        selection.frameCount,
        selection.range
          ? selection.range.endSec - selection.range.startSec
          : duration,
      );
  const range = selection.range;
  const applyRange = (start: string, end: string): string | null => {
    if (duration === undefined) return null;
    const parsed = parseRange(start, end, duration);
    if (!parsed.ok) {
      return parsed.error === 'animation.error.rangeBounds'
        ? t(parsed.error, {max: duration.toFixed(2)})
        : t(parsed.error);
    }
    onPatch({range: parsed.value});
    return null;
  };
  return (
    <div className="csg-anim-settings">
      <CommitField
        label={t('animation.field.label')}
        value={selection.label}
        onCommit={text => {
          if (!LABEL_PATTERN.test(text))
            return t('animation.error.labelFormat');
          if (otherLabels.has(text)) return t('animation.error.labelUnique');
          onPatch({label: text});
          return null;
        }}
      />
      <CommitField
        label={t('animation.field.frames')}
        type="number"
        step={1}
        value={String(selection.frameCount)}
        onCommit={text => {
          const parsed = parseFrames(text);
          if (parsed.ok) onPatch({frameCount: parsed.value});
          return message(parsed);
        }}
      />
      <CommitField
        label={t('animation.field.fps')}
        type="number"
        step={1}
        value={String(selection.fps)}
        onCommit={text => {
          const parsed = parseFps(text);
          if (parsed.ok) onPatch({fps: parsed.value});
          return message(parsed);
        }}
      />
      {speedShown && duration !== undefined ? (
        <p className="csg-anim-note csg-mono" role="status">
          {t('animation.speed', {
            speed: playbackSpeed(selection, duration).toFixed(1),
          })}
        </p>
      ) : null}
      <div className="csg-anim-field">
        <label htmlFor={`${id}-timing`}>{t('animation.field.timing')}</label>
        <select
          id={`${id}-timing`}
          className="csg-anim-input"
          value={timing}
          onChange={e =>
            onPatch({timing: e.target.value === 'fit' ? 'fit' : 'fixed-fps'})
          }
        >
          <option value="fit">{t('animation.timing.fit')}</option>
          <option value="fixed-fps">{t('animation.timing.fixed-fps')}</option>
        </select>
      </div>
      <label className="csg-anim-check">
        <input
          type="checkbox"
          checked={selection.loop}
          onChange={e => onPatch({loop: e.target.checked})}
        />
        {t('animation.field.loop')}
      </label>
      <label className="csg-anim-check">
        <input
          type="checkbox"
          checked={selection.pingPong === true}
          onChange={e =>
            onPatch({
              pingPong: e.target.checked ? true : undefined,
              ...(e.target.checked ? {} : {bakePingPong: undefined}),
            })
          }
        />
        {t('animation.field.pingPong')}
      </label>
      {duration !== undefined ? (
        <div className="csg-anim-range">
          <CommitField
            label={t('animation.field.rangeStart')}
            type="number"
            step={0.01}
            value={range ? String(range.startSec) : ''}
            placeholder="0"
            onCommit={text =>
              applyRange(text, range ? String(range.endSec) : '')
            }
          />
          <CommitField
            label={t('animation.field.rangeEnd')}
            type="number"
            step={0.01}
            value={range ? String(range.endSec) : ''}
            placeholder={duration.toFixed(2)}
            onCommit={text =>
              applyRange(range ? String(range.startSec) : '', text)
            }
          />
        </div>
      ) : null}
    </div>
  );
}
