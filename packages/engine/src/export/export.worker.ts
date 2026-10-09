/**
 * Module worker that encodes and packages an export off the main thread (REQ-EXP-023).
 *
 * Exported as `@csg/engine/export.worker`. The host imports it with Vite's `?worker&url` and
 * constructs the `Worker` itself through its Trusted Types policy `csg-worker-url`
 * (REQ-GEN-014); the engine never builds a `Worker` from a URL. Cancel terminates the worker
 * (the encode is one synchronous run), which releases every buffer. This module touches no
 * network and no dynamic code.
 *
 * @module
 */

import {exportSpriteSheet} from './export-sprite-sheet';
import {checkExportSettings} from './settings-check';
import {readExportRequest} from './worker-protocol';
import type {ExportWorkerReply} from './worker-protocol';

/** A reply plus the buffers to transfer with it. */
export interface ExportWorkerPost {
  reply: ExportWorkerReply;
  transfer: ArrayBuffer[];
}

/**
 * Validates one request (data from `postMessage`, untrusted) and runs the export, posting
 * `progress` replies and one final `done` or `error`. Never throws.
 *
 * @param data The message data.
 * @param post Sends a reply.
 */
export async function handleExportRequest(
  data: unknown,
  post: (message: ExportWorkerPost) => void,
): Promise<void> {
  const req = readExportRequest(data);
  if (!req.ok) {
    post({
      reply: {
        type: 'error',
        id: req.id,
        code: 'EXP_INVALID_SETTINGS',
        message: req.message,
      },
      transfer: [],
    });
    return;
  }
  const {id, frames, settings, context} = req.value;
  const valid = checkExportSettings(settings);
  if (!valid.ok) {
    post({
      reply: {
        type: 'error',
        id,
        code: valid.error.code,
        message: valid.error.message,
      },
      transfer: [],
    });
    return;
  }
  try {
    const result = await exportSpriteSheet(frames, valid.value, context, {
      onProgress: p =>
        post({reply: {type: 'progress', id, ...p}, transfer: []}),
    });
    if (!result.ok) {
      post({
        reply: {
          type: 'error',
          id,
          code: result.error.code,
          message: result.error.message,
        },
        transfer: [],
      });
      return;
    }
    const {zip, zipName, files, warnings} = result.value;
    post({
      reply: {
        type: 'done',
        id,
        zipName,
        zip,
        files: files.map(f => ({
          name: f.name,
          mime: f.mime,
          size: f.bytes.length,
        })),
        warnings,
      },
      transfer: [zip.buffer as ArrayBuffer],
    });
  } catch (e) {
    post({
      reply: {
        type: 'error',
        id,
        code: 'EXP_WORKER_FAILED',
        message: e instanceof Error ? e.message.slice(0, 200) : 'export failed',
      },
      transfer: [],
    });
  }
}

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: {data: unknown}) => void,
  ): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

// Install the handler only inside a worker; importing this module elsewhere (tests) is inert.
if ('WorkerGlobalScope' in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.addEventListener('message', event => {
    void handleExportRequest(event.data, m =>
      scope.postMessage(m.reply, m.transfer),
    );
  });
}
