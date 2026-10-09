import {DIRECTION_ORDER} from '@csg/parts-schema';
import type {RenderSettings} from '@csg/parts-schema';
import {useId, useRef} from 'react';
import type {KeyboardEvent, PointerEvent, ReactElement} from 'react';
import type {CharacterTarget} from '../../shared/document';
import {
  Button,
  IconButton,
  SegmentedControl,
  announce,
  type Segment,
} from '../../shared/ui';
import {useViewport} from '../../shared/viewport';
import type {ViewportStore} from '../../shared/viewport';
import {IDLE_CLIP, WALK_CLIP} from './default-character';
import {engineHost} from './engine-host';
import type {EngineHost} from './engine-host';
import type {PartLoadStore} from './part-load-store';
import {sharedViewportStore} from './shared-viewport-store';
import {RESTARTING_TEXT, useCharacterViewport} from './use-character-viewport';
import type {ViewportNotice} from './use-character-viewport';
import {clipName, facingAnnouncement} from './viewport-summary';
import './viewport.css';

/** One direction step per this many CSS pixels of horizontal drag (REQ-UX-058). */
export const DRAG_STEP_PX = 48;

/** Degrees of orbit per CSS pixel of drag in 3D mode (REQ-UX-003). */
export const ORBIT_DEG_PER_PX = 0.5;

/** Props of {@link CharacterViewport}. */
export interface CharacterViewportProps {
  /** The project character, or the wizard draft. */
  readonly target: CharacterTarget;
  /** The render settings: the project's, or the wizard's defaults. */
  readonly render: () => RenderSettings;
  /** Accessible name; the live summary of REQ-UX-039 is built from it. */
  readonly label: string;
  /** Easy and Pro show the Pixel/3D toggle; the wizard does not (REQ-UX-097). */
  readonly variant: 'easy' | 'pro' | 'wizard';
  /** Preset thumbnail shown until the live preview is ready (REQ-UX-097). */
  readonly placeholderUrl?: string;
  readonly onNotice?: (notice: ViewportNotice) => void;
  /** The renderer backend once the renderer exists (the shell's badge, REQ-GEN-002). */
  readonly onBackend?: (backend: 'webgpu' | 'webgl2') => void;
  /** See `UseCharacterViewportInput.onFramePresented`. */
  readonly onFramePresented?: () => void;
  /** Viewport state; default is the store shared by Easy and Pro (REQ-UX-051). */
  readonly store?: ViewportStore;
  /** Engine host; default is the editor's. */
  readonly host?: EngineHost;
  /** Where busy part refs are reported; default is the shared store (REQ-UX-067). */
  readonly partLoads?: PartLoadStore;
}

const MODE_SEGMENTS: readonly Segment[] = [
  {id: 'pixel', label: 'Pixel'},
  {id: '3d', label: '3D'},
];

/**
 * The character viewport (spec 009 REQ-UX-003, 039; spec 014 REQ-UX-057 to 059): the engine
 * canvas in Pixel mode at the largest integer zoom that fits, turned in 45 degree steps by
 * drag, arrow keys or labelled buttons, with Pixel/3D and Idle/Walk toggles and a live text
 * summary. 3D mode is offered once the engine supports it (M3-05).
 */
export function CharacterViewport({
  target,
  render,
  label,
  variant,
  placeholderUrl,
  onNotice,
  onBackend,
  onFramePresented,
  store = sharedViewportStore,
  host = engineHost,
  partLoads,
}: CharacterViewportProps): ReactElement {
  const view = useCharacterViewport({
    target,
    render,
    label,
    store,
    host,
    ...(partLoads ? {partLoads} : {}),
    onNotice,
    onBackend,
    ...(onFramePresented ? {onFramePresented} : {}),
  });
  const summaryId = useId();
  const clip = useViewport(store, s => s.previewClip);
  const mode = useViewport(store, s => s.mode);
  const playing = useViewport(store, s => s.playing);
  const direction = useViewport(store, s => s.direction);
  const drag = useRef<{
    startX: number;
    lastX: number;
    lastY: number;
    applied: number;
  } | null>(null);
  const ready = view.status === 'ready';
  const pro = variant === 'pro';
  const showMode = variant !== 'wizard';
  const clipId = clip === IDLE_CLIP ? 'idle' : clip === WALK_CLIP ? 'walk' : '';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case ']':
        view.turn(1);
        break;
      case 'ArrowLeft':
      case '[':
        view.turn(-1);
        break;
      case 'v':
      case 'V':
        if (showMode && view.canThreeD) store.toggleMode();
        else handled = false;
        break;
      case '+':
      case '=':
        if (pro) view.zoomBy(1);
        else handled = false;
        break;
      case '-':
        if (pro) view.zoomBy(-1);
        else handled = false;
        break;
      case 'f':
      case 'F':
        if (showMode && view.effectiveMode === '3d') view.frameCharacter();
        else handled = false;
        break;
      case ' ':
        if (pro) store.togglePlaying();
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      // The viewport owns these keys while focused; the global dispatcher must not repeat them.
      e.stopPropagation();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    drag.current = {
      startX: e.clientX,
      lastX: e.clientX,
      lastY: e.clientY,
      applied: 0,
    };
    e.currentTarget.setAttribute('data-dragging', 'true');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null) return;
    if (view.effectiveMode === '3d') {
      // Orbit: dragging right swings the camera left, so the character appears to turn with
      // the pointer; dragging down raises the camera. Never recorded in history (REQ-UX-024).
      view.orbit(
        -(e.clientX - d.lastX) * ORBIT_DEG_PER_PX,
        (e.clientY - d.lastY) * ORBIT_DEG_PER_PX,
      );
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      return;
    }
    const steps = Math.trunc((e.clientX - d.startX) / DRAG_STEP_PX);
    if (steps !== d.applied) {
      store.stepDirection(steps - d.applied);
      d.applied = steps;
    }
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.removeAttribute('data-dragging');
    if (d !== null && d.applied !== 0) {
      announce(facingAnnouncement(store.getState().direction));
    }
  };

  const modeSegments: readonly Segment[] = MODE_SEGMENTS.map(s =>
    s.id === '3d' && !view.canThreeD ? {...s, disabled: true} : s,
  );

  return (
    <section
      className="cv"
      aria-label={`${label} preview`}
      data-variant={variant}
    >
      <div
        ref={view.stageRef}
        className="cv__stage"
        data-testid="viewport-stage"
        data-status={view.status}
        data-view={view.effectiveMode}
        data-zoom={view.zoom}
        data-lut-worker-builds={view.lutStats.workerBuilds}
        data-lut-main-builds={view.lutStats.mainThreadBuilds}
        data-lut-failures={view.lutStats.failures}
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={summaryId}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {placeholderUrl !== undefined && !ready && (
          <img
            className="cv__placeholder"
            src={placeholderUrl}
            alt=""
            draggable={false}
          />
        )}
        {view.status === 'loading' && (
          <p
            className="cv__note"
            role="status"
            data-testid={view.restarting ? 'renderer-restarting' : undefined}
          >
            {view.restarting ? RESTARTING_TEXT : 'Loading character'}
          </p>
        )}
        {view.notice !== null && (
          <p
            className="cv__notice"
            role="status"
            data-testid="viewport-notice"
            data-code={view.notice.code}
          >
            {view.notice.message}
          </p>
        )}
        {view.error !== null && (
          <div className="cv__error" role="alert" data-testid="preview-error">
            <span>{view.error}</span>
            {ready && view.errorCode === 'PIX_PREVIEW_FAILED' && (
              <button
                type="button"
                onClick={view.resume}
                aria-label="Resume preview"
                data-testid="preview-resume"
              >
                Resume
              </button>
            )}
            {ready && (
              <button
                type="button"
                onClick={view.dismissError}
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
      <p
        id={summaryId}
        className="csg-sr"
        role="status"
        aria-live="polite"
        data-testid="viewport-summary"
      >
        {view.summary}
      </p>
      <div
        className="cv__toolbar"
        role="group"
        aria-label={`${label} preview controls`}
      >
        <div className="cv__group">
          <IconButton
            icon="chevron-left"
            label="Turn left"
            disabled={!ready}
            onClick={() => view.turn(-1)}
            data-testid="turn-left"
          />
          <output
            className="cv__readout"
            aria-label="Direction"
            data-testid="direction"
          >
            {(DIRECTION_ORDER[direction] ?? 's').toUpperCase()}
          </output>
          <IconButton
            icon="chevron-right"
            label="Turn right"
            disabled={!ready}
            onClick={() => view.turn(1)}
            data-testid="turn-right"
          />
        </div>
        {showMode && (
          <SegmentedControl
            mode="pressed"
            label="View mode"
            segments={modeSegments}
            value={mode === '3d' && view.canThreeD ? '3d' : 'pixel'}
            onChange={id => store.setMode(id === '3d' ? '3d' : 'pixel')}
          />
        )}
        <div className="cv__group">
          <SegmentedControl
            mode="pressed"
            label="Animation"
            segments={[
              {id: 'idle', label: 'Idle'},
              {id: 'walk', label: 'Walk'},
            ]}
            value={clipId}
            onChange={id =>
              store.setPreviewClip(id === 'walk' ? WALK_CLIP : IDLE_CLIP)
            }
          />
          {clipId === '' && (
            <span className="cv__clip-name" data-testid="clip-name">
              {clipName(clip)}
            </span>
          )}
        </div>
        {pro && (
          <div className="cv__group">
            <Button
              small
              aria-label="Zoom out"
              disabled={!ready || view.zoom <= 1}
              onClick={() => view.zoomBy(-1)}
            >
              &minus;
            </Button>
            <output
              className="cv__readout"
              aria-label="Zoom"
              data-testid="zoom"
            >
              {view.zoom}&times;
            </output>
            <Button
              small
              aria-label="Zoom in"
              disabled={!ready || view.zoom >= view.fitZoom}
              onClick={() => view.zoomBy(1)}
            >
              +
            </Button>
            <Button
              small
              disabled={!ready}
              onClick={() => store.setZoom('fit')}
            >
              Fit
            </Button>
            <Button
              small
              aria-label="Play or pause animation"
              aria-pressed={playing}
              disabled={!ready}
              onClick={() => store.togglePlaying()}
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
          </div>
        )}
        {showMode && view.canThreeD && (
          <Button
            small
            aria-label="Frame character"
            aria-keyshortcuts="F"
            disabled={!ready || view.effectiveMode !== '3d'}
            onClick={() => view.frameCharacter()}
          >
            Frame
          </Button>
        )}
        {showMode && !view.canThreeD && (
          <span className="cv__hint">3D view is not available yet.</span>
        )}
      </div>
    </section>
  );
}
