// Minimal ambient types so tests can read data files without adding @types/node to the package
// (parts-schema stays free of Node and DOM typings in its sources).
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
declare class URL {
  constructor(input: string, base?: string);
}
interface ImportMeta {
  readonly url: string;
}
