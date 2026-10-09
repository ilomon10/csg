import {canonicalCharacterObject, parseCharacterSpec} from './character-spec';
import type {CharacterSpec} from './character-spec';
import {defaultExportSettings, parseExportSettings} from './export-settings';
import type {ExportSettings} from './export-settings';
import {findForbiddenKey, parseJson} from './json';
import type {SchemaIssue} from './primitives';
import {defaultRenderSettings, parseRenderSettings} from './render-settings';
import type {RenderSettings} from './render-settings';

/** Current version of the persisted `sprite-project` wrapper (architecture 3.3, REQ-UX-025). */
export const PROJECT_FORMAT_VERSION = 1;

/** Hard cap on a stored or imported project document, in bytes of UTF-8 JSON (REQ-UX-025, D11). */
export const MAX_PROJECT_JSON_BYTES = 1_048_576;

/**
 * The persisted project (architecture 3.3). `character` carries its own version and is migrated
 * independently of the wrapper (REQ-CMP-049). `graphs` is an opaque passthrough until M4, which
 * validates entries with `@csg/shader-graph` in the web layer (parts-schema may not import it).
 */
export interface ProjectDocument {
  format: 'sprite-project';
  version: 1;
  character: CharacterSpec;
  render: RenderSettings;
  export: ExportSettings;
  /** Embedded (user-edited) graphs keyed by id; built-ins are referenced by `builtin:` ids. */
  graphs: Record<string, unknown>;
}

/** A pure `vN -> vN+1` migration of the wrapper (not of `character`). */
export type ProjectMigration = (
  doc: Record<string, unknown>,
) => Record<string, unknown>;

/** Wrapper migrations keyed by the version they upgrade from. Empty at version 1. */
export const PROJECT_MIGRATIONS: Readonly<Record<number, ProjectMigration>> =
  {};

/** Why a project failed to load. Character failures keep their `CMP_*` code. */
export type ProjectDocumentErrorCode =
  'UX_PROJECT_INVALID' | 'CMP_SPEC_INVALID' | 'CMP_BODY_MISSING';

/** Result of {@link parseProjectDocument}; never throws. */
export type ProjectDocumentResult =
  | {ok: true; value: ProjectDocument}
  | {ok: false; code: ProjectDocumentErrorCode; issues: SchemaIssue[]};

const invalid = (path: string, message: string): ProjectDocumentResult => ({
  ok: false,
  code: 'UX_PROJECT_INVALID',
  issues: [{path, message}],
});

const prefix = (name: string, issues: SchemaIssue[]): SchemaIssue[] =>
  issues.map(issue => ({
    ...issue,
    path: issue.path === '' ? name : `${name}.${issue.path}`,
  }));

/**
 * Validates and migrates a parsed project document. Order: object check, forbidden keys
 * (`__proto__`, `constructor`, `prototype`), wrapper migrations, then `character` through
 * {@link parseCharacterSpec} by its own version (REQ-CMP-049), `render`, `export`, `graphs`.
 * A newer wrapper version fails; nothing is written back. Never throws.
 */
export function parseProjectDocument(json: unknown): ProjectDocumentResult {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return invalid('', 'project must be an object');
  }
  const forbidden = findForbiddenKey(json);
  if (forbidden !== null) {
    return invalid(forbidden, `forbidden key at ${forbidden}`);
  }
  let doc = {...(json as Record<string, unknown>)};
  if (doc['format'] !== 'sprite-project') {
    return invalid('format', 'format must be "sprite-project"');
  }
  let version = doc['version'];
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return invalid('version', 'version must be a positive integer');
  }
  if (version > PROJECT_FORMAT_VERSION) {
    return invalid(
      'version',
      `version ${version} is newer than the supported version ${PROJECT_FORMAT_VERSION}`,
    );
  }
  while (version < PROJECT_FORMAT_VERSION) {
    const step: ProjectMigration | undefined = PROJECT_MIGRATIONS[version];
    if (step === undefined) {
      return invalid('version', `no migration from version ${version}`);
    }
    doc = {...step(doc), version: version + 1};
    version += 1;
  }

  const character = parseCharacterSpec(doc['character']);
  if (!character.ok) {
    return {
      ok: false,
      code: character.code,
      issues: prefix('character', character.issues),
    };
  }
  if (doc['render'] === undefined)
    return invalid('render', 'render is required');
  const render = parseRenderSettings(doc['render']);
  if (!render.ok) {
    return {
      ok: false,
      code: 'UX_PROJECT_INVALID',
      issues: prefix(
        'render',
        render.issues.map(({path, message, field}) => ({
          path,
          message,
          ...(field !== undefined ? {field} : {}),
        })),
      ),
    };
  }
  if (doc['export'] === undefined)
    return invalid('export', 'export is required');
  const exportSettings = parseExportSettings(doc['export']);
  if (!exportSettings.ok) {
    return {
      ok: false,
      code: 'UX_PROJECT_INVALID',
      issues: prefix('export', exportSettings.issues),
    };
  }
  const graphs = doc['graphs'];
  if (typeof graphs !== 'object' || graphs === null || Array.isArray(graphs)) {
    return invalid('graphs', 'graphs must be an object');
  }
  return {
    ok: true,
    value: {
      format: 'sprite-project',
      version: PROJECT_FORMAT_VERSION,
      character: character.value,
      render: render.value,
      export: exportSettings.value,
      graphs: {...(graphs as Record<string, unknown>)},
    },
  };
}

/**
 * Parses project JSON text: rejects text above {@link MAX_PROJECT_JSON_BYTES} (UTF-8 bytes),
 * invalid JSON and forbidden keys, then runs {@link parseProjectDocument}. Never throws.
 */
export function parseProjectDocumentJson(text: string): ProjectDocumentResult {
  if (utf8ByteLength(text) > MAX_PROJECT_JSON_BYTES) {
    return invalid(
      '',
      `project is larger than ${MAX_PROJECT_JSON_BYTES} bytes`,
    );
  }
  const json = parseJson(text);
  if (!json.ok)
    return {ok: false, code: 'UX_PROJECT_INVALID', issues: json.issues};
  return parseProjectDocument(json.value);
}

/** UTF-8 byte length of a string (lone surrogates count as 3 bytes, like the replacement char). */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Recursively sorts object keys by code unit and drops `undefined` members. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, member]) => [key, sortKeys(member)]),
  );
}

/**
 * Canonical, compact JSON of a project: the character in canonical order (REQ-CMP-022), every
 * other member with keys sorted by code unit, so equal documents give identical bytes regardless
 * of how they were built. This is the input of `ExportContext.projectSha256` (REQ-EXP-011).
 */
export function canonicalProjectJson(doc: ProjectDocument): string {
  return JSON.stringify({
    format: doc.format,
    version: doc.version,
    character: canonicalCharacterObject(doc.character),
    render: sortKeys(doc.render),
    export: sortKeys(doc.export),
    graphs: sortKeys(doc.graphs),
  });
}

/**
 * Creates a project around a character with default export settings and no embedded graphs.
 * Render settings default to {@link defaultRenderSettings} for the `three-quarter` preset (the editor default) when omitted.
 */
export function createProjectDocument(
  character: CharacterSpec,
  render: RenderSettings = defaultRenderSettings('three-quarter'),
): ProjectDocument {
  return {
    format: 'sprite-project',
    version: PROJECT_FORMAT_VERSION,
    character,
    render,
    export: defaultExportSettings(),
    graphs: {},
  };
}
