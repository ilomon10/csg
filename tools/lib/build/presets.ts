/**
 * Preset data of a pack (spec 011 output layout, spec 002 REQ-ANA-013/022/024, spec 014
 * REQ-UX-060/062/103, spec 006 REQ-EDT-044, spec 001 REQ-CMP-027). Authored files live in
 * `tools/packs/<packId>/presets/<folder>/*.json`; the build validates them with the parts-schema
 * preset schemas, copies them to `assets/packs/<packId>/presets/` and writes
 * `presets/index.json`. Pure validation ({@link validatePresetSet}) is kept apart from I/O.
 */
import {existsSync} from 'node:fs';
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  anatomyPresetSchema,
  bodyShapePresetSchema,
  easyCategoryDefSchema,
  lookPresetSchema,
  parseCharacterPreset,
  parseJson,
  parsePresetFile,
  presetIndexSchema,
  styleDefinitionSchema,
  swatchSetDefSchema,
  validateStyleDefinitions,
} from '@csg/parts-schema';
import type {PresetFileKind, PresetIndex, SchemaIssue} from '@csg/parts-schema';
import {canonicalJson} from './canonical-json.js';
import {BuildError} from './types.js';

/** Preset folder of each kind, in index order. */
export const PRESET_FOLDERS: ReadonlyArray<{
  kind: PresetFileKind;
  folder: string;
}> = [
  {kind: 'anatomy-preset', folder: 'anatomy'},
  {kind: 'body-shape', folder: 'body-shapes'},
  {kind: 'style', folder: 'styles'},
  {kind: 'easy-category', folder: 'categories'},
  {kind: 'swatch-set', folder: 'swatches'},
  {kind: 'character', folder: 'characters'},
  {kind: 'look', folder: 'looks'},
];

/** One preset finding; `path` is the pack-relative file. */
export interface PresetIssue {
  code: 'AST_PRESET_INVALID';
  path: string;
  message: string;
}

/** A parsed preset file, `path` pack-relative (`presets/<folder>/<name>.json`). */
export interface PresetFile {
  kind: PresetFileKind;
  path: string;
  json: unknown;
}

function fromIssues(
  path: string,
  issues: readonly SchemaIssue[],
): PresetIssue[] {
  return issues.map(i => ({
    code: 'AST_PRESET_INVALID',
    path,
    message: `${path}${i.entryId === undefined ? '' : ` (${i.entryId})`}: ${i.path === '' ? '' : `${i.path}: `}${i.message}`,
  }));
}

/** Result of {@link validatePresetSet}: findings plus the ordered index. */
export interface PresetSetResult {
  issues: PresetIssue[];
  index: PresetIndex;
}

/**
 * Validates every file against its schema, checks that each `id` equals its file name, that IDs
 * are unique per kind, and the cross-file rules of the style files (REQ-ANA-024). Files are
 * sorted by kind then path in the index.
 */
export function validatePresetSet(
  files: readonly PresetFile[],
): PresetSetResult {
  const issues: PresetIssue[] = [];
  const kindOrder = new Map(PRESET_FOLDERS.map((f, i) => [f.kind, i]));
  const sorted = [...files].sort(
    (a, b) =>
      (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  const ids = new Map<string, string>();
  const anatomyIds = new Set<string>();
  const styles: Array<ReturnType<typeof styleDefinitionSchema.parse>> = [];
  for (const file of sorted) {
    const stem = file.path.replace(/^.*\//, '').replace(/\.json$/, '');
    let result: {ok: boolean; issues?: readonly SchemaIssue[]; value?: unknown};
    switch (file.kind) {
      case 'anatomy-preset':
        result = parsePresetFile(anatomyPresetSchema, file.json);
        break;
      case 'body-shape':
        result = parsePresetFile(bodyShapePresetSchema, file.json);
        break;
      case 'style':
        result = parsePresetFile(styleDefinitionSchema, file.json);
        break;
      case 'easy-category':
        result = parsePresetFile(easyCategoryDefSchema, file.json);
        break;
      case 'swatch-set':
        result = parsePresetFile(swatchSetDefSchema, file.json);
        break;
      case 'character':
        result = parseCharacterPreset(file.json);
        break;
      case 'look':
        result = parsePresetFile(lookPresetSchema, file.json);
        break;
    }
    if (!result.ok) {
      issues.push(...fromIssues(file.path, result.issues ?? []));
      continue;
    }
    const value = result.value as {id?: string; style?: string};
    const id = file.kind === 'style' ? value.style : value.id;
    if (id !== stem) {
      issues.push({
        code: 'AST_PRESET_INVALID',
        path: file.path,
        message: `${file.path}: id "${String(id)}" must equal the file name "${stem}".`,
      });
    }
    if (file.kind === 'look') {
      const look = value as {palette?: {id?: string}};
      const source = (file.json as {paletteSource?: Record<string, unknown>})
        .paletteSource;
      const text = (k: string): boolean =>
        typeof source?.[k] === 'string' && (source[k] as string).length > 0;
      // A custom palette is data with a provenance record (P-02).
      if (
        look.palette?.id === 'custom' &&
        !(
          text('name') &&
          text('author') &&
          text('license') &&
          /^https?:\/\/\S+$/.test(String(source?.['sourceUrl'] ?? ''))
        )
      ) {
        issues.push({
          code: 'AST_PRESET_INVALID',
          path: file.path,
          message: `${file.path}: a custom palette needs paletteSource {name, author, sourceUrl, license}.`,
        });
      }
    }
    const key = `${file.kind}:${String(id)}`;
    const previous = ids.get(key);
    if (previous !== undefined) {
      issues.push({
        code: 'AST_PRESET_INVALID',
        path: file.path,
        message: `${file.path}: duplicate ${file.kind} id "${String(id)}" (also ${previous}).`,
      });
    }
    ids.set(key, file.path);
    if (file.kind === 'anatomy-preset' && id !== undefined) anatomyIds.add(id);
    if (file.kind === 'style') styles.push(value as never);
  }
  for (const issue of validateStyleDefinitions(styles, anatomyIds)) {
    issues.push({
      code: 'AST_PRESET_INVALID',
      path: `presets/styles/${issue.entryId ?? ''}.json`,
      message: `style ${issue.entryId ?? ''}: ${issue.path}: ${issue.message}`,
    });
  }
  const index = presetIndexSchema.parse({
    format: 'sprite-preset-index',
    version: 1,
    files: sorted.map(f => ({kind: f.kind, path: f.path})),
  });
  return {issues, index};
}

/** Reads the authored preset files of a pack (`tools/packs/<packId>/presets/**`). */
export async function readPresetSources(
  packDir: string,
): Promise<{files: PresetFile[]; issues: PresetIssue[]}> {
  const files: PresetFile[] = [];
  const issues: PresetIssue[] = [];
  for (const {kind, folder} of PRESET_FOLDERS) {
    const dir = join(packDir, 'presets', folder);
    if (!existsSync(dir)) continue;
    for (const name of (await readdir(dir)).sort()) {
      if (!name.endsWith('.json')) continue;
      const path = `presets/${folder}/${name}`;
      const parsed = parseJson(await readFile(join(dir, name), 'utf8'));
      if (!parsed.ok) {
        issues.push(...fromIssues(path, parsed.issues));
        continue;
      }
      files.push({kind, path, json: parsed.value});
    }
  }
  return {files, issues};
}

/**
 * Validates and writes a pack's presets and `presets/index.json` (deterministic: sorted, files
 * keep their key order). Removes `presets/` from the output when the pack has no preset sources.
 *
 * @throws BuildError `AST_PRESET_INVALID` listing every finding.
 */
export async function emitPresets(args: {
  root: string;
  outRoot: string;
  packId: string;
}): Promise<{files: number}> {
  const outDir = join(args.outRoot, args.packId, 'presets');
  const {files, issues} = await readPresetSources(
    join(args.root, 'tools', 'packs', args.packId),
  );
  const checked = validatePresetSet(files);
  const all = [...issues, ...checked.issues];
  if (all.length > 0) {
    throw new BuildError(
      'AST_PRESET_INVALID',
      `preset data of ${args.packId} is invalid:\n${all.map(i => `  - ${i.message}`).join('\n')}`,
      1,
    );
  }
  await rm(outDir, {recursive: true, force: true});
  if (files.length === 0) return {files: 0};
  for (const file of files) {
    const abs = join(args.outRoot, args.packId, file.path);
    await mkdir(join(abs, '..'), {recursive: true});
    await writeFile(abs, `${JSON.stringify(file.json, null, 2)}\n`);
  }
  await writeFile(join(outDir, 'index.json'), canonicalJson(checked.index));
  return {files: files.length};
}
