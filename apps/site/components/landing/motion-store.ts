'use client';
import {useSyncExternalStore} from 'react';

// One switch for every landing animation (WCAG 2.2.2, REQ-WEB-021) plus the
// OS reduced-motion preference (REQ-WEB-022). The paused choice persists in
// localStorage under a single key (REQ-WEB-040 allows it).

const KEY = 'csg-motion-paused';
const listeners = new Set<() => void>();
let paused: boolean | null = null;

function readPaused(): boolean {
  if (paused === null) {
    try {
      paused = window.localStorage.getItem(KEY) === '1';
    } catch {
      paused = false;
    }
    document.documentElement.dataset['motion'] = paused ? 'paused' : 'running';
  }
  return paused;
}

/** Pauses or resumes every landing animation. */
export function setMotionPaused(value: boolean): void {
  paused = value;
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // Storage can be blocked; the choice then lasts for this page view.
  }
  document.documentElement.dataset['motion'] = value ? 'paused' : 'running';
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True when the user paused animations. */
export function useMotionPaused(): boolean {
  return useSyncExternalStore(subscribe, readPaused, () => false);
}

function subscribeReduced(listener: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}

/** True when the OS asks for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}
