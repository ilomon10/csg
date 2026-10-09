/**
 * Client of the export worker (`export.worker.ts`, exported as `@csg/engine/export.worker`).
 * The host creates the `Worker` (REQ-GEN-014); this client validates every reply (REQ-GEN-016),
 * enforces a timeout, reports progress and cancels by terminating the worker (REQ-EXP-024).
 */
import type {EngineError, RenderedFrame, Result} from '../contracts';
import {ExportError, exportFailure} from './errors';
import {prepareExportRequest} from './request-check';
import {readExportReply} from './worker-protocol';
import type {ExportWorkerRequest, ExportWorkerResult} from './worker-protocol';
import type {ExportContext, ExportProgress} from './types';

/** Default time an export may run in the worker before it fails, in milliseconds. */
export const EXPORT_WORKER_TIMEOUT_MS = 120_000;

/** Options of {@link createExportWorkerClient}. */
export interface ExportWorkerClientOptions {
  /**
   * Creates a fresh worker. Required: the engine never constructs a `Worker` from a URL
   * (REQ-GEN-014). Called once per export, because cancel terminates the worker.
   */
  createWorker: () => Worker;
  /** Per-export timeout in ms. Default {@link EXPORT_WORKER_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** Per-call options of {@link ExportWorkerClient.run}. */
export interface ExportRunOptions {
  /** Abort to cancel; the promise rejects with `EXP_CANCELLED` and the worker is terminated. */
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

/** Runs exports in a host-created worker. */
export interface ExportWorkerClient {
  /**
   * Encodes and packages `frames`. The pixel buffers are transferred to the worker, so the
   * frames are unusable afterwards (REQ-EXP-024: buffers are released).
   *
   * @returns The ZIP and warnings, or a failed result (settings, limits, worker failure,
   *   timeout under `EXP_WORKER_FAILED`).
   * @throws ExportError `EXP_CANCELLED` when `options.signal` aborts.
   */
  run(
    frames: readonly RenderedFrame[],
    settings: unknown,
    context: ExportContext,
    options?: ExportRunOptions,
  ): Promise<Result<ExportWorkerResult, EngineError>>;
}

/**
 * Wraps a host-created export worker factory.
 *
 * @param options The factory and timeout.
 * @returns The client.
 */
export function createExportWorkerClient(
  options: ExportWorkerClientOptions,
): ExportWorkerClient {
  const timeoutMs = options.timeoutMs ?? EXPORT_WORKER_TIMEOUT_MS;
  let nextId = 1;
  return {
    run(frames, settings, context, runOptions = {}) {
      const {signal, onProgress} = runOptions;
      const prepared = prepareExportRequest(settings, context);
      if (!prepared.ok) return Promise.resolve(prepared);
      const id = nextId++;
      if (signal?.aborted === true) {
        return Promise.reject(
          new ExportError('EXP_CANCELLED', 'Export cancelled'),
        );
      }
      return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
          worker = options.createWorker();
        } catch (e) {
          resolve(
            exportFailure(
              'EXP_WORKER_FAILED',
              e instanceof Error
                ? e.message
                : 'could not start the export worker',
            ),
          );
          return;
        }
        let settled = false;
        const onAbort = () =>
          finish(() =>
            reject(new ExportError('EXP_CANCELLED', 'Export cancelled')),
          );
        const finish = (settle: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          worker.terminate();
          settle();
        };
        const fail = (message: string) =>
          finish(() => resolve(exportFailure('EXP_WORKER_FAILED', message)));

        const timer = setTimeout(
          () => fail(`export worker timed out after ${timeoutMs} ms`),
          timeoutMs,
        );
        signal?.addEventListener('abort', onAbort);
        worker.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (settled) return;
          const reply = readExportReply(event.data);
          if (reply === null || reply.id !== id) {
            // REQ-GEN-016: ignore invalid or unexpected replies; the timeout covers a stall.
            console.debug('export worker: ignored an invalid reply');
            return;
          }
          if (reply.type === 'progress') {
            onProgress?.({
              phase: reply.phase,
              done: reply.done,
              total: reply.total,
            });
          } else if (reply.type === 'done') {
            finish(() =>
              resolve({
                ok: true,
                value: {
                  zipName: reply.zipName,
                  zip: reply.zip,
                  files: reply.files,
                  warnings: reply.warnings,
                },
              }),
            );
          } else {
            finish(() =>
              resolve({
                ok: false,
                error: {code: reply.code, message: reply.message},
              }),
            );
          }
        });
        worker.addEventListener('error', () => fail('export worker failed'));
        worker.addEventListener('messageerror', () =>
          fail('export worker: message could not be deserialized'),
        );
        const request: ExportWorkerRequest = {
          type: 'export',
          id,
          frames: [...frames],
          settings: prepared.value.settings,
          context: prepared.value.context,
        };
        const transfer = [
          ...new Set(frames.map(f => f.pixels.buffer as ArrayBuffer)),
        ];
        try {
          worker.postMessage(request, transfer);
        } catch (e) {
          fail(
            e instanceof Error
              ? e.message
              : 'could not post to the export worker',
          );
        }
      });
    },
  };
}
