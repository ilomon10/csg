import {useSyncExternalStore, type ReactElement} from 'react';
import {IconButton} from './button';
import type {Toast, ToastQueue} from './toast-queue';
import {toastQueue} from './toast-queue';

const TONE_LABEL: Record<Toast['tone'], string> = {
  info: 'Info',
  success: 'Done',
  warning: 'Warning',
  error: 'Error',
};

/** Props of {@link ToastRegion}. */
export interface ToastRegionProps {
  /** Defaults to the shared {@link toastQueue}. */
  readonly queue?: ToastQueue;
  /** Id of the region element, for the shell's F6 cycling (it focuses `#<id>`). */
  readonly id?: string;
}

function ToastItem({
  toast,
  queue,
}: {
  toast: Toast;
  queue: ToastQueue;
}): ReactElement {
  return (
    <div
      className="csg-toast"
      data-tone={toast.tone}
      onMouseEnter={() => queue.pause(toast.id)}
      onMouseLeave={() => queue.resume(toast.id)}
      onFocus={() => queue.pause(toast.id)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) queue.resume(toast.id);
      }}
    >
      <div className="csg-toast__msg">
        {/* Tone is spoken and visible as text, never color alone. */}
        <span className="csg-toast__tone">{TONE_LABEL[toast.tone]}:</span>
        {toast.message}
        {toast.code ? (
          <code className="csg-toast__code">{toast.code}</code>
        ) : null}
        {toast.count > 1 ? (
          <span className="csg-toast__count">×{toast.count}</span>
        ) : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          className="csg-btn csg-btn--ghost"
          onClick={() => {
            toast.action?.onAction();
            queue.dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <IconButton
        icon="x"
        label="Dismiss notification"
        onClick={() => queue.dismiss(toast.id)}
      />
    </div>
  );
}

/**
 * Fixed toast region (REQ-UX-031/032): at most 3 visible, polite live region for
 * info/success/warning and assertive for errors, never moves focus. The container is
 * focusable (`tabIndex=-1`) so the shell's F6 cycle can land on it; every action inside is
 * in the tab order. Position it with `--toast-inset-bottom` / `--toast-inset-x`.
 */
export function ToastRegion({
  queue = toastQueue,
  id,
}: ToastRegionProps): ReactElement {
  const toasts = useSyncExternalStore(
    queue.subscribe,
    queue.getSnapshot,
    queue.getSnapshot,
  );
  const calm = toasts.filter(t => t.tone !== 'error');
  const errors = toasts.filter(t => t.tone === 'error');
  return (
    <div
      id={id}
      className="csg-toasts"
      tabIndex={-1}
      aria-label="Notifications"
      role="region"
    >
      <div
        role="status"
        aria-live="polite"
        aria-relevant="additions text"
        style={{display: 'contents'}}
      >
        {calm.map(t => (
          <ToastItem key={t.id} toast={t} queue={queue} />
        ))}
      </div>
      <div role="alert" aria-live="assertive" style={{display: 'contents'}}>
        {errors.map(t => (
          <ToastItem key={t.id} toast={t} queue={queue} />
        ))}
      </div>
    </div>
  );
}
