import {
  canonicalCharacterJson,
  parseCharacterSpec,
  parseJson,
} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import type {Catalog} from '../../shared/catalog';
import {t} from '../../shared/i18n';
import {refName} from './labels';

/** Largest accepted character file (AC-CMP-023.2). */
export const MAX_CHARACTER_FILE_BYTES = 1_048_576;

/**
 * File name of a saved character (REQ-CMP-022): the name lowercased, every run of characters
 * outside `[a-z0-9]` collapsed to `-`, trimmed, plus `.character.json`. "Hero #1" becomes
 * `hero-1.character.json`; an empty result becomes `character`.
 */
export function characterFileName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return `${base === '' ? 'character' : base}.character.json`;
}

/** The file text of a character: canonical key order, 2-space indent, byte-stable (AC-CMP-022.2). */
export function serializeCharacter(spec: CharacterSpec): string {
  return canonicalCharacterJson(spec);
}

/** A character file that could not be loaded; the current character stays unchanged. */
export interface CharacterFileError {
  readonly ok: false;
  readonly code: 'CMP_SPEC_INVALID' | 'CMP_BODY_MISSING';
  readonly message: string;
  /** Dotted path of the first failing field, if known. */
  readonly path?: string;
}

/** A loaded character, with the `builtin:` refs the catalog does not know (REQ-CMP-024). */
export interface CharacterFileLoaded {
  readonly ok: true;
  readonly spec: CharacterSpec;
  /** Pack-relative ids of removed parts, e.g. `cape-99`. */
  readonly missing: readonly string[];
}

const invalid = (message: string, path?: string): CharacterFileError => ({
  ok: false,
  code: 'CMP_SPEC_INVALID',
  message,
  ...(path === undefined ? {} : {path}),
});

/**
 * Parses a character file (REQ-CMP-023, REQ-CMP-024): size cap, forbidden keys, migrations,
 * validation, then the catalog check. A `builtin:` part the catalog does not know leaves its
 * slot empty and is listed in `missing`; an unknown `builtin:` body fails with `CMP_BODY_MISSING`.
 * `user:` refs are kept (spec 008). Never throws.
 */
export function loadCharacterFile(
  text: string,
  catalog: Pick<Catalog, 'parts'>,
): CharacterFileLoaded | CharacterFileError {
  if (new TextEncoder().encode(text).length > MAX_CHARACTER_FILE_BYTES) {
    return invalid(t('composer.file.tooLarge'));
  }
  const json = parseJson(text);
  if (!json.ok) {
    return invalid(
      t('composer.file.notValid', {detail: json.issues[0]?.message ?? ''}),
      json.issues[0]?.path,
    );
  }
  const parsed = parseCharacterSpec(json.value);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    if (first?.path === 'version' && first.message.includes('newer')) {
      return invalid(t('composer.file.newer'), 'version');
    }
    return {
      ok: false,
      code: parsed.code,
      message: t('composer.file.notValid', {
        detail: first ? `${first.path}: ${first.message}` : '',
      }),
      ...(first?.path === undefined ? {} : {path: first.path}),
    };
  }
  const known = new Set(catalog.parts.map(p => p.ref));
  const missing = (ref: string) =>
    ref.startsWith('builtin:') && !known.has(ref);
  const spec = parsed.value;
  if (missing(spec.body.ref)) {
    return {
      ok: false,
      code: 'CMP_BODY_MISSING',
      message: t('composer.file.notValid', {
        detail: `body: ${refName(spec.body.ref)} is not installed`,
      }),
      path: 'body',
    };
  }
  const parts: CharacterSpec['parts'] = {};
  const dropped: string[] = [];
  for (const [slot, selection] of Object.entries(spec.parts)) {
    if (missing(selection.ref)) dropped.push(refName(selection.ref));
    else parts[slot] = selection;
  }
  return {
    ok: true,
    spec: dropped.length === 0 ? spec : {...spec, parts},
    missing: dropped,
  };
}

/** Starts a browser download of `text` as `fileName` (a local Blob, no network). */
export function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], {type: 'application/json;charset=utf-8'}),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
