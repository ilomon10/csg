import {useSyncExternalStore} from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Opens the export dialog. Call it from the top bar Export button, the Easy bottom bar, the home
 * overflow menu and the command palette; a mounted `ExportDialog` reacts (REQ-UX-025 flows).
 */
export function openExport(): void {
  if (open) return;
  open = true;
  emit();
}

/** Closes the dialog; a running export is cancelled by the dialog first. */
export function closeExport(): void {
  if (!open) return;
  open = false;
  emit();
}

/** True while the dialog is open. */
export function useExportOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  );
}
