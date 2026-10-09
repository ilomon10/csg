/**
 * Validation behind the `csg-worker-url` Trusted Types policy (spec 000 REQ-GEN-014). Pure and
 * free of side effects so it is unit-testable; `trusted-types.ts` installs it.
 */

/** Inputs the validator needs; injectable for tests. */
export interface WorkerUrlValidatorOptions {
  /** The editor's origin (`self.origin`). */
  readonly origin: string;
  /** Base for relative inputs (`document.baseURI`). */
  readonly baseURI: string;
  /** Module-worker URLs the build emitted, absolute or relative to `baseURI`. */
  readonly allowlist: readonly string[];
}

/** A function that returns the validated URL string or throws a `TypeError`. */
export type WorkerUrlValidator = (input: string) => string;

/**
 * Builds the REQ-GEN-014 (a)-(e) check: http(s) scheme, own origin, no credentials, no
 * fragment, and a serialized URL equal to an allowlist entry. Inputs with a backslash, a
 * `.`/`..` path segment or a percent-encoded dot are rejected even when they would
 * normalize onto an allowlisted URL.
 *
 * @param options Origin, base and allowlist.
 * @returns The validator.
 */
export function createWorkerUrlValidator(
  options: WorkerUrlValidatorOptions,
): WorkerUrlValidator {
  const allowed = new Set(
    options.allowlist.map(u => new URL(u, options.baseURI).href),
  );
  const reject = (why: string): never => {
    throw new TypeError(`csg-worker-url: rejected worker URL (${why})`);
  };
  return input => {
    if (typeof input !== 'string') return reject('not a string');
    if (input.includes('\\')) return reject('backslash');
    if (input.includes('#')) return reject('fragment');
    if (/%2e/i.test(input)) return reject('encoded dot');
    const rawPath = input.split(/[?]/, 1)[0] ?? '';
    if (rawPath.split('/').some(s => s === '.' || s === '..')) {
      return reject('dot segment');
    }
    let url: URL;
    try {
      url = new URL(input, options.baseURI);
    } catch {
      return reject('unparsable');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return reject('scheme');
    }
    if (url.origin !== options.origin) return reject('origin');
    if (url.username !== '' || url.password !== '') {
      return reject('credentials');
    }
    if (url.hash !== '') return reject('fragment');
    if (!allowed.has(url.href)) return reject('not in the allowlist');
    return url.href;
  };
}
