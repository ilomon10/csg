/**
 * URL policy of the bundled-asset loader (architecture 4.10, spec 000 REQ-GEN-010, spec 011
 * REQ-AST-029): bundled GLBs and anything they reference load only from the app's own origin
 * or from `blob:` URLs. Pure string logic, no DOM.
 */

/** URL the loading manager substitutes for a refused URL; fetching it always fails. */
export const BLOCKED_URL = 'blocked:refused-by-url-policy';

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Whether `url` may be loaded. `blob:` is always allowed. With a known `origin` (for example
 * `https://app.example`), a URL is allowed when it resolves against that origin to the same
 * origin over http(s). Without an origin (Node, tests) only relative URLs are allowed:
 * no scheme and no protocol-relative `//host` prefix.
 *
 * @param url URL as given to the loader or produced by glTF resource resolution.
 * @param origin The app's own origin, or `undefined` when there is none.
 * @returns `true` when the URL is same-origin or `blob:`.
 */
export function isAllowedAssetUrl(url: string, origin?: string): boolean {
  if (url.startsWith('blob:')) return true;
  if (url.startsWith('//') || url.startsWith('\\')) {
    return origin !== undefined && sameOrigin(url, origin);
  }
  if (origin === undefined) return !SCHEME.test(url);
  return sameOrigin(url, origin);
}

function sameOrigin(url: string, origin: string): boolean {
  let resolved: URL;
  try {
    resolved = new URL(url, `${origin}/`);
  } catch {
    return false;
  }
  return (
    (resolved.protocol === 'http:' || resolved.protocol === 'https:') &&
    resolved.origin === origin
  );
}

/**
 * Joins a pack base URL and a pack-relative file path with exactly one `/` between them.
 *
 * @param baseUrl Pack base URL, with or without a trailing slash.
 * @param file Relative path inside the pack (validated by the manifest schema).
 * @returns The file URL.
 */
export function joinPackUrl(baseUrl: string, file: string): string {
  if (baseUrl === '') return file;
  return baseUrl.endsWith('/') ? `${baseUrl}${file}` : `${baseUrl}/${file}`;
}
