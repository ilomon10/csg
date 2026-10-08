/**
 * File edge of `pnpm assets:licenses`: reads manifests, regenerates the
 * bundled section of `ASSETS_LICENSE.md` (spec 011 REQ-AST-018).
 */
import {existsSync} from 'node:fs';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  parseClipManifest,
  parseJson,
  parsePartManifest,
} from '@csg/parts-schema';
import {
  applyLicensesSection,
  diffLines,
  extractLicensesSection,
  renderLicensesSection,
} from './licenses-md.js';
import type {LicensePack} from './licenses-md.js';

/** Reads every pack manifest under `packsDir` (sorted); invalid manifests throw. */
export async function readLicensePacks(
  packsDir: string,
): Promise<LicensePack[]> {
  if (!existsSync(packsDir)) return [];
  const packs: LicensePack[] = [];
  const dirs = (await readdir(packsDir, {withFileTypes: true}))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
  for (const dir of dirs) {
    const manifestPath = join(packsDir, dir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    const raw = parseJson(await readFile(manifestPath, 'utf8'));
    if (!raw.ok)
      throw new Error(`${dir}/manifest.json: ${raw.issues[0]?.message}`);
    const manifest = parsePartManifest(raw.value);
    if (!manifest.ok) {
      throw new Error(`${dir}/manifest.json: ${manifest.issues[0]?.message}`);
    }
    let clips: LicensePack['clips'] = [];
    const clipsPath = join(packsDir, dir, 'clips.json');
    if (existsSync(clipsPath)) {
      const cr = parseJson(await readFile(clipsPath, 'utf8'));
      const cm = cr.ok ? parseClipManifest(cr.value) : null;
      if (!cm?.ok) throw new Error(`${dir}/clips.json is invalid`);
      clips = cm.value.clips;
    }
    packs.push({
      packId: manifest.value.packId,
      name: manifest.value.name,
      license: manifest.value.license,
      parts: manifest.value.parts,
      clips,
    });
  }
  return packs;
}

/** Outcome of {@link syncLicenses}. */
export interface SyncResult {
  changed: boolean;
  /** `+`/`-` lines when `changed`. */
  diff: string[];
}

/**
 * Regenerates the bundled section of the license file.
 *
 * @param write when false (`--check`), only reports whether the file differs.
 */
export async function syncLicenses(
  packsDir: string,
  licenseFile: string,
  write: boolean,
): Promise<SyncResult> {
  const packs = await readLicensePacks(packsDir);
  const current = existsSync(licenseFile)
    ? await readFile(licenseFile, 'utf8')
    : '';
  if (packs.length === 0 && extractLicensesSection(current) === null) {
    return {changed: false, diff: []};
  }
  const section = renderLicensesSection(packs);
  const next = applyLicensesSection(current, section);
  if (next === current) return {changed: false, diff: []};
  const diff = diffLines(section, extractLicensesSection(current) ?? '');
  if (write) await writeFile(licenseFile, next);
  return {changed: true, diff};
}
