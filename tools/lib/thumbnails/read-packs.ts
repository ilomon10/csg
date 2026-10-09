/**
 * Reads the built packs into {@link PlanPack}s for the thumbnail plan (I/O only). Missing or
 * invalid files are skipped: `assets:check` reports them with its own codes.
 */
import {existsSync} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  parseClipManifest,
  parseJson,
  parsePartManifest,
  presetIndexSchema,
} from '@csg/parts-schema';
import type {PlanPack, PlanPreset} from './jobs.js';

const PACK_ID = /^[a-z0-9-]{1,64}$/;

async function readJson(path: string): Promise<unknown> {
  try {
    const parsed = parseJson(await readFile(path, 'utf8'));
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads one built pack; `null` without a valid manifest. */
export async function readPlanPack(
  packsDir: string,
  packId: string,
): Promise<PlanPack | null> {
  const dir = join(packsDir, packId);
  const manifest = parsePartManifest(
    await readJson(join(dir, 'manifest.json')),
  );
  if (!manifest.ok) return null;
  let clips: PlanPack['clips'];
  if (existsSync(join(dir, 'clips.json'))) {
    const parsed = parseClipManifest(await readJson(join(dir, 'clips.json')));
    if (parsed.ok) clips = parsed.value.clips;
  }
  const presets: PlanPreset[] = [];
  const index = presetIndexSchema.safeParse(
    await readJson(join(dir, 'presets', 'index.json')),
  );
  if (index.success) {
    for (const entry of index.data.files) {
      if (entry.path.includes('..')) continue;
      const json = await readJson(join(dir, entry.path));
      if (json !== undefined) presets.push({kind: entry.kind, json});
    }
  }
  return {
    packId,
    parts: manifest.value.parts,
    rigs: manifest.value.rigs,
    ...(clips === undefined ? {} : {clips}),
    presets,
  };
}

/** Reads every built pack under `packsDir`, sorted by ID. */
export async function readPlanPacks(packsDir: string): Promise<PlanPack[]> {
  if (!existsSync(packsDir)) return [];
  const ids = (await readdir(packsDir, {withFileTypes: true}))
    .filter(e => e.isDirectory() && PACK_ID.test(e.name))
    .map(e => e.name)
    .sort();
  const out: PlanPack[] = [];
  for (const id of ids) {
    const pack = await readPlanPack(packsDir, id);
    if (pack !== null) out.push(pack);
  }
  return out;
}
