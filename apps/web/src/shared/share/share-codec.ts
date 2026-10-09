import {
  canonicalCharacterJson,
  parseCharacterSpec,
  parseJson,
} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import type {Result} from '../persistence/types';

/** Longest accepted `#c=` payload, checked before any decoding (REQ-CMP-034). */
export const MAX_SHARE_CHARS = 65_536;
/** Largest decompressed size, enforced while inflating (REQ-CMP-034). */
export const MAX_SHARE_BYTES = 1_048_576;

/** Error of a share fragment (REQ-CMP-034). */
export interface ShareError {
  readonly code: 'CMP_SPEC_INVALID' | 'CMP_BODY_MISSING';
  readonly message: string;
  /** Dotted path of the first failing field, if known. */
  readonly path?: string;
}

/** Limits of {@link decodeShareFragment}. */
export interface ShareLimits {
  readonly maxChars: number;
  readonly maxBytes: number;
}

const DEFAULT_LIMITS: ShareLimits = {
  maxChars: MAX_SHARE_CHARS,
  maxBytes: MAX_SHARE_BYTES,
};

const invalid = (
  message: string,
  path?: string,
): Result<never, ShareError> => ({
  ok: false,
  error: {
    code: 'CMP_SPEC_INVALID',
    message,
    ...(path === undefined ? {} : {path}),
  },
});

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(payload: string): Uint8Array {
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

/**
 * Encodes a character as `base64url(deflate-raw(canonical JSON))` without any network use
 * (REQ-CMP-025). The caller prefixes `#c=`.
 */
export async function encodeShareFragment(
  spec: CharacterSpec,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalCharacterJson(spec));
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/**
 * Decodes and validates a `#c=` payload (REQ-CMP-034, REQ-GEN-011). Rejects a payload over
 * `maxChars` before decoding, inflates incrementally and aborts as soon as the output exceeds
 * `maxBytes` (never allocating the full output), then applies forbidden-key rejection, the
 * migrations and the Zod validation of a character file. Never throws.
 */
export async function decodeShareFragment(
  payload: string,
  limits: ShareLimits = DEFAULT_LIMITS,
): Promise<Result<CharacterSpec, ShareError>> {
  if (payload.length > limits.maxChars) {
    return invalid(
      `The share link is longer than the ${limits.maxChars.toLocaleString('en-US')}-character limit.`,
    );
  }
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    return invalid('The share link is not valid base64url.');
  }
  let text: string;
  try {
    const compressed = fromBase64Url(payload);
    const reader = new Blob([compressed as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limits.maxBytes) {
        await reader.cancel().catch(() => {});
        return invalid(
          `The shared character is larger than the ${limits.maxBytes.toLocaleString('en-US')}-byte limit.`,
        );
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    text = new TextDecoder('utf-8', {fatal: true}).decode(joined);
  } catch {
    return invalid('The share link is not valid compressed data.');
  }
  const json = parseJson(text);
  if (!json.ok) {
    return invalid(
      'The shared character is not valid JSON.',
      json.issues[0]?.path,
    );
  }
  const spec = parseCharacterSpec(json.value);
  if (!spec.ok) {
    const first = spec.issues[0];
    return {
      ok: false,
      error: {
        code: spec.code,
        message: first?.message ?? 'Invalid character',
        ...(first?.path === undefined ? {} : {path: first.path}),
      },
    };
  }
  return {ok: true, value: spec.value};
}
