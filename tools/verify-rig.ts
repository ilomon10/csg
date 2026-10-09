/**
 * `pnpm assets:verify-rig` (spec 011 REQ-AST-003..008): verifies every skinned
 * mesh and clip in `assets-src/` against the reference skeleton and writes
 * `assets/reports/rig-report.{json,md}`. Exit codes: 0 all pass, 1 any fail,
 * 2 usage or source errors.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {parseJson} from '@csg/parts-schema';
import {readRigFile, SourceReadError} from './lib/gltf-skeleton.js';
import {checkDefaultSkeletonGroup} from './lib/check/default-group.js';
import {
  annotateSkeletonGroups,
  buildReport,
  DEFAULT_TOLERANCES,
  deriveRigDefinition,
  groupBySkeletonGroups,
  renderMarkdown,
  safeName,
  verifyFile,
} from './lib/rig-verify.js';
import type {
  RigFileData,
  RigOverlay,
  RigReportItem,
  SkeletonGroupInput,
  SkeletonData,
  Tolerances,
} from './lib/rig-verify.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface PackConfig {
  packId: string;
  name: string;
  vendorUrl: string;
  tier: string;
  dir: string;
  verifyRig: {include: string[]; exclude: string[]};
}

interface SourcesConfig {
  rig: {id: string; referencePack: string; referenceFile: string};
  packs: PackConfig[];
}

interface Options {
  packs: string[];
  src: string;
  out: string;
  tol: Tolerances;
  date?: string;
  writeCanonical: boolean;
  referenceOverride?: string;
}

class UsageError extends Error {}

/** Reads and parses a JSON file through `parseJson`; any failure is a {@link UsageError}. */
function readJsonFile<T>(path: string, label: string): T {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new UsageError(
      `${label} unreadable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const parsed = parseJson(text);
  if (!parsed.ok) {
    throw new UsageError(
      `${label} is invalid: ${parsed.issues.map(i => i.message).join('; ')}`,
    );
  }
  if (parsed.value === null || typeof parsed.value !== 'object') {
    throw new UsageError(`${label} must be a JSON object.`);
  }
  return parsed.value as T;
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    packs: [],
    src: join(REPO_ROOT, 'assets-src'),
    out: join(REPO_ROOT, 'assets/reports'),
    tol: {...DEFAULT_TOLERANCES},
    writeCanonical: false,
  };
  const num = (flag: string, v: string | undefined): number => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < 0) {
      throw new UsageError(`${flag} needs a non-negative number.`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--pack':
        if (!next) throw new UsageError('--pack needs an id.');
        o.packs.push(next);
        i++;
        break;
      case '--src':
        if (!next) throw new UsageError('--src needs a folder.');
        o.src = resolve(next);
        i++;
        break;
      case '--out':
        if (!next) throw new UsageError('--out needs a folder.');
        o.out = resolve(next);
        i++;
        break;
      case '--posM':
        o.tol.posM = num(a, next);
        i++;
        break;
      case '--rotRad':
        o.tol.rotRad = num(a, next);
        i++;
        break;
      case '--scale':
        o.tol.scale = num(a, next);
        i++;
        break;
      case '--date':
        if (!next) throw new UsageError('--date needs a value.');
        o.date = next;
        i++;
        break;
      case '--write-canonical':
        o.writeCanonical = true;
        if (next && !next.startsWith('--')) {
          o.referenceOverride = resolve(next);
          i++;
        }
        break;
      default:
        throw new UsageError(`Unknown argument: ${a}`);
    }
  }
  return o;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, {withFileTypes: true}).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(gltf|glb)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function discover(
  opts: Options,
  cfg: SourcesConfig,
): Array<{abs: string; rel: string; packId: string}> {
  const found: Array<{abs: string; rel: string; packId: string}> = [];
  for (const pack of cfg.packs) {
    if (opts.packs.length > 0 && !opts.packs.includes(pack.packId)) continue;
    const packDir = join(opts.src, pack.dir);
    if (!existsSync(packDir)) {
      throw new UsageError(
        `Pack ${pack.packId} missing: download "${pack.name}" (${pack.tier}) from ${pack.vendorUrl} and unzip it to ${packDir}`,
      );
    }
    for (const inc of pack.verifyRig.include) {
      const root = join(packDir, inc);
      if (!existsSync(root)) continue;
      for (const abs of walk(root)) {
        const rel = relative(opts.src, abs).split('\\').join('/');
        if (pack.verifyRig.exclude.some(x => rel.includes(x))) continue;
        found.push({abs, rel, packId: pack.packId});
      }
    }
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel));
}

function fmt(n: number | undefined): string {
  return n === undefined ? 'n/a' : n.toExponential(2);
}

/** Serializes JSON the way prettier formats it so `prettier --check` passes. */
async function formatJson(path: string, value: unknown): Promise<string> {
  const config = (await resolveConfig(path)) ?? {};
  return format(JSON.stringify(value, null, 2), {...config, parser: 'json'});
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = readJsonFile<SourcesConfig>(
    join(REPO_ROOT, 'tools/asset-sources.json'),
    'tools/asset-sources.json',
  );
  if (!Array.isArray(cfg.packs) || !cfg.rig) {
    throw new UsageError('tools/asset-sources.json lacks "packs" or "rig".');
  }
  const refPack = cfg.packs.find(p => p.packId === cfg.rig.referencePack);
  if (!refPack)
    throw new UsageError('Reference pack missing in asset-sources.json.');
  const refAbs =
    opts.referenceOverride ??
    join(opts.src, refPack.dir, cfg.rig.referenceFile);
  if (!existsSync(refAbs)) {
    throw new UsageError(
      `Reference file missing: ${refAbs}. Download "${refPack.name}" from ${refPack.vendorUrl} and unzip it under ${join(opts.src, refPack.dir)}`,
    );
  }
  const refRel = relative(opts.src, refAbs).split('\\').join('/');
  const refData = await readRigFile(refAbs, refRel, refPack.packId);
  if (!refData.skeleton) throw new UsageError('Reference file has no skin.');
  const ref = refData.skeleton;

  const overlayPath = join(REPO_ROOT, `tools/rigs/${cfg.rig.id}.overlay.json`);
  if (!existsSync(overlayPath)) {
    throw new UsageError(`Overlay missing: ${overlayPath}`);
  }
  const overlay = readJsonFile<RigOverlay>(
    overlayPath,
    relative(REPO_ROOT, overlayPath),
  );
  const declared: SkeletonGroupInput[] = [];
  for (const [id, rel] of Object.entries(overlay.skeletonGroups ?? {})) {
    const abs = join(opts.src, rel);
    const pack = cfg.packs.find(p => rel.startsWith(`${p.dir}/`));
    if (!pack || !existsSync(abs)) {
      throw new UsageError(
        `Skeleton group ${safeName(id)}: representative ${safeName(rel)} not found under ${opts.src}.`,
      );
    }
    const d =
      abs === refAbs ? refData : await readRigFile(abs, rel, pack.packId);
    if (!d.skeleton) {
      throw new UsageError(
        `Skeleton group ${safeName(id)}: representative has no skin.`,
      );
    }
    declared.push({id, packId: pack.packId, file: rel, skeleton: d.skeleton});
  }
  const groupError = checkDefaultSkeletonGroup(
    overlay.defaultSkeletonGroup,
    new Map(declared.map(g => [g.id, g.file])),
    refRel,
  );
  if (groupError !== null) throw new UsageError(groupError);

  const files = discover(opts, cfg);
  const items: RigReportItem[] = [];
  const skeletons: Array<{file: string; skeleton: SkeletonData}> = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    let data: RigFileData;
    try {
      data =
        f.abs === refAbs ? refData : await readRigFile(f.abs, f.rel, f.packId);
    } catch (e) {
      const msg =
        e instanceof SourceReadError ? `${e.code}: ${e.message}` : String(e);
      errors.push(`${f.rel}: ${msg}`);
      items.push({
        file: f.rel,
        packId: f.packId,
        kind: 'skinned-mesh',
        status: 'fail',
        jointCount: 0,
        missingBones: [],
        extraBones: [],
        parentMismatches: [],
        bindPose: [],
        issues: [
          {
            severity: 'error',
            code: 'AST_SOURCE_FORMAT',
            message: safeName(msg),
          },
        ],
      });
      continue;
    }
    if (data.skeleton) skeletons.push({file: f.rel, skeleton: data.skeleton});
    const rows = verifyFile(ref, data, opts.tol);
    if (rows.length === 0) skipped.push(f.rel);
    items.push(...rows);
  }

  const nodeVersion = process.version;
  const pkg = readJsonFile<{
    devDependencies?: Record<string, string>;
  }>(join(REPO_ROOT, 'tools/package.json'), 'tools/package.json');
  const grouped = groupBySkeletonGroups(
    ref,
    declared,
    overlay.defaultSkeletonGroup,
    skeletons.map(s => ({file: s.file, skeleton: s.skeleton})),
    opts.tol,
  );
  annotateSkeletonGroups(items, grouped.fileGroup, grouped.unmatched);
  const report = buildReport({
    canonicalRig: cfg.rig.id,
    tolerances: opts.tol,
    toolVersions: {
      'gltf-transform':
        pkg.devDependencies?.['@gltf-transform/core'] ?? 'unknown',
      node: nodeVersion,
      'verify-rig': '1',
    },
    referenceFile: refRel,
    skeletonGroups: grouped.groups,
    items,
  });
  await mkdir(opts.out, {recursive: true});
  await writeFile(
    join(opts.out, 'rig-report.json'),
    await formatJson(join(opts.out, 'rig-report.json'), report),
  );
  await writeFile(
    join(opts.out, 'rig-report.md'),
    renderMarkdown(report, opts.date),
  );

  // Summary.
  const meshes = report.items.filter(i => i.kind === 'skinned-mesh');
  const anims = report.items.filter(i => i.kind === 'animation');
  console.log(`verify-rig: reference ${refRel} (${ref.joints.length} joints)`);
  console.log(
    `  files scanned: ${files.length}, skinned items: ${meshes.length}, animation items: ${anims.length}, skipped (no skin/clips): ${skipped.length}`,
  );
  console.log(
    `  result: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
  );
  const byPack = new Map<string, number>();
  for (const i of meshes) byPack.set(i.packId, (byPack.get(i.packId) ?? 0) + 1);
  console.log(
    `  skinned files per pack: ${[...byPack].map(([k, v]) => `${k}=${v}`).join(', ')}`,
  );
  let worstPos = 0,
    worstRot = 0,
    worstScale = 0,
    worstRestPos = 0,
    worstRestRot = 0;
  let worstFile = '';
  let maxInfl = 0,
    maxDev = 0;
  for (const i of meshes) {
    const m = i.metrics;
    if (!m) continue;
    if ((m.worstBindPosM ?? 0) >= worstPos) {
      worstPos = m.worstBindPosM ?? 0;
      worstFile = `${i.file} @ ${m.worstBone ?? '?'}`;
    }
    worstRot = Math.max(worstRot, m.worstBindRotRad ?? 0);
    worstScale = Math.max(worstScale, m.worstBindScale ?? 0);
    worstRestPos = Math.max(worstRestPos, m.worstRestPosM ?? 0);
    worstRestRot = Math.max(worstRestRot, m.worstRestRotRad ?? 0);
    maxInfl = Math.max(maxInfl, m.weights?.maxInfluences ?? 0);
    maxDev = Math.max(maxDev, m.weights?.maxSumDeviation ?? 0);
  }
  const h = meshes.find(i => i.file === refRel)?.metrics?.skeletonHeightM ?? 0;
  console.log(`  skeleton height (reference): ${h.toFixed(4)} m`);
  console.log(
    `  worst bind-pose delta: pos ${fmt(worstPos)} m (${fmt(h > 0 ? worstPos / h : 0)} of height), rot ${fmt(worstRot)} rad (${fmt((worstRot * 180) / Math.PI)} deg), scale ${fmt(worstScale)}; worst at ${worstFile}`,
  );
  console.log(
    `  worst rest-pose delta: pos ${fmt(worstRestPos)} m, rot ${fmt(worstRestRot)} rad`,
  );
  console.log(
    `  max influences/vertex: ${maxInfl}, max weight-sum deviation: ${fmt(maxDev)}`,
  );
  for (const i of report.items.filter(x => x.status !== 'pass')) {
    console.log(`  ${i.status.toUpperCase()} ${i.file} [${i.kind}]`);
    for (const x of i.issues.filter(y => y.severity !== 'info').slice(0, 5)) {
      console.log(`    ${x.severity} ${x.code}: ${x.message}`);
    }
  }
  for (const g of report.skeletonGroups) {
    console.log(
      `  ${g.id}${g.isReference ? ' (reference)' : ''}: ${g.files.length} file(s), vs reference ${g.vsReference.bonesOverTolerance} bones over tol, max ${fmt(g.vsReference.maxPosM)} m (${(g.vsReference.maxPosHeightFraction * 100).toFixed(2)} % of height), ${g.vsReference.maxRotDeg.toFixed(1)} deg; e.g. ${safeName(g.files[0] ?? '')}`,
    );
  }
  for (const u of grouped.unmatched) {
    console.log(
      `  WARN AST_SKELETON_GROUP_UNMATCHED ${safeName(u.file)}${u.matches.length > 0 ? ` (matches ${u.matches.join(', ')})` : ''}`,
    );
  }
  console.log(`  OUTCOME: ${report.outcome}`);
  console.log(
    `  report: ${relative(REPO_ROOT, join(opts.out, 'rig-report.md'))}`,
  );

  if (opts.writeCanonical) {
    // REQ-AST-005 derives the rig from the reference file. Names, hierarchy
    // and length axis must agree everywhere; bind poses may differ (mapped).
    if (report.outcome === 'fallback') {
      console.error(
        'verify-rig: --write-canonical refused: outcome is "fallback".',
      );
      return 1;
    }
    const {rig, errors: rigErrors} = deriveRigDefinition(
      cfg.rig.id,
      ref,
      overlay,
      declared,
      opts.tol,
    );
    if (!rig) {
      for (const e of rigErrors) console.error(`  overlay error: ${e}`);
      return 1;
    }
    const target = join(
      REPO_ROOT,
      `packages/parts-schema/rigs/${cfg.rig.id}.json`,
    );
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, await formatJson(target, rig));
    console.log(
      `  canonical rig: ${relative(REPO_ROOT, target)} (${rig.bones.length} bones, lengthAxis ${rig.lengthAxis}, root ${rig.rootBone}, ${rig.skeletonGroups.length} skeleton groups)`,
    );
  }
  if (errors.length > 0) return 1;
  return report.summary.fail > 0 ? 1 : 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  e => {
    if (e instanceof UsageError) {
      console.error(`verify-rig: ${e.message}`);
      process.exitCode = 2;
    } else {
      console.error(e);
      process.exitCode = 2;
    }
  },
);
