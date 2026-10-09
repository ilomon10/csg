import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  canonicalProjectJson,
  createDefaultCharacterSpec,
  createProjectDocument,
} from '@csg/parts-schema';
import {projectSha256} from './export-credits';

describe('projectSha256 (REQ-EXP-011)', () => {
  it('AC-EXP-011.2: equals sha256(canonicalJson(project)) recomputed independently, and ignores key order', async () => {
    const doc = createProjectDocument(createDefaultCharacterSpec());
    const expected = createHash('sha256')
      .update(canonicalProjectJson(doc), 'utf8')
      .digest('hex');
    const hash = await projectSha256(doc);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expected);
    // A document built with another key order canonicalizes to the same hash.
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(doc).reverse())),
    ) as typeof doc;
    expect(await projectSha256(reordered)).toBe(expected);
    // Any content change changes the hash.
    const renamed = {...doc, character: {...doc.character, name: 'Other'}};
    expect(await projectSha256(renamed)).not.toBe(expected);
  });
});
