import {Document} from '@gltf-transform/core';
import {describe, expect, it} from 'vitest';
import {enforceTextureBudget} from './textures.js';

function docWith(maps: number): Document {
  const doc = new Document();
  const mat = doc.createMaterial('m');
  const tex = () => doc.createTexture().setImage(new Uint8Array([1]));
  mat.setBaseColorTexture(tex());
  if (maps > 1) mat.setNormalTexture(tex());
  if (maps > 2) mat.setOcclusionTexture(tex());
  if (maps > 3) mat.setMetallicRoughnessTexture(tex());
  if (maps > 4) mat.setEmissiveTexture(tex());
  return doc;
}

describe('AC-AST-016.1 texture budget stage', () => {
  it('leaves a part within 4 textures untouched', () => {
    expect(enforceTextureBudget(docWith(4))).toEqual([]);
  });
  it('drops normal maps first when over budget and warns', () => {
    const doc = docWith(5);
    const w = enforceTextureBudget(doc, {partId: 'p'});
    expect(w[0]?.code).toBe('AST_TEXTURES_DROPPED');
    expect(doc.getRoot().listMaterials()[0]?.getNormalTexture()).toBeNull();
    expect(
      doc.getRoot().listMaterials()[0]?.getMetallicRoughnessTexture(),
    ).not.toBeNull();
  });
});
