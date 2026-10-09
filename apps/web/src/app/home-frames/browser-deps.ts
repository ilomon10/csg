/** Yields to the browser between characters so input stays responsive (REQ-UX-080). */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as {scheduler?: {yield?: () => Promise<void>}})
    .scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** Page visibility as far as the service needs it. */
export interface VisibilitySource {
  isHidden(): boolean;
  /** Calls `onChange` when the page is shown or hidden; returns a disconnect function. */
  subscribe(onChange: () => void): () => void;
}

/** `document.visibilityState`. */
export const documentVisibility: VisibilitySource = {
  isHidden: () => document.visibilityState === 'hidden',
  subscribe(onChange) {
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  },
};

/** Encodes RGBA8 pixels as a PNG blob through `OffscreenCanvas` (no third-party code). */
export async function encodePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2D canvas is not available');
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  return canvas.convertToBlob({type: 'image/png'});
}

/** Decodes a stored image; the repository validates size and format first (REQ-UX-082). */
export function decodeImage(
  blob: Blob,
): Promise<{width: number; height: number; close(): void}> {
  return createImageBitmap(blob);
}

/** The canvas of the offscreen home renderer (a detached element where `OffscreenCanvas` is missing). */
export function createHomeCanvas(): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(64, 64)
    : document.createElement('canvas');
}
