/**
 * Build stage 6a: enforce the texture-count budget (spec 011 REQ-AST-016, at most 4 textures per
 * part). Over budget, normal maps are dropped first (the pixel-art toon pipeline shades from
 * base color), then occlusion/roughness maps, in material order.
 */
import type {Document, Material, Texture} from '@gltf-transform/core';
import type {BuildWarning} from './types.js';

/** Maximum textures per built part. */
export const MAX_TEXTURES = 4;

type Slot = 'normal' | 'occlusion' | 'metallicRoughness';

function countUsed(doc: Document): number {
  const used = new Set<Texture>();
  for (const m of doc.getRoot().listMaterials()) {
    for (const t of [
      m.getBaseColorTexture(),
      m.getEmissiveTexture(),
      m.getNormalTexture(),
      m.getOcclusionTexture(),
      m.getMetallicRoughnessTexture(),
    ]) {
      if (t) used.add(t);
    }
  }
  return used.size;
}

function clear(m: Material, slot: Slot): boolean {
  if (slot === 'normal' && m.getNormalTexture()) {
    m.setNormalTexture(null);
    return true;
  }
  if (slot === 'occlusion' && m.getOcclusionTexture()) {
    m.setOcclusionTexture(null);
    return true;
  }
  if (slot === 'metallicRoughness' && m.getMetallicRoughnessTexture()) {
    m.setMetallicRoughnessTexture(null);
    return true;
  }
  return false;
}

/**
 * Drops secondary maps until the document references at most {@link MAX_TEXTURES} textures.
 * Unreferenced textures are removed by the optimize stage's prune. Returns warnings
 * `AST_TEXTURES_DROPPED` when anything was dropped.
 */
export function enforceTextureBudget(
  doc: Document,
  opts: {partId?: string} = {},
): BuildWarning[] {
  const before = countUsed(doc);
  if (before <= MAX_TEXTURES) return [];
  const dropped: string[] = [];
  for (const slot of ['normal', 'occlusion', 'metallicRoughness'] as const) {
    for (const m of doc.getRoot().listMaterials()) {
      if (countUsed(doc) <= MAX_TEXTURES) break;
      if (clear(m, slot)) dropped.push(`${m.getName()}:${slot}`);
    }
  }
  const after = countUsed(doc);
  return [
    {
      code: 'AST_TEXTURES_DROPPED',
      partId: opts.partId,
      message: `${opts.partId ?? 'part'}: ${before} textures exceed ${MAX_TEXTURES}; dropped ${dropped.join(', ')} (${after} left).`,
      details: {before, after, dropped},
    },
  ];
}
