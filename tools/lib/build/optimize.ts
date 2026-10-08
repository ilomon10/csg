/**
 * Build stage 6: optimize a document for output (spec 011 REQ-AST-010 as amended 2026-10-08):
 * dedup, prune, weld, resample (1e-4), texture resize, PNG, Meshopt. Never joins, flattens,
 * instances or simplifies, and never uses Draco or KTX2, so node and bone names and skinning
 * survive unchanged.
 */
import type {Document} from '@gltf-transform/core';
import {EXTMeshoptCompression} from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  reorder,
  resample,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import {MeshoptEncoder} from 'meshoptimizer';
import sharp from 'sharp';

/** Kind of output, selects the texture size limit. */
export type OptimizeKind = 'body' | 'part' | 'prop' | 'clip';

/** Options of {@link optimizeDocument}. */
export interface OptimizeOptions {
  kind: OptimizeKind;
  /** Overrides the per-kind texture limit (pixels per side). */
  maxTextureSize?: number;
}

/** Max texture side: 1024 for bodies, 512 for parts and props (REQ-AST-010). */
export function textureLimit(kind: OptimizeKind): number {
  return kind === 'body' ? 1024 : 512;
}

/** Optimizes `doc` in place; deterministic for equal input. */
export async function optimizeDocument(
  doc: Document,
  opts: OptimizeOptions,
): Promise<void> {
  await MeshoptEncoder.ready;
  const limit = opts.maxTextureSize ?? textureLimit(opts.kind);
  await doc.transform(
    dedup(),
    prune({keepLeaves: true, keepExtras: true}),
    weld(),
    resample({tolerance: 1e-4}),
    textureCompress({
      encoder: sharp,
      targetFormat: 'png',
      resize: [limit, limit],
    }),
    reorder({encoder: MeshoptEncoder, target: 'size'}),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
}
