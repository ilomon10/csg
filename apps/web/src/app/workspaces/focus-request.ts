import type {UiPrefs} from '../../shared/persistence';

/** Inspector tab names (REQ-UX-004). */
export type InspectorTab = UiPrefs['inspectorTab'];

/** Where "Edit in Pro" lands (REQ-UX-055): an inspector tab and the control to focus. */
export interface FocusRequest {
  readonly tab: InspectorTab;
  /** `data-focus-key` of the control, for anatomy and parts. */
  readonly focusKey?: string;
  /** Tint channel whose Colors-tab control is focused. */
  readonly channel?: string;
}

/** Maps a document field (`parts.hair`, `tints.hair`, `anatomy…`) to its Pro control. */
export function focusRequestForField(field: string): FocusRequest {
  if (field.startsWith('tints.')) {
    return {tab: 'colors', channel: field.slice('tints.'.length)};
  }
  if (field.startsWith('parts.')) {
    return {tab: 'parts', focusKey: field};
  }
  return {tab: 'anatomy', focusKey: 'anatomy.preset'};
}

let pending: FocusRequest | null = null;

/** Queues a hand-off for the Pro workspace to pick up once it is mounted. */
export function queueFocusRequest(request: FocusRequest): void {
  pending = request;
}

/** The queued hand-off, if any. Read in render; {@link clearFocusRequest} consumes it (StrictMode-safe). */
export function peekFocusRequest(): FocusRequest | null {
  return pending;
}

/** Drops the queued hand-off once the Pro workspace acted on it. */
export function clearFocusRequest(): void {
  pending = null;
}

const FOCUSABLE =
  'input:not([disabled]),select:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Focuses the control marked `data-focus-key="key"` under `root`: the element itself when it
 * is focusable, else its first focusable descendant (the wrapper of a composite control).
 */
export function focusByKey(root: ParentNode, key: string): boolean {
  const holder = Array.from(
    root.querySelectorAll<HTMLElement>('[data-focus-key]'),
  ).find(el => el.dataset['focusKey'] === key);
  if (holder === undefined) return false;
  const target = holder.matches(FOCUSABLE)
    ? holder
    : holder.querySelector<HTMLElement>(FOCUSABLE);
  if (target === null) return false;
  target.focus();
  return true;
}
