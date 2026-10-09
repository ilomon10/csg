// Minimal ambient types so the retarget boundary test can read its own sources without adding
// @types/node to @csg/engine (the retarget sources stay free of Node and DOM typings).
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function readdirSync(path: URL): string[];
}
