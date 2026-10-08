/**
 * Stage 1a: loads `tools/packs/<packId>/pack.config.json` (spec 011 REQ-AST-009) and joins it with
 * the `dir` and tree hash from `tools/asset-sources.json` (REQ-AST-001).
 */
import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseJson, parsePackConfig} from '@csg/parts-schema';
import type {SchemaIssue} from '@csg/parts-schema';
import {BuildError} from './types.js';
import type {LoadedPack, SourcePackInfo} from './types.js';

/** Parses the `packs` array of `asset-sources.json` text; throws {@link BuildError} when malformed. */
export function parseAssetSources(text: string): SourcePackInfo[] {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    throw new BuildError(
      'AST_CONFIG_INVALID',
      `asset-sources.json is not valid JSON: ${parsed.issues.map(i => i.message).join('; ')}`,
      2,
    );
  }
  const json = parsed.value as {packs?: unknown} | null;
  if (json === null || typeof json !== 'object' || !Array.isArray(json.packs)) {
    throw new BuildError(
      'AST_CONFIG_INVALID',
      'asset-sources.json has no "packs" array.',
      2,
    );
  }
  return (json.packs as Array<SourcePackInfo | null>).map((p, index) => {
    if (p === null || typeof p !== 'object') {
      throw new BuildError(
        'AST_CONFIG_INVALID',
        `asset-sources.json: packs[${index}] is not an object.`,
        2,
      );
    }
    if (
      typeof p.packId !== 'string' ||
      (p.dir !== undefined &&
        (typeof p.dir !== 'string' ||
          p.dir.length === 0 ||
          /[\\/]/.test(p.dir) ||
          p.dir === '..'))
    ) {
      throw new BuildError(
        'AST_CONFIG_INVALID',
        `asset-sources.json: bad entry for pack "${String(p.packId)}" (dir must be one path segment).`,
        2,
      );
    }
    return {...p, dir: p.dir ?? p.packId};
  });
}

/** Validates one config JSON text into a {@link LoadedPack}; throws `AST_CONFIG_INVALID` with every issue. */
export function loadPackFromText(
  text: string,
  configPath: string,
  sources: readonly SourcePackInfo[],
): LoadedPack {
  const json = parseJson(text);
  if (!json.ok) {
    throw new BuildError(
      'AST_CONFIG_INVALID',
      `${configPath} is not valid JSON: ${json.issues.map(i => i.message).join('; ')}`,
      2,
    );
  }
  const parsed = parsePackConfig(json.value);
  if (!parsed.ok) {
    const lines = parsed.issues.map(i => `  - ${formatIssue(i)}`);
    throw new BuildError(
      'AST_CONFIG_INVALID',
      `${configPath}:\n${lines.join('\n')}`,
      2,
    );
  }
  const config = parsed.value;
  const source = sources.find(s => s.packId === config.packId);
  return {
    packId: config.packId,
    config,
    dir: source?.dir ?? config.packId,
    source,
    configPath,
  };
}

function formatIssue(issue: SchemaIssue): string {
  const id = issue.entryId ? `[${issue.entryId}] ` : '';
  return `${id}${issue.path ? `${issue.path}: ` : ''}${issue.message}`;
}

/**
 * Loads every `tools/packs/<packId>/pack.config.json` under `root` (the repo root), sorted by
 * pack ID. A missing `tools/packs/` yields an empty list.
 */
export async function loadPackConfigs(root: string): Promise<LoadedPack[]> {
  const packsDir = join(root, 'tools', 'packs');
  const sourcesPath = join(root, 'tools', 'asset-sources.json');
  const sources = existsSync(sourcesPath)
    ? parseAssetSources(await readFile(sourcesPath, 'utf8'))
    : [];
  if (!existsSync(packsDir)) return [];
  const entries = (await readdir(packsDir, {withFileTypes: true}))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
  const packs: LoadedPack[] = [];
  for (const name of entries) {
    const configPath = join(packsDir, name, 'pack.config.json');
    if (!existsSync(configPath)) continue;
    const pack = loadPackFromText(
      await readFile(configPath, 'utf8'),
      configPath,
      sources,
    );
    if (pack.packId !== name) {
      throw new BuildError(
        'AST_CONFIG_INVALID',
        `${configPath}: packId "${pack.packId}" does not match folder "${name}".`,
        2,
      );
    }
    packs.push(pack);
  }
  return packs;
}
