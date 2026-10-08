// Minimal ambient Node typing for the composition tests, which read the committed fixtures
// (packages/engine/test/fixtures) without adding @types/node to @csg/engine. Merges with the
// declaration in retarget/test-env.d.ts.
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
}
