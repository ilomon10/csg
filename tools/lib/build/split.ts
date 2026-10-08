/**
 * Stage 2: splits source files into one document per part and per clip (spec 011 REQ-AST-002,
 * REQ-AST-009). Pure over gltf-transform documents; file access goes through {@link SplitIo}.
 */
import {extname, join} from 'node:path';
import {cloneDocument, prune} from '@gltf-transform/functions';
import type {Document} from '@gltf-transform/core';
import {loadGltfDocument} from '../gltf-skeleton.js';
import {BuildError} from './types.js';
import type {BuildWarning, LoadedPack, SplitItem} from './types.js';

/** Where the contributor conversion recipe lives (AC-AST-002.1). */
export const CONVERSION_RECIPE = 'docs/contributing/assets.md';

/** I/O edge of the split stage. */
export interface SplitIo {
  /** Absolute `assets-src/` path. */
  srcRoot: string;
  /** Loads a glTF/GLB by absolute path; defaults to the safe reader. */
  loadDocument?: (absPath: string) => Promise<Document>;
  /** Receives non-fatal findings of the split (missing source images). */
  warnings?: BuildWarning[];
}

/** Converts a `*`/`?` glob to an anchored RegExp (everything else literal). */
export function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split('')
    .map(c =>
      c === '*'
        ? '.*'
        : c === '?'
          ? '.'
          : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
    )
    .join('');
  return new RegExp(`^${body}$`);
}

function assertGltf(file: string): void {
  const ext = extname(file).toLowerCase();
  if (ext !== '.gltf' && ext !== '.glb') {
    throw new BuildError(
      'AST_SOURCE_FORMAT',
      `${file}: only glTF 2.0 (.gltf/.glb) sources are accepted; convert with Blender, see ${CONVERSION_RECIPE}.`,
      1,
    );
  }
}

/** Splits one part: the matched mesh node(s), their skeleton, and their own materials/textures only. */
function extractPart(
  source: Document,
  file: string,
  pattern: string | undefined,
): Document {
  const doc = cloneDocument(source);
  const nodes = doc
    .getRoot()
    .listNodes()
    .filter(n => n.getMesh() !== null);
  const re = pattern === undefined ? null : patternToRegExp(pattern);
  const matched = nodes.filter(
    n =>
      re === null ||
      re.test(n.getName()) ||
      re.test(n.getMesh()?.getName() ?? ''),
  );
  if (matched.length === 0) {
    throw new BuildError(
      'AST_CONFIG_UNMATCHED',
      `pattern "${pattern ?? '*'}" matches no mesh node in ${file}.`,
      1,
    );
  }
  const keep = new Set(matched);
  for (const n of nodes) {
    if (keep.has(n)) continue;
    if (n.listChildren().length === 0) n.dispose();
    else n.setMesh(null).setSkin(null);
  }
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
  }
  return doc;
}

/** Splits one clip: skeleton nodes plus the single named animation, no meshes. */
function extractClip(
  source: Document,
  file: string,
  animation: string,
): Document {
  const doc = cloneDocument(source);
  const anims = doc.getRoot().listAnimations();
  const found = anims.find(a => a.getName() === animation);
  if (!found) {
    throw new BuildError(
      'AST_CONFIG_UNMATCHED',
      `animation "${animation}" not found in ${file} (has: ${anims.map(a => a.getName()).join(', ') || 'none'}).`,
      1,
    );
  }
  for (const a of anims) {
    if (a === found) continue;
    // Dispose channels and samplers too, else their accessors stay referenced and are written.
    for (const ch of a.listChannels()) ch.dispose();
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
  }
  for (const n of doc.getRoot().listNodes()) n.setMesh(null);
  return doc;
}

/**
 * Splits a pack into per-part and per-clip documents, parts first then clips, in config order.
 * Unmatched patterns fail with `AST_CONFIG_UNMATCHED`; non-glTF files with `AST_SOURCE_FORMAT`.
 */
export async function splitPack(
  pack: LoadedPack,
  io: SplitIo,
): Promise<SplitItem[]> {
  const load =
    io.loadDocument ??
    ((abs: string) =>
      loadGltfDocument(abs, {
        readImages: true,
        onMissingImage: uri =>
          io.warnings?.push({
            code: 'AST_SOURCE_IMAGE_MISSING',
            message: `${abs}: image "${uri}" is missing from the source pack; texture dropped.`,
          }),
      }));
  const cache = new Map<string, Document>();
  const open = async (file: string): Promise<Document> => {
    assertGltf(file);
    let doc = cache.get(file);
    if (!doc) {
      const abs = join(io.srcRoot, pack.dir, file);
      try {
        doc = await load(abs);
      } catch (e) {
        if (e instanceof BuildError) throw e;
        const code = (e as {code?: string}).code;
        if (code === 'AST_SOURCE_FORMAT') {
          throw new BuildError(
            'AST_SOURCE_FORMAT',
            `${file}: ${(e as Error).message}`,
            1,
          );
        }
        throw new BuildError(
          'AST_CONFIG_UNMATCHED',
          `${file}: cannot read source file (${(e as Error).message}).`,
          1,
        );
      }
      cache.set(file, doc);
    }
    return doc;
  };
  const items: SplitItem[] = [];
  for (const config of pack.config.parts) {
    const source = await open(config.match.file);
    const doc = extractPart(source, config.match.file, config.match.node);
    await doc.transform(prune({keepLeaves: true}));
    items.push({kind: 'part', id: config.id, doc, config});
  }
  for (const config of pack.config.clips) {
    const source = await open(config.match.file);
    const doc = extractClip(source, config.match.file, config.match.animation);
    await doc.transform(prune({keepLeaves: true}));
    items.push({kind: 'clip', id: config.id, doc, config});
  }
  return items;
}
