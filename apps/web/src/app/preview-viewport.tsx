import {DIRECTION_ORDER} from '@csg/engine';
import type {ClipRef} from '@csg/parts-schema';
import {useRef} from 'react';
import {PREVIEW_CLIPS} from './default-character';
import {usePreview} from './use-preview';

/**
 * Center preview viewport (spec 009): the engine canvas, the renderer backend badge
 * (REQ-GEN-002), M1 playback controls and an inline error alert.
 */
export function PreviewViewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const {state, togglePlay, selectClip, turn, seek, dismissError} = usePreview(
    canvasRef,
    viewportRef,
  );
  const ready = state.status === 'ready';
  const direction = DIRECTION_ORDER[state.direction] ?? 'e';

  return (
    <section className="preview" aria-label="Character preview">
      <div
        className="preview-stage"
        ref={viewportRef}
        data-status={state.status}
      >
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          data-testid="preview-canvas"
          aria-label="Character preview canvas"
          role="img"
        />
        <span
          className="backend-badge"
          data-testid="renderer-badge"
          data-backend={state.backend ?? 'pending'}
          title="Renderer backend"
        >
          {state.backend === null
            ? 'Starting renderer'
            : state.backend === 'webgpu'
              ? 'WebGPU'
              : 'WebGL2'}
        </span>
        {state.status === 'loading' && (
          <p className="preview-note" role="status">
            Loading character
          </p>
        )}
        {state.error !== null && (
          <div
            className="preview-error"
            role="alert"
            data-testid="preview-error"
          >
            <span>{state.error}</span>
            {ready && (
              <button
                type="button"
                onClick={dismissError}
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
      <div
        className="preview-controls"
        role="group"
        aria-label="Preview controls"
      >
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          aria-pressed={state.playing}
          aria-label={state.playing ? 'Pause animation' : 'Play animation'}
        >
          {state.playing ? 'Pause' : 'Play'}
        </button>
        <label>
          Clip
          <select
            value={state.clip}
            disabled={!ready}
            onChange={e => selectClip(e.target.value as ClipRef)}
          >
            {PREVIEW_CLIPS.map(c => (
              <option key={c.ref} value={c.ref}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => turn(-1)}
          disabled={!ready}
          aria-label="Turn left"
        >
          &lsaquo;
        </button>
        <output aria-label="Direction" data-testid="direction">
          {direction.toUpperCase()}
        </output>
        <button
          type="button"
          onClick={() => turn(1)}
          disabled={!ready}
          aria-label="Turn right"
        >
          &rsaquo;
        </button>
        <label className="scrub">
          Time
          <input
            type="range"
            data-testid="scrubber"
            min={0}
            max={state.clipDurationSec}
            step={0.01}
            value={Math.min(state.timeSec, state.clipDurationSec)}
            disabled={!ready}
            onChange={e => seek(Number(e.target.value))}
            aria-label="Clip time in seconds"
          />
        </label>
      </div>
    </section>
  );
}
