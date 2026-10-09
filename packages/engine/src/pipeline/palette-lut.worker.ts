/**
 * Module worker that builds palette LUTs off the main thread (REQ-PIX-021, AC-PIX-021.2).
 *
 * Exported as `@csg/engine/palette-lut.worker`. The host imports it with Vite's `?worker&url`
 * and constructs the `Worker` itself through its Trusted Types policy `csg-worker-url`
 * (REQ-GEN-014); the engine never builds a `Worker` from a URL. The script is same-origin
 * (`worker-src 'self'`, no `blob:`). The bytes are those of {@link buildPaletteLut} in Node
 * (AC-PIX-021.5). This module touches no network and no dynamic code.
 *
 * @module
 */

import {PALETTE_LUT_MAX_COLORS, buildPaletteLut} from './palette-lut';
import type {PaletteLutResponse} from './palette-lut';

/** A response plus the buffers to transfer with it. */
export interface PaletteLutReply {
  /** Message to post back. */
  response: PaletteLutResponse;
  /** Transferables (the LUT buffer when built). */
  transfer: ArrayBuffer[];
}

/**
 * Validates one request (data from `postMessage`, treated as untrusted) and builds the LUT.
 * Never throws: invalid input becomes an `error` response.
 */
export function handlePaletteLutRequest(data: unknown): PaletteLutReply {
  try {
    return handleRequest(data);
  } catch {
    return {
      response: {type: 'error', id: -1, message: 'internal error'},
      transfer: [],
    };
  }
}

function handleRequest(data: unknown): PaletteLutReply {
  const fail = (id: number, message: string): PaletteLutReply => ({
    response: {type: 'error', id, message},
    transfer: [],
  });
  if (data === null || typeof data !== 'object') {
    return fail(-1, 'request must be an object');
  }
  const req = data as Record<string, unknown>;
  const id =
    typeof req.id === 'number' && Number.isInteger(req.id) ? req.id : -1;
  if (req.type !== 'build' || id < 0) return fail(id, 'malformed request');
  const {colors, metric} = req;
  if (metric !== 'oklab' && metric !== 'srgb') {
    return fail(id, 'metric must be oklab or srgb');
  }
  const badColors = `colors must be 1..${PALETTE_LUT_MAX_COLORS} #rrggbb strings`;
  if (
    !Array.isArray(colors) ||
    colors.length < 1 ||
    colors.length > PALETTE_LUT_MAX_COLORS
  ) {
    return fail(id, badColors);
  }
  // Index loop: `every` skips holes, so a sparse array would slip through.
  for (let i = 0; i < colors.length; i++) {
    const c: unknown = colors[i];
    if (typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c)) {
      return fail(id, badColors);
    }
  }
  try {
    const lut = buildPaletteLut(colors as string[], metric);
    return {
      response: {type: 'built', id, lut},
      transfer: [lut.buffer as ArrayBuffer],
    };
  } catch (e) {
    return fail(id, e instanceof Error ? e.message : 'build failed');
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
    const reply = handlePaletteLutRequest(event.data);
    scope.postMessage(reply.response, reply.transfer);
  });
}
