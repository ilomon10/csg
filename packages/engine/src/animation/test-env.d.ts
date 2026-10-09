// Minimal ambient types so the animation tests can read committed fixtures without adding
// @types/node to @csg/engine.
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
}

declare const process: {memoryUsage(): {heapUsed: number}};
