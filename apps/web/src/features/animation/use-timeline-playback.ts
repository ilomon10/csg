import {useCallback, useEffect, useState} from 'react';

/** True when the user prefers reduced motion (REQ-ANM-019). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Options of {@link useTimelinePlayback}. */
export interface TimelinePlaybackOptions {
  readonly frameCount: number;
  readonly fps: number;
  /** Speed multiplier: 0.25, 0.5, 1 or 2. */
  readonly speed?: number;
  readonly loop?: boolean;
  /** Defaults to `true` unless the user prefers reduced motion (AC-ANM-019.1). */
  readonly initialPlaying?: boolean;
}

/** State and actions of {@link useTimelinePlayback}. */
export interface TimelinePlayback {
  readonly frame: number;
  readonly playing: boolean;
  setFrame(frame: number): void;
  setPlaying(playing: boolean): void;
}

/**
 * Steps the preview frame at `fps * speed`, cycling the sampled frames (REQ-ANM-018 "Show
 * export frames"). Playback starts paused on frame 0 when the user prefers reduced motion
 * (AC-ANM-019.1). A non-looping clip pauses on its last frame. Wall-clock time only drives
 * this preview, never an export (P-04).
 */
export function useTimelinePlayback({
  frameCount,
  fps,
  speed = 1,
  loop = true,
  initialPlaying,
}: TimelinePlaybackOptions): TimelinePlayback {
  const [frame, setFrameState] = useState(0);
  const [playing, setPlayingState] = useState(
    () => initialPlaying ?? !prefersReducedMotion(),
  );
  const last = Math.max(0, frameCount - 1);
  const current = Math.min(frame, last);

  const setFrame = useCallback(
    (next: number) =>
      setFrameState(Math.min(last, Math.max(0, Math.round(next)))),
    [last],
  );

  useEffect(() => {
    if (!playing || frameCount <= 1) return undefined;
    const interval = Math.max(1, 1000 / (Math.max(1, fps) * speed));
    const timer = setInterval(() => {
      setFrameState(prev => {
        const at = Math.min(prev, last);
        if (at < last) return at + 1;
        if (loop) return 0;
        setPlayingState(false);
        return at;
      });
    }, interval);
    return () => clearInterval(timer);
  }, [playing, frameCount, fps, speed, loop, last]);

  return {frame: current, playing, setFrame, setPlaying: setPlayingState};
}
