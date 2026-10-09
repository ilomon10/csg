/**
 * Creates the one Trusted Types policy of the editor, `csg-worker-url` (spec 000 REQ-GEN-014).
 * It must be the first import of the entry module (AC-GEN-014.6): nothing else may run before
 * the policy exists, and the CSP (`trusted-types csg-worker-url`) allows no other policy name,
 * no `default` policy and no second `csg-worker-url`.
 */
import paletteWorkerUrl from '@csg/engine/palette-lut.worker?worker&url';
import {createWorkerUrlValidator} from './worker-url-policy';

/** The module-worker URLs of this build (REQ-GEN-014 (e)); nothing is added at runtime. */
export const WORKER_URL_ALLOWLIST: readonly string[] = [paletteWorkerUrl];

/** The palette LUT worker's URL (spec 003 REQ-PIX-021). */
export const PALETTE_WORKER_URL: string = paletteWorkerUrl;

/** What `createScriptURL` of the policy returns: a `TrustedScriptURL`, or a string without Trusted Types. */
export type WorkerScriptUrl = string;

interface TrustedTypesFactory {
  createPolicy(
    name: string,
    rules: {createScriptURL: (input: string) => string},
  ): {createScriptURL(input: string): unknown};
}

const validate = createWorkerUrlValidator({
  origin: self.origin,
  baseURI: document.baseURI,
  allowlist: WORKER_URL_ALLOWLIST,
});

const factory = (globalThis as {trustedTypes?: TrustedTypesFactory})
  .trustedTypes;
const policy =
  factory === undefined
    ? null
    : factory.createPolicy('csg-worker-url', {createScriptURL: validate});

/**
 * Returns the script URL to pass to `new Worker(...)`: a `TrustedScriptURL` where Trusted Types
 * exist, else the validated string (same checks).
 *
 * @param input Worker URL.
 * @returns The value for the `Worker` constructor.
 * @throws TypeError when the URL fails the REQ-GEN-014 checks.
 */
export function createWorkerScriptUrl(input: string): WorkerScriptUrl {
  return (
    policy === null ? validate(input) : policy.createScriptURL(input)
  ) as WorkerScriptUrl;
}
