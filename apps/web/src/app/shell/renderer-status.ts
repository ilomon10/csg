import {createMiniStore} from './mini-store';
import type {MiniStore} from './mini-store';

/** Backends the badge can show (REQ-UX-042). */
export type RendererBackend = 'webgpu' | 'webgl2' | 'none';

/** What the viewport reports to the shell. Never carries project content. */
export interface RendererStatus {
  readonly backend: RendererBackend | null;
  readonly threeVersion: string;
  readonly adapter: string | null;
}

/** Number of error codes the diagnostics keep (REQ-UX-042). */
export const ERROR_LOG_LIMIT = 20;

/** Renderer status and the recent error codes shown in diagnostics. */
export interface Diagnostics {
  readonly status: MiniStore<RendererStatus>;
  readonly errors: MiniStore<{readonly codes: readonly string[]}>;
  /** Called by the viewport once the engine picked a backend. */
  reportRenderer(report: {
    backend: RendererBackend;
    threeVersion?: string;
    adapter?: string | null;
  }): void;
  /** Records an error code (codes only, never messages or content). */
  recordError(code: string): void;
}

/** three.js revision the project pins (ADR-0003). */
export const THREE_VERSION = 'r186';

/** App version: `VITE_APP_VERSION` at build time, `dev` otherwise. */
export const APP_VERSION: string =
  (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? 'dev';

/** Creates the diagnostics holder. */
export function createDiagnostics(): Diagnostics {
  const status = createMiniStore<RendererStatus>({
    backend: null,
    threeVersion: THREE_VERSION,
    adapter: null,
  });
  const errors = createMiniStore<{readonly codes: readonly string[]}>({
    codes: [],
  });
  return {
    status,
    errors,
    reportRenderer(report) {
      status.update({
        backend: report.backend,
        threeVersion: report.threeVersion ?? THREE_VERSION,
        adapter: report.adapter ?? null,
      });
    },
    recordError(code) {
      errors.set({
        codes: [code, ...errors.get().codes].slice(0, ERROR_LOG_LIMIT),
      });
    },
  };
}
