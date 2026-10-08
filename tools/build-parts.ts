/**
 * `pnpm assets:build` (spec 011). M1-11 wires stages 1-2 (config, source check, split); later
 * stages are hook points completed by M1-16. Exit codes: 0 ok, 1 build failure, 2 usage or
 * source problems.
 */
import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import type {Document} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptEncoder} from 'meshoptimizer';
import {parseJson, rigDefinitionSchema} from '@csg/parts-schema';
import type {RigDefinition} from '@csg/parts-schema';
import {loadPackConfigs} from './lib/build/config.js';
import {checkSources} from './lib/build/sources.js';
import {splitPack} from './lib/build/split.js';
import {emitPack} from './lib/build/emit.js';
import {limitInfluences} from './lib/build/influences.js';
import {normalizeDocument} from './lib/build/normalize.js';
import {optimizeDocument} from './lib/build/optimize.js';
import {enforceTextureBudget} from './lib/build/textures.js';
import {writeRegions} from './lib/build/region.js';
import {classifySkeleton} from './lib/build/skeleton.js';
import {BuildError} from './lib/build/types.js';
import type {
  BuildContext,
  BuildWarning,
  BuiltClipInput,
  BuiltPartInput,
  LoadedPack,
} from './lib/build/types.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Parsed command line. */
export interface BuildOptions {
  packs: string[];
  src: string;
  out: string;
  /** Repo root holding `tools/packs` and `tools/asset-sources.json`. */
  root: string;
}

/** Parses `--pack <id>` (repeatable), `--src <dir>`, `--out <dir>`, `--root <dir>`. */
export function parseArgs(
  argv: readonly string[],
  root = REPO_ROOT,
): BuildOptions {
  const o: BuildOptions = {
    packs: [],
    src: join(root, 'assets-src'),
    out: join(root, 'assets', 'packs'),
    root,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      flag !== '--pack' &&
      flag !== '--src' &&
      flag !== '--out' &&
      flag !== '--root'
    ) {
      throw new BuildError('AST_USAGE', `unknown argument "${flag}".`, 2);
    }
    if (value === undefined)
      throw new BuildError('AST_USAGE', `${flag} needs a value.`, 2);
    i++;
    if (flag === '--pack') o.packs.push(value);
    else if (flag === '--src') o.src = resolve(value);
    else if (flag === '--out') o.out = resolve(value);
    else {
      o.root = resolve(value);
    }
  }
  return o;
}

/** Per-file size cap and total cap of `assets/packs` (plan §5 R1). */
/**
 * Texture sides used for bundled output, below the REQ-AST-010 maxima (1024 / 512) to keep the
 * repo within the 30 MB budget (plan §5 R1); sprites are rendered at pixel-art resolution.
 */
const BODY_TEXTURE_PX = 512;
const PART_TEXTURE_PX = 256;
const MAX_FILE_BYTES = 3 * 1024 * 1024;

async function loadRig(root: string, rigId: string): Promise<RigDefinition> {
  const file = join(root, 'packages', 'parts-schema', 'rigs', `${rigId}.json`);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new BuildError(
      'AST_RIG_MISSING',
      `rig "${rigId}" not found at packages/parts-schema/rigs/${rigId}.json.`,
      2,
    );
  }
  const json = parseJson(text);
  if (!json.ok) {
    throw new BuildError(
      'AST_RIG_INVALID',
      `rig "${rigId}": ${json.issues.map(i => i.message).join('; ')}`,
      2,
    );
  }
  const rig = rigDefinitionSchema.safeParse(json.value);
  if (!rig.success) {
    const lines = rig.error.issues.map(
      i => `  - ${i.path.join('.')}: ${i.message}`,
    );
    throw new BuildError(
      'AST_RIG_INVALID',
      `rig "${rigId}" does not match the RigDefinition schema:\n${lines.join('\n')}`,
      2,
    );
  }
  return rig.data;
}

function countTriangles(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += Math.floor((idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3);
    }
  }
  return n;
}

/** Duration (max keyframe time) and whether the root bone travels horizontally. */
function clipStats(
  doc: Document,
  rootBone: string,
): {durationSec: number; hasRootMotion: boolean} {
  let duration = 0;
  let rootMotion = false;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      const s = ch.getSampler();
      const input = s?.getInput();
      const output = s?.getOutput();
      if (!s || !input || !output) continue;
      const count = input.getCount();
      if (count > 0) duration = Math.max(duration, input.getScalar(count - 1));
      if (
        ch.getTargetPath() === 'translation' &&
        ch.getTargetNode()?.getName() === rootBone &&
        count > 1
      ) {
        const first = output.getElement(0, []);
        const v: number[] = [];
        for (let k = 1; k < count; k++) {
          output.getElement(k, v);
          if (
            Math.abs((v[0] ?? 0) - (first[0] ?? 0)) > 1e-3 ||
            Math.abs((v[2] ?? 0) - (first[2] ?? 0)) > 1e-3
          ) {
            rootMotion = true;
          }
        }
      }
    }
  }
  return {
    durationSec: Math.round(duration * 1e6) / 1e6,
    hasRootMotion: rootMotion,
  };
}

async function serialize(doc: Document): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({'meshopt.encoder': MeshoptEncoder});
  return io.writeBinary(doc);
}

/** Result of {@link runBuildDetailed}. */
export interface BuildResult {
  summary: string;
  warnings: BuildWarning[];
  packs: Array<{packId: string; parts: number; clips: number; bytes: number}>;
}

/** Groups warnings by code into summary lines. */
export function summarizeWarnings(warnings: readonly BuildWarning[]): string[] {
  const by = new Map<string, BuildWarning[]>();
  for (const w of warnings) by.set(w.code, [...(by.get(w.code) ?? []), w]);
  const lines: string[] = [];
  for (const code of [...by.keys()].sort()) {
    const list = by.get(code)!;
    lines.push(`warn ${code} x${list.length}`);
    for (const w of list.slice(0, 5)) lines.push(`  - ${w.message}`);
    if (list.length > 5) lines.push(`  ... ${list.length - 5} more`);
  }
  return lines;
}

/** Runs every stage over the selected packs and writes `assets/packs`. */
export async function runBuildDetailed(
  opts: BuildOptions,
): Promise<BuildResult> {
  const all = await loadPackConfigs(opts.root);
  let packs: LoadedPack[] = all;
  if (opts.packs.length > 0) {
    packs = opts.packs.map(id => {
      const p = all.find(x => x.packId === id);
      if (!p)
        throw new BuildError(
          'AST_USAGE',
          `no tools/packs/${id}/pack.config.json.`,
          2,
        );
      return p;
    });
  }
  if (packs.length === 0) {
    return {
      summary: 'build-parts: no pack configs found in tools/packs/.',
      warnings: [],
      packs: [],
    };
  }
  const ctx: BuildContext = {
    srcRoot: opts.src,
    outRoot: opts.out,
    warnings: [],
  };
  const lines: string[] = [];
  const stats: BuildResult['packs'] = [];
  for (const pack of packs) {
    const [check] = await checkSources([pack], ctx.srcRoot);
    const rig = await loadRig(opts.root, pack.config.rig);
    const rootBone = rig.bones.find(b => rig.parents[b] === null) ?? 'root';
    const items = await splitPack(pack, {
      srcRoot: ctx.srcRoot,
      warnings: ctx.warnings,
    });
    const parts: BuiltPartInput[] = [];
    const clips: BuiltClipInput[] = [];
    for (const item of items) {
      const {doc} = item;
      normalizeDocument(doc);
      let skeletonGroup: string | undefined;
      const cls = classifySkeleton(doc, rig, {id: item.id});
      if (cls.errors.length > 0) {
        throw new BuildError(
          'AST_RIG_MISMATCH',
          cls.errors.map(e => e.message).join('\n'),
          1,
        );
      }
      ctx.warnings.push(...cls.warnings);
      skeletonGroup = cls.skeletonGroup;
      if (item.kind === 'part') {
        const skinned = doc
          .getRoot()
          .listNodes()
          .some(n => n.getMesh() && n.getSkin());
        if (skinned) {
          writeRegions(doc, item, rig);
          const lim = limitInfluences(doc, {partId: item.id});
          ctx.warnings.push(...lim.warnings);
        }
        ctx.warnings.push(...enforceTextureBudget(doc, {partId: item.id}));
        const isBody = item.config.slot === 'body';
        await optimizeDocument(doc, {
          kind: isBody ? 'body' : 'part',
          maxTextureSize: isBody ? BODY_TEXTURE_PX : PART_TEXTURE_PX,
        });
        parts.push({
          id: item.id,
          kind: skinned ? 'skinned' : 'static',
          bytes: await serialize(doc),
          triangles: countTriangles(doc),
          textures: doc.getRoot().listTextures().length,
          skeletonGroup: skinned ? skeletonGroup : undefined,
        });
      } else {
        await optimizeDocument(doc, {kind: 'clip'});
        const cs = clipStats(doc, rootBone);
        if (skeletonGroup === undefined) {
          skeletonGroup = rig.defaultSkeletonGroup;
          ctx.warnings.push({
            code: 'AST_CLIP_GROUP_DEFAULTED',
            partId: item.id,
            message: `clip ${item.id} matched no skeleton group; recorded ${skeletonGroup}.`,
          });
        }
        clips.push({
          id: item.id,
          bytes: await serialize(doc),
          durationSec: cs.durationSec,
          hasRootMotion: cs.hasRootMotion,
          skeletonGroup,
        });
      }
    }
    for (const f of [...parts, ...clips]) {
      if (f.bytes.byteLength > MAX_FILE_BYTES) {
        ctx.warnings.push({
          code: 'AST_BUDGET_FILE_SIZE',
          partId: f.id,
          message: `${f.id}: ${f.bytes.byteLength} bytes exceeds the ${MAX_FILE_BYTES} byte per-file budget.`,
        });
      }
    }
    const emitted = await emitPack({
      outRoot: ctx.outRoot,
      config: pack.config,
      rig,
      parts,
      clips,
    });
    void emitted;
    const bytes = [...parts, ...clips].reduce(
      (n, f) => n + f.bytes.byteLength,
      0,
    );
    stats.push({
      packId: pack.packId,
      parts: parts.length,
      clips: clips.length,
      bytes,
    });
    lines.push(
      `${pack.packId}: source ${check?.status}, ${parts.length} parts, ${clips.length} clips, ${bytes} GLB bytes`,
    );
  }
  lines.push(...summarizeWarnings(ctx.warnings));
  return {summary: lines.join('\n'), warnings: ctx.warnings, packs: stats};
}

/** Runs the build and returns the summary text. */
export async function runBuild(opts: BuildOptions): Promise<string> {
  return (await runBuildDetailed(opts)).summary;
}

async function main(): Promise<void> {
  try {
    console.log(await runBuild(parseArgs(process.argv.slice(2))));
  } catch (e) {
    if (e instanceof BuildError) {
      console.error(e.message);
      process.exitCode = e.exitCode;
      return;
    }
    throw e;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
