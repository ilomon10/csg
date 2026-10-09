import {DIRECTION_ORDER} from '@csg/parts-schema';
import type {ClipRef} from '@csg/parts-schema';
import {useRef} from 'react';
import {PREVIEW_CLIPS} from './default-character';
import './viewport.css';
import {PREVIEW_PALETTES, usePreview} from './use-preview';
import type {PreviewPalette} from './use-preview';

/**
 * Center preview viewport (spec 009): the engine canvas, the renderer backend badge
 * (REQ-GEN-002), M1 playback controls and an inline error alert.
 */
export function PreviewViewport() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const {
    state,
    togglePlay,
    selectClip,
    turn,
    seek,
    setShowExportFrames,
    selectPalette,
    setViewMode,
    dismissError,
    resumeAfterFailure,
  } = usePreview(viewportRef);
  const ready = state.status === 'ready';
  const direction = DIRECTION_ORDER[state.direction] ?? 'e';

  return (
    <section className="preview" aria-label="Character preview">
      <div
        className="preview-stage"
        ref={viewportRef}
        data-status={state.status}
        data-view={state.viewMode}
        data-lut-worker-builds={state.lutStats?.workerBuilds ?? 0}
        data-lut-main-builds={state.lutStats?.mainThreadBuilds ?? 0}
        data-lut-failures={state.lutStats?.failures ?? 0}
      >
        {/* The engine canvas is inserted here by usePreview (a fresh element per session). */}
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
            {ready && state.errorCode === 'PIX_PREVIEW_FAILED' && (
              <button
                type="button"
                onClick={resumeAfterFailure}
                aria-label="Resume preview"
                data-testid="preview-resume"
              >
                Resume
              </button>
            )}
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
            data-testid="clip-select"
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
        <label>
          Palette
          <select
            data-testid="palette-select"
            value={state.palette}
            disabled={!ready}
            onChange={e => selectPalette(e.target.value as PreviewPalette)}
          >
            {PREVIEW_PALETTES.map(id => (
              <option key={id} value={id}>
                {id}
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
        <button
          type="button"
          data-testid="view-mode"
          aria-pressed={state.viewMode === '3d'}
          disabled={!ready}
          onClick={() => setViewMode(state.viewMode === '3d' ? 'pixel' : '3d')}
        >
          3D view
        </button>
        <label>
          <input
            type="checkbox"
            data-testid="show-export-frames"
            checked={state.showExportFrames}
            disabled={!ready}
            onChange={e => setShowExportFrames(e.target.checked)}
          />{' '}
          Show export frames
        </label>
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
