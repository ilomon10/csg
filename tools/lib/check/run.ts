/**
 * Orchestration of `pnpm assets:check` (spec 011 REQ-AST-020). Reads built
 * packs from disk (never `assets-src/`) and applies the pure checks of this
 * folder. Everything read from disk is untrusted: JSON goes through
 * `parseJson`, file paths are confined to the pack folder.
 */
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {
  parseClipManifest,
  parseJson,
  parsePackConfig,
  parsePartManifest,
  rigDefinitionSchema,
  validatePartsAgainstRig,
} from '@csg/parts-schema';
import type {
  ClipManifest,
  PartEntry,
  PartManifest,
  RigDefinition,
} from '@csg/parts-schema';
import {checkClipTargets, safeName, verifyBuiltPart} from '../rig-verify.js';
import type {RigFileData, RigIssue} from '../rig-verify.js';
import {checkDefaultSetSize, checkPartBudgets} from './budgets.js';
import {measureDefaultSet} from './default-set.js';
import {BuiltReadError, inspectBuiltGlb} from './built-glb.js';
import type {BuiltGlbInfo} from './built-glb.js';
import {checkIds, parseRetiredIds} from './ids.js';
import type {RetiredIds} from './ids.js';
import {checkLicenses} from './licenses.js';
import {
  diffLines,
  extractLicensesSection,
  renderLicensesSection,
} from './licenses-md.js';
import type {LicensePack} from './licenses-md.js';
import {findOrphans} from './orphans.js';
import {checkManifestFresh} from './stale.js';
import {checkPackPresets, checkPresetReferences} from './presets.js';
import type {PackPresets} from './presets.js';
import {checkSoleOffsets} from './sole.js';
import {checkThumbnails} from './thumbnails.js';
import {THUMBNAIL_INDEX_PATH} from '../thumbnails/index-file.js';
import type {CheckIssue, CheckReport} from './types.js';

/** Where `assets:check` reads from. All paths absolute. */
export interface CheckOptions {
  /** `assets/packs`. */
  packsDir: string;
  /** `tools/packs` (`<packId>/pack.config.json`). */
  configsDir: string;
  /** `packages/parts-schema/rigs` (`<rigId>.json`). */
  rigsDir: string;
  /** `ASSETS_LICENSE.md`; when set and packs exist, the generated section must match. */
  licenseFile?: string;
  /** Ids of the last committed manifest of a pack (git baseline); default none. */
  previousIds?: (packId: string, kind: 'part' | 'clip') => Promise<string[]>;
}

const PACK_ID = /^[a-z0-9-]{1,64}$/;

async function readJson(
  path: string,
): Promise<{ok: true; value: unknown} | {ok: false; message: string}> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return {ok: false, message: 'cannot read file'};
  }
  const parsed = parseJson(text);
  if (parsed.ok) return {ok: true, value: parsed.value};
  return {ok: false, message: parsed.issues.map(i => i.message).join('; ')};
}

async function walk(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(dir, {withFileTypes: true})).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory())
      out.push(...(await walk(join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toCheck(issue: RigIssue, packId: string, id: string): CheckIssue {
  return {
    severity: issue.severity,
    code: issue.code,
    packId,
    id,
    message: `${id}: ${issue.message}`,
  };
}

/** Reads a pack-relative file, confined to the pack folder and never a symlink. */
async function readPackFile(
  packDir: string,
  rel: string,
): Promise<{ok: true; bytes: Uint8Array} | {ok: false; message: string}> {
  const abs = resolve(packDir, rel);
  if (!abs.startsWith(packDir + sep)) {
    return {ok: false, message: 'path escapes the pack folder'};
  }
  try {
    const st = await lstat(abs);
    if (!st.isFile()) return {ok: false, message: 'not a regular file'};
    return {ok: true, bytes: new Uint8Array(await readFile(abs))};
  } catch {
    return {ok: false, message: 'file is missing'};
  }
}

interface PackContext {
  packId: string;
  packDir: string;
  issues: CheckIssue[];
  add: (issue: CheckIssue) => void;
}

async function checkParts(
  ctx: PackContext,
  manifest: PartManifest,
  referenced: Set<string>,
  glbBytes: {total: number},
): Promise<void> {
  const rigs = new Map(manifest.rigs.map(r => [r.id, r]));
  for (const part of manifest.parts) {
    referenced.add(part.file);
    if (part.thumbnail !== undefined) referenced.add(part.thumbnail);
    const read = await readPackFile(ctx.packDir, part.file);
    if (!read.ok) {
      ctx.add({
        severity: 'error',
        code: 'AST_FILE_MISSING',
        packId: ctx.packId,
        id: part.id,
        message: `${part.id}: ${part.file} ${read.message}.`,
      });
      continue;
    }
    glbBytes.total += read.bytes.byteLength;
    if (sha256(read.bytes) !== part.sha256) {
      ctx.add({
        severity: 'error',
        code: 'AST_HASH_MISMATCH',
        packId: ctx.packId,
        id: part.id,
        message: `${part.id}: sha256 of ${part.file} differs from manifest.json. Rebuild with pnpm assets:build.`,
      });
    }
    let info: BuiltGlbInfo;
    try {
      info = await inspectBuiltGlb(read.bytes);
    } catch (e) {
      ctx.add({
        severity: 'error',
        code: 'AST_SOURCE_FORMAT',
        packId: ctx.packId,
        id: part.id,
        message: `${part.id}: ${part.file}: ${e instanceof BuiltReadError ? e.message : 'unreadable'}.`,
      });
      continue;
    }
    for (const issue of checkPartBudgets(
      {packId: ctx.packId, id: part.id, kind: part.kind, slot: part.slot},
      {
        triangles: info.triangles,
        textures: info.textures,
        maxInfluences: info.weights?.maxInfluences ?? 0,
      },
    )) {
      ctx.add(issue);
    }
    if (
      part.stats.triangles !== info.triangles ||
      part.stats.textures !== info.textures
    ) {
      ctx.add({
        severity: 'error',
        code: 'AST_MANIFEST_STALE',
        packId: ctx.packId,
        id: part.id,
        message: `${part.id}: manifest stats (${part.stats.triangles} triangles, ${part.stats.textures} textures) differ from the file (${info.triangles}, ${info.textures}). Do not edit manifest.json by hand: edit tools/packs/${ctx.packId}/pack.config.json and run pnpm assets:build.`,
      });
    }
    if (part.slot === 'body') {
      if (!info.hasRegion) {
        ctx.add({
          severity: 'error',
          code: 'AST_REGION_INVALID',
          packId: ctx.packId,
          id: part.id,
          message: `${part.id}: body has no _REGION attribute.`,
        });
      } else if (info.regionInvalidVertices > 0) {
        ctx.add({
          severity: 'error',
          code: 'AST_REGION_INVALID',
          packId: ctx.packId,
          id: part.id,
          message: `${part.id}: ${info.regionInvalidVertices} vertices hold an invalid _REGION value (valid 0..10).`,
        });
      }
    }
    if (part.kind === 'skinned') {
      verifySkinned(ctx, part, rigs.get(part.rig ?? ''), info);
    }
  }
}

function verifySkinned(
  ctx: PackContext,
  part: PartEntry,
  rig: RigDefinition | undefined,
  info: BuiltGlbInfo,
): void {
  if (!rig) return; // validatePartsAgainstRig reports a missing rig.
  const group = part.skeletonGroup ?? rig.defaultSkeletonGroup;
  const data: RigFileData = {
    file: part.file,
    packId: ctx.packId,
    skeleton: info.skeleton,
    weights: info.weights,
    clips: null,
  };
  const result = verifyBuiltPart(rig, group, data);
  for (const issue of result.issues) {
    // Own budget check already reports influences; quantized weights drift by < 1e-2.
    if (issue.code === 'AST_BUDGET_INFLUENCES') continue;
    if (
      issue.code === 'AST_WEIGHTS_UNNORMALIZED' &&
      issue.severity !== 'error'
    ) {
      continue;
    }
    if (issue.severity === 'info') continue;
    ctx.add(toCheck(issue, ctx.packId, part.id));
  }
  // A file in another group than the reference is a bind-pose warning naming
  // its group (REQ-AST-026, AC-AST-026.1); never an error.
  if (result.ok && group !== rig.defaultSkeletonGroup) {
    const vsReference = verifyBuiltPart(rig, rig.defaultSkeletonGroup, data);
    const deltas = vsReference.items[0]?.bindPose ?? [];
    if (deltas.length > 0) {
      const order = new Map(rig.bones.map((b, i) => [b, i]));
      const first = deltas
        .slice()
        .sort((a, b) => (order.get(a.bone) ?? 0) - (order.get(b.bone) ?? 0))
        .slice(0, 5)
        .map(d => safeName(d.bone))
        .join(', ');
      ctx.add({
        severity: 'warn',
        code: 'AST_BIND_POSE_DIFFERS',
        packId: ctx.packId,
        id: part.id,
        message: `${part.id}: skeleton group ${safeName(group)} differs from reference group ${safeName(rig.defaultSkeletonGroup)} on ${deltas.length} bone(s), first in hierarchy order: ${first}.`,
      });
    }
  }
}

async function checkClips(
  ctx: PackContext,
  clips: ClipManifest,
  rig: RigDefinition | undefined,
  rigId: string,
  referenced: Set<string>,
  glbBytes: {total: number},
): Promise<void> {
  const canonical = new Set(rig?.bones ?? []);
  for (const clip of clips.clips) {
    referenced.add(clip.file);
    if (clip.rig !== rigId) {
      ctx.add({
        severity: 'error',
        code: 'AST_RIG_MISMATCH',
        packId: ctx.packId,
        id: clip.id,
        message: `${clip.id}: clip rig "${clip.rig}" is not the pack rig "${rigId}".`,
      });
    }
    if (rig && !rig.skeletonGroups.some(g => g.id === clip.skeletonGroup)) {
      ctx.add({
        severity: 'error',
        code: 'AST_RIG_MISMATCH',
        packId: ctx.packId,
        id: clip.id,
        message: `${clip.id}: unknown skeleton group "${safeName(clip.skeletonGroup)}" in rig "${rigId}".`,
      });
    }
    const read = await readPackFile(ctx.packDir, clip.file);
    if (!read.ok) {
      ctx.add({
        severity: 'error',
        code: 'AST_FILE_MISSING',
        packId: ctx.packId,
        id: clip.id,
        message: `${clip.id}: ${clip.file} ${read.message}.`,
      });
      continue;
    }
    glbBytes.total += read.bytes.byteLength;
    if (sha256(read.bytes) !== clip.sha256) {
      ctx.add({
        severity: 'error',
        code: 'AST_HASH_MISMATCH',
        packId: ctx.packId,
        id: clip.id,
        message: `${clip.id}: sha256 of ${clip.file} differs from clips.json. Rebuild with pnpm assets:build.`,
      });
    }
    let info: BuiltGlbInfo;
    try {
      info = await inspectBuiltGlb(read.bytes);
    } catch (e) {
      ctx.add({
        severity: 'error',
        code: 'AST_SOURCE_FORMAT',
        packId: ctx.packId,
        id: clip.id,
        message: `${clip.id}: ${clip.file}: ${e instanceof BuiltReadError ? e.message : 'unreadable'}.`,
      });
      continue;
    }
    if (!info.clips) {
      ctx.add({
        severity: 'error',
        code: 'AST_RIG_MISMATCH',
        packId: ctx.packId,
        id: clip.id,
        message: `${clip.id}: ${clip.file} holds no animation.`,
      });
    } else if (rig) {
      for (const issue of checkClipTargets(canonical, info.clips).issues) {
        if (issue.severity !== 'info')
          ctx.add(toCheck(issue, ctx.packId, clip.id));
      }
    }
  }
}

async function readPack(
  opts: CheckOptions,
  packId: string,
  report: CheckIssue[],
  glbBytes: {total: number},
  presetsOut: PackPresets[],
): Promise<LicensePack | null> {
  const packDir = resolve(opts.packsDir, packId);
  const ctx: PackContext = {
    packId,
    packDir,
    issues: report,
    add: i => report.push(i),
  };
  const fail = (
    code: string,
    message: string,
    severity: 'error' | 'warn' = 'error',
  ) => ctx.add({severity, code, packId, message});

  const manifestJson = await readJson(join(packDir, 'manifest.json'));
  if (!manifestJson.ok) {
    fail('AST_MANIFEST_INVALID', `manifest.json: ${manifestJson.message}.`);
    return null;
  }
  for (const i of checkLicenses(manifestJson.value, packId)) ctx.add(i);
  const parsedManifest = parsePartManifest(manifestJson.value);
  if (!parsedManifest.ok) {
    for (const i of parsedManifest.issues) {
      fail('AST_MANIFEST_INVALID', `manifest.json: ${i.message}`);
    }
    return null;
  }
  const manifest = parsedManifest.value;
  if (manifest.packId !== packId) {
    fail(
      'AST_MANIFEST_INVALID',
      `manifest.json packId "${safeName(manifest.packId)}" differs from its folder.`,
    );
  }

  let clips: ClipManifest | undefined;
  let clipsJson: unknown;
  if (existsSync(join(packDir, 'clips.json'))) {
    const cj = await readJson(join(packDir, 'clips.json'));
    if (!cj.ok) {
      fail('AST_MANIFEST_INVALID', `clips.json: ${cj.message}.`);
    } else {
      clipsJson = cj.value;
      for (const i of checkLicenses(cj.value, packId)) ctx.add(i);
      const pc = parseClipManifest(cj.value);
      if (pc.ok) clips = pc.value;
      else
        for (const i of pc.issues)
          fail('AST_MANIFEST_INVALID', `clips.json: ${i.message}`);
    }
  }

  // Config: the manifest is generated from it (AC-AST-013.2).
  const configJson = await readJson(
    join(opts.configsDir, packId, 'pack.config.json'),
  );
  let configIds = {parts: [] as string[], clips: [] as string[]};
  let rigId = manifest.rigs[0]?.id ?? '';
  let configOk = false;
  let canonicalRig: unknown;
  if (!configJson.ok) {
    fail(
      'AST_CONFIG_MISSING',
      `tools/packs/${packId}/pack.config.json: ${configJson.message}; the manifest cannot be verified.`,
    );
  } else {
    for (const i of checkLicenses(configJson.value, packId)) ctx.add(i);
    const pc = parsePackConfig(configJson.value);
    if (!pc.ok) {
      for (const i of pc.issues)
        fail('AST_CONFIG_INVALID', `pack.config.json: ${i.message}`);
    } else {
      const config = pc.value;
      configOk = true;
      rigId = config.rig;
      configIds = {
        parts: config.parts.map(p => p.id),
        clips: config.clips.map(c => c.id),
      };
      const rigRead = await readJson(join(opts.rigsDir, `${config.rig}.json`));
      if (rigRead.ok) canonicalRig = rigRead.value;
      else
        fail(
          'AST_RIG_MISSING',
          `packages/parts-schema/rigs/${safeName(config.rig)}.json: ${rigRead.message}.`,
        );
      for (const i of checkManifestFresh({
        packId,
        config: configJson.value,
        manifest: manifestJson.value,
        clips: clipsJson,
        canonicalRig,
      })) {
        ctx.add(i);
      }
    }
  }

  // Rig and skeleton groups.
  let rig: RigDefinition | undefined;
  if (canonicalRig !== undefined) {
    const parsed = rigDefinitionSchema.safeParse(canonicalRig);
    if (parsed.success) rig = parsed.data;
    else
      fail(
        'AST_RIG_INVALID',
        `rigs/${safeName(rigId)}.json does not validate: ${parsed.error.issues[0]?.message ?? 'invalid'}.`,
      );
  }
  const rigCheck = validatePartsAgainstRig(manifest, rig);
  if (!rigCheck.ok) {
    for (const i of rigCheck.issues) fail('AST_RIG_MISMATCH', i.message);
  }
  const embedded = manifest.rigs.find(r => r.id === rigId) ?? manifest.rigs[0];

  const referenced = new Set<string>();
  await checkParts(ctx, manifest, referenced, glbBytes);
  if (clips) {
    await checkClips(ctx, clips, rig ?? embedded, rigId, referenced, glbBytes);
  }

  presetsOut.push({
    ...(await checkPackPresets({
      packId,
      packDir,
      configsDir: opts.configsDir,
      referenced,
      add: i => report.push(i),
    })),
    parts: manifest.parts,
  });

  // Thumbnails (warning only). The generated thumbnail index is referenced when present.
  if (existsSync(join(packDir, THUMBNAIL_INDEX_PATH)))
    referenced.add(THUMBNAIL_INDEX_PATH);
  for (const part of manifest.parts) {
    const thumb = part.thumbnail;
    if (thumb === undefined || !existsSync(join(packDir, thumb))) {
      ctx.add({
        severity: 'warn',
        code: 'AST_THUMBNAIL_MISSING',
        packId,
        id: part.id,
        message: `${part.id}: thumbnail is missing (run pnpm assets:thumbnails).`,
      });
    }
  }

  // Orphans (symlinks are reported, never followed).
  const files = await walk(packDir);
  const symlinks: string[] = [];
  for (const f of files) {
    if ((await lstat(join(packDir, f))).isSymbolicLink()) symlinks.push(f);
  }
  for (const i of findOrphans(packId, files, referenced)) ctx.add(i);
  for (const f of symlinks) {
    if (referenced.has(f)) {
      fail(
        'AST_ORPHAN_FILE',
        `${f} is a symbolic link; packs hold regular files only.`,
      );
    }
  }

  // ID stability.
  let retired: RetiredIds = {
    parts: new Set<string>(),
    clips: new Set<string>(),
  };
  const retiredPath = join(packDir, 'retired-ids.json');
  if (existsSync(retiredPath)) {
    const rj = await readJson(retiredPath);
    const parsed = rj.ok ? parseRetiredIds(rj.value) : null;
    if (parsed?.ok) retired = parsed.value;
    else
      fail(
        'AST_RETIRED_IDS_INVALID',
        `retired-ids.json: ${rj.ok ? (parsed as {message: string}).message : rj.message}.`,
      );
  }
  const previous = opts.previousIds ?? (async () => []);
  if (configOk) {
    for (const [kind, ids, manifestIds] of [
      ['part', configIds.parts, manifest.parts.map(p => p.id)],
      ['clip', configIds.clips, clips?.clips.map(c => c.id) ?? []],
    ] as const) {
      for (const i of checkIds({
        packId,
        kind,
        configIds: ids,
        manifestIds,
        previousIds: await previous(packId, kind),
        retired: kind === 'part' ? retired.parts : retired.clips,
      })) {
        ctx.add(i);
      }
    }
  }

  return {
    packId,
    name: manifest.name,
    license: manifest.license,
    parts: manifest.parts,
    clips: clips?.clips ?? [],
  };
}

/** Runs every check of REQ-AST-020 over the built packs. */
export async function runAssetCheck(opts: CheckOptions): Promise<CheckReport> {
  const issues: CheckIssue[] = [];
  const glbBytes = {total: 0};
  const packs: string[] = [];
  const licensePacks: LicensePack[] = [];
  const presetPacks: PackPresets[] = [];
  const rigIds = new Set<string>();
  let dirs: string[] = [];
  if (existsSync(opts.packsDir)) {
    dirs = (await readdir(opts.packsDir, {withFileTypes: true}))
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();
  }
  for (const packId of dirs) {
    if (!PACK_ID.test(packId)) {
      issues.push({
        severity: 'error',
        code: 'AST_ORPHAN_FILE',
        message: `assets/packs/${safeName(packId)} is not a valid pack id folder.`,
      });
      continue;
    }
    const files = await walk(join(opts.packsDir, packId));
    if (files.length === 0) continue;
    if (!files.includes('manifest.json')) {
      issues.push({
        severity: 'error',
        code: 'AST_MANIFEST_INVALID',
        packId,
        message: `assets/packs/${packId} has no manifest.json.`,
      });
      continue;
    }
    packs.push(packId);
    const lp = await readPack(opts, packId, issues, glbBytes, presetPacks);
    if (lp) licensePacks.push(lp);
  }

  // Cross-pack rules: preset references (REQ-UX-103) and sole offsets (REQ-AST-032).
  const partsByRef = new Map<string, PartEntry>();
  for (const pack of presetPacks) {
    for (const part of pack.parts) {
      partsByRef.set(`builtin:${pack.packId}/${part.id}`, part);
      if (part.rig !== undefined) rigIds.add(part.rig);
    }
  }
  checkPresetReferences(presetPacks, partsByRef, i => issues.push(i));
  // Stale or invalid thumbnails (REQ-AST-015, REQ-AST-039; warnings).
  issues.push(...(await checkThumbnails(opts.packsDir)));
  issues.push(
    ...(await checkSoleOffsets({
      packsDir: opts.packsDir,
      rigsDir: opts.rigsDir,
      rigIds,
    })),
  );

  const defaultSizes = await measureDefaultSet(opts.packsDir, licensePacks);
  if (defaultSizes) issues.push(...checkDefaultSetSize(defaultSizes));

  if (opts.licenseFile !== undefined && licensePacks.length > 0) {
    const expected = renderLicensesSection(licensePacks);
    const text = existsSync(opts.licenseFile)
      ? await readFile(opts.licenseFile, 'utf8')
      : '';
    const actual = extractLicensesSection(text);
    if (actual !== expected) {
      const diff = diffLines(expected, actual ?? '');
      issues.push({
        severity: 'error',
        code: 'AST_LICENSES_STALE',
        message: `ASSETS_LICENSE.md bundled section is out of date; run pnpm assets:licenses.\n${diff
          .slice(0, 20)
          .map(l => `    ${l}`)
          .join('\n')}`,
      });
    }
  }
  return {packs, issues, totalGlbBytes: glbBytes.total};
}
