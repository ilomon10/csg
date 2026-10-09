/**
 * File side of the sole offset measurement (spec 011 REQ-AST-030, REQ-AST-032): reads the
 * built packs under `assets/packs`, rewrites the rig JSON and refreshes embedded rig copies.
 */
import {existsSync} from 'node:fs';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {format, resolveConfig} from 'prettier';
import {
  parseJson,
  partManifestSchema,
  rigDefinitionSchema,
} from '@csg/parts-schema';
import type {PartManifest, RigDefinition} from '@csg/parts-schema';
import {canonicalJson} from './canonical-json.js';
import {applySoleOffsets} from './sole.js';
import type {SoleSource} from './sole.js';

/** Path of a rig JSON file. */
export function rigFilePath(root: string, rigId: string): string {
  return join(root, 'packages', 'parts-schema', 'rigs', `${rigId}.json`);
}

/** Lists pack folders under `packsDir` that have a manifest, sorted. */
export async function listBuiltPacks(packsDir: string): Promise<string[]> {
  if (!existsSync(packsDir)) return [];
  return (await readdir(packsDir, {withFileTypes: true}))
    .filter(
      e =>
        e.isDirectory() && existsSync(join(packsDir, e.name, 'manifest.json')),
    )
    .map(e => e.name)
    .sort();
}

async function readManifest(
  packsDir: string,
  packId: string,
): Promise<{text: string; json: unknown; manifest: PartManifest | null}> {
  const text = await readFile(join(packsDir, packId, 'manifest.json'), 'utf8');
  const json = parseJson(text);
  if (!json.ok) return {text, json: null, manifest: null};
  const parsed = partManifestSchema.safeParse(json.value);
  return {
    text,
    json: json.value,
    manifest: parsed.success ? parsed.data : null,
  };
}

/**
 * Reads the body and feet entries of every built pack in `packsDir` that is not in `skip`
 * and uses `rigId`, with their GLB bytes. Unreadable manifests or files are skipped here;
 * `assets:check` reports them.
 */
export async function readBuiltSoleSources(
  packsDir: string,
  rigId: string,
  skip: ReadonlySet<string>,
): Promise<SoleSource[]> {
  const out: SoleSource[] = [];
  for (const packId of await listBuiltPacks(packsDir)) {
    if (skip.has(packId)) continue;
    const {manifest} = await readManifest(packsDir, packId);
    if (manifest === null) continue;
    for (const entry of manifest.parts) {
      if (
        entry.rig !== rigId ||
        (entry.slot !== 'body' && entry.slot !== 'feet')
      )
        continue;
      const abs = resolve(packsDir, packId, entry.file);
      if (!abs.startsWith(resolve(packsDir, packId) + sep)) continue;
      try {
        out.push({packId, entry, bytes: new Uint8Array(await readFile(abs))});
      } catch {
        // Missing file: reported by assets:check.
      }
    }
  }
  return out;
}

async function formatJson(path: string, text: string): Promise<string> {
  const config = (await resolveConfig(path)) ?? {};
  return format(text, {...config, parser: 'json'});
}

/**
 * Writes `soleOffsetM` into `packages/parts-schema/rigs/<rigId>.json` (key order kept, prettier
 * format) when it changed, and returns the resulting rig.
 */
export async function writeRigSoleOffsets(
  root: string,
  rig: RigDefinition,
  offsets: ReadonlyMap<string, number>,
): Promise<{rig: RigDefinition; changed: boolean}> {
  const file = rigFilePath(root, rig.id);
  const next = applySoleOffsets(rig, offsets);
  let before = '';
  let raw: Record<string, unknown> | undefined;
  try {
    before = await readFile(file, 'utf8');
    const parsed = parseJson(before);
    if (parsed.ok) raw = parsed.value as Record<string, unknown>;
  } catch {
    // New rig file: written from the parsed rig.
  }
  const base = raw ?? (rig as unknown as Record<string, unknown>);
  const groups = (base['skeletonGroups'] as Array<Record<string, unknown>>).map(
    g => {
      const {soleOffsetM: _drop, ...rest} = g;
      void _drop;
      const value = offsets.get(String(g['id']));
      return value === undefined ? rest : {...rest, soleOffsetM: value};
    },
  );
  const text = await formatJson(
    file,
    JSON.stringify({...base, skeletonGroups: groups}, null, 2),
  );
  const changed = text !== before;
  if (changed) await writeFile(file, text);
  const reparsed = rigDefinitionSchema.safeParse(JSON.parse(text));
  return {rig: reparsed.success ? reparsed.data : next, changed};
}

/**
 * Replaces the embedded copy of `rig` in the manifest of every built pack in `packs` and
 * rewrites the manifest when that copy changed (REQ-AST-030). Nothing else in the manifest moves.
 */
export async function refreshEmbeddedRigs(
  packsDir: string,
  rig: RigDefinition,
  packs: Iterable<string>,
): Promise<string[]> {
  const changed: string[] = [];
  for (const packId of packs) {
    const {text, json} = await readManifest(packsDir, packId);
    if (json === null || typeof json !== 'object') continue;
    const record = json as {rigs?: unknown};
    if (!Array.isArray(record.rigs)) continue;
    const index = record.rigs.findIndex(
      r => (r as {id?: unknown})?.id === rig.id,
    );
    if (index < 0) continue;
    const rigs = [...record.rigs];
    rigs[index] = rig;
    const next = canonicalJson({...record, rigs});
    if (next !== text) {
      await writeFile(join(packsDir, packId, 'manifest.json'), next);
      changed.push(packId);
    }
  }
  return changed;
}
