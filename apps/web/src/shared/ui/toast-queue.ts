/** Toast model (REQ-UX-031, REQ-UX-032). Framework-free so any feature can push toasts. */

/** Tone of a toast; decides the live region and the default timeout. */
export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/** Auto-dismiss time in ms per tone (REQ-UX-031). Errors stay until dismissed. */
export const TOAST_DURATIONS: Readonly<Record<ToastTone, number | null>> = {
  info: 5000,
  success: 4000,
  warning: 8000,
  error: null,
};
/** Timeout of a toast that carries an action (e.g. Undo). */
export const TOAST_ACTION_DURATION = 10_000;
/** Identical messages pushed within this window merge into one toast with a count. */
export const TOAST_MERGE_WINDOW = 2000;
/** Maximum toasts on screen; the rest wait in the queue. */
export const TOAST_MAX_VISIBLE = 3;

/** Input of {@link ToastQueue.push}. */
export interface ToastInput {
  readonly message: string;
  readonly tone?: ToastTone;
  /** Error code shown on error toasts, e.g. `UPL_TIMEOUT`. */
  readonly code?: string;
  readonly action?: {readonly label: string; readonly onAction: () => void};
}

/** A toast in the queue. */
export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
  readonly code?: string;
  readonly action?: {readonly label: string; readonly onAction: () => void};
  /** How many identical pushes were merged (1 = none). */
  readonly count: number;
}

/** Timer and clock hooks, injectable for tests. */
export interface ToastQueueOptions {
  readonly now?: () => number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

interface Entry {
  toast: Toast;
  lastPushAt: number;
  /** Remaining ms (null = no auto dismiss). */
  remaining: number | null;
  startedAt: number | null;
  handle: unknown;
  paused: boolean;
}

/** Observable toast queue. */
export interface ToastQueue {
  /** Adds a toast (or merges into an identical recent one) and returns its id. */
  push(input: ToastInput): number;
  dismiss(id: number): void;
  /** Pauses the timer of a visible toast (hover or focus). */
  pause(id: number): void;
  resume(id: number): void;
  /** Toasts on screen (at most {@link TOAST_MAX_VISIBLE}). */
  visible(): readonly Toast[];
  /** Number of toasts waiting. */
  queued(): number;
  subscribe(listener: () => void): () => void;
  /** Stable snapshot for `useSyncExternalStore`; a new array each change. */
  getSnapshot(): readonly Toast[];
}

/** Creates a toast queue. The app uses the shared {@link toastQueue}. */
export function createToastQueue(options: ToastQueueOptions = {}): ToastQueue {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let nextId = 1;
  const entries: Entry[] = [];
  const listeners = new Set<() => void>();
  let snapshot: readonly Toast[] = [];

  const emit = () => {
    snapshot = entries.slice(0, TOAST_MAX_VISIBLE).map(e => e.toast);
    for (const l of listeners) l();
  };

  const duration = (t: Toast): number | null =>
    t.tone === 'error'
      ? null
      : t.action
        ? TOAST_ACTION_DURATION
        : TOAST_DURATIONS[t.tone];

  const stop = (e: Entry) => {
    if (e.handle !== null) clearTimer(e.handle);
    e.handle = null;
    if (e.startedAt !== null && e.remaining !== null) {
      e.remaining = Math.max(0, e.remaining - (now() - e.startedAt));
    }
    e.startedAt = null;
  };

  const start = (e: Entry) => {
    if (e.remaining === null || e.paused || e.handle !== null) return;
    e.startedAt = now();
    e.handle = setTimer(() => {
      e.handle = null;
      remove(e.toast.id);
    }, e.remaining);
  };

  const startVisible = () => {
    for (const e of entries.slice(0, TOAST_MAX_VISIBLE)) start(e);
  };

  function remove(id: number) {
    const i = entries.findIndex(e => e.toast.id === id);
    if (i < 0) return;
    const [e] = entries.splice(i, 1);
    if (e) stop(e);
    startVisible();
    emit();
  }

  return {
    push(input) {
      const tone = input.tone ?? 'info';
      const t = now();
      const dup = entries.find(
        e =>
          e.toast.message === input.message &&
          e.toast.tone === tone &&
          e.toast.code === input.code &&
          t - e.lastPushAt <= TOAST_MERGE_WINDOW,
      );
      if (dup) {
        dup.toast = {...dup.toast, count: dup.toast.count + 1};
        dup.lastPushAt = t;
        stop(dup);
        dup.remaining = duration(dup.toast);
        startVisible();
        emit();
        return dup.toast.id;
      }
      const toast: Toast = {
        id: nextId++,
        message: input.message,
        tone,
        code: input.code,
        action: input.action,
        count: 1,
      };
      entries.push({
        toast,
        lastPushAt: t,
        remaining: duration(toast),
        startedAt: null,
        handle: null,
        paused: false,
      });
      startVisible();
      emit();
      return toast.id;
    },
    dismiss: remove,
    pause(id) {
      const e = entries.find(x => x.toast.id === id);
      if (!e) return;
      e.paused = true;
      stop(e);
    },
    resume(id) {
      const e = entries.find(x => x.toast.id === id);
      if (!e) return;
      e.paused = false;
      start(e);
    },
    visible: () => snapshot,
    queued: () => Math.max(0, entries.length - TOAST_MAX_VISIBLE),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
  };
}

/** The app-wide toast queue rendered by `ToastRegion`. */
export const toastQueue: ToastQueue = createToastQueue();
