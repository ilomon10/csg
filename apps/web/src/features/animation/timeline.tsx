import {t} from '../../shared/i18n';
import {useId, type KeyboardEvent, type ReactElement} from 'react';
import {Button, Icon, IconButton, announce} from '../../shared/ui';

/** Preview speeds of REQ-ANM-017. */
export const TIMELINE_SPEEDS = [0.25, 0.5, 1, 2] as const;

/** Props of {@link Timeline}. */
export interface TimelineProps {
  readonly frameCount: number;
  /** Zero-based current frame. */
  readonly frame: number;
  readonly playing: boolean;
  readonly onFrameChange: (frame: number) => void;
  readonly onPlayingChange: (playing: boolean) => void;
  readonly loop?: boolean;
  readonly onLoopChange?: (loop: boolean) => void;
  readonly speed?: number;
  readonly onSpeedChange?: (speed: number) => void;
  /** "Show export frames" (REQ-ANM-018); the toggle shows only when a handler is given. */
  readonly exportFrames?: boolean;
  readonly onExportFramesChange?: (on: boolean) => void;
}

/**
 * The dock timeline (REQ-ANM-017, REQ-UX-040): transport buttons and one cell per sampled
 * frame under a focusable slider. On the slider Space plays or pauses, Left/Right (and `,` and
 * `.`) step one frame and pause, Home/End jump to the first and last frame. Clicking a cell
 * seeks (and so does moving across cells with the button held), so no drag is required
 * (SC 2.5.7). Controlled: pair it with `useTimelinePlayback`.
 */
export function Timeline({
  frameCount,
  frame,
  playing,
  onFrameChange,
  onPlayingChange,
  loop,
  onLoopChange,
  speed = 1,
  onSpeedChange,
  exportFrames,
  onExportFramesChange,
}: TimelineProps): ReactElement {
  const id = useId();
  const count = Math.max(1, frameCount);
  const last = count - 1;
  const at = Math.min(Math.max(0, frame), last);
  const valueText = t('timeline.frame', {frame: at + 1, count});

  const seek = (next: number, speak: boolean) => {
    const clamped = Math.min(last, Math.max(0, next));
    if (clamped !== at) onFrameChange(clamped);
    if (speak) {
      announce(t('timeline.frame', {frame: clamped + 1, count}));
    }
  };
  const step = (delta: number) => {
    if (playing) onPlayingChange(false);
    seek(at + delta, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case ' ':
        onPlayingChange(!playing);
        break;
      case 'ArrowRight':
      case '.':
        step(1);
        break;
      case 'ArrowLeft':
      case ',':
        step(-1);
        break;
      case 'Home':
        seek(0, true);
        break;
      case 'End':
        seek(last, true);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="csg-tl" role="group" aria-label={t('timeline.label')}>
      <div className="csg-tl__tools">
        <Button
          small
          variant="secondary"
          aria-pressed={playing}
          onClick={() => onPlayingChange(!playing)}
        >
          <Icon name={playing ? 'pause' : 'play'} />
          {playing ? t('timeline.pause') : t('timeline.play')}
        </Button>
        <IconButton
          icon="chevron-left"
          label={t('timeline.prev')}
          onClick={() => step(-1)}
        />
        <IconButton
          icon="chevron-right"
          label={t('timeline.next')}
          onClick={() => step(1)}
        />
        {onLoopChange ? (
          <Button
            small
            variant="ghost"
            aria-pressed={loop === true}
            onClick={() => onLoopChange(!loop)}
          >
            {t('timeline.loop')}
          </Button>
        ) : null}
        {onExportFramesChange ? (
          <Button
            small
            variant="ghost"
            aria-pressed={exportFrames === true}
            onClick={() => onExportFramesChange(!exportFrames)}
          >
            {t('timeline.exportFrames')}
          </Button>
        ) : null}
        {onSpeedChange ? (
          <>
            <label className="csg-sr" htmlFor={`${id}-speed`}>
              {t('timeline.speed')}
            </label>
            <select
              id={`${id}-speed`}
              className="csg-anim-input"
              value={speed}
              onChange={e => onSpeedChange(Number(e.target.value))}
            >
              {TIMELINE_SPEEDS.map(s => (
                <option key={s} value={s}>
                  {`${s}×`}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <span className="csg-mono csg-tl__readout" aria-hidden="true">
          {t('timeline.readout', {frame: at + 1, count})}
        </span>
      </div>
      <div
        className="csg-tl__track"
        role="slider"
        tabIndex={0}
        aria-label={t('timeline.label')}
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={at + 1}
        aria-valuetext={valueText}
        style={{['--count' as string]: count, ['--at' as string]: at}}
        onKeyDown={onKeyDown}
      >
        <div className="csg-tl__cells" aria-hidden="true">
          {Array.from({length: count}, (_, i) => (
            <div
              key={i}
              className="csg-tl__cell csg-mono"
              data-frame={i}
              aria-current={i === at ? 'true' : undefined}
              onPointerDown={e => {
                e.currentTarget.parentElement?.parentElement?.focus();
                seek(i, false);
              }}
              onPointerEnter={e => {
                if (e.buttons === 1) seek(i, false);
              }}
            >
              {i + 1}
            </div>
          ))}
          <div className="csg-tl__playhead" />
        </div>
      </div>
    </div>
  );
}
