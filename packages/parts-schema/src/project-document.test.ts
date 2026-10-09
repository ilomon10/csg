import {describe, expect, it} from 'vitest';
import {createDefaultCharacterSpec} from './character-spec';
import {
  MAX_PROJECT_JSON_BYTES,
  canonicalProjectJson,
  createProjectDocument,
  parseProjectDocument,
  parseProjectDocumentJson,
} from './project-document';
import projectFixture from '../test/fixtures/project-v1.json';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('ProjectDocument', () => {
  it('AC-CMP-049.1: a stored project holding a v1 character opens with a v2 realistic/human character', () => {
    expect(projectFixture.character.version).toBe(1);
    const result = parseProjectDocument(projectFixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.character.version).toBe(2);
    expect(result.value.character.style).toBe('realistic');
    expect(result.value.character.species).toBe('human');
    expect(result.value.version).toBe(1);
  });

  it('REQ-CMP-049: character failures keep their CMP code and a character. path', () => {
    const noBody = clone(projectFixture) as Record<string, unknown>;
    delete (noBody['character'] as Record<string, unknown>)['body'];
    const a = parseProjectDocument(noBody);
    expect(a.ok === false && a.code).toBe('CMP_BODY_MISSING');
    const bad = clone(projectFixture) as {character: Record<string, unknown>};
    bad.character['seed'] = -1;
    const b = parseProjectDocument(bad);
    expect(b.ok === false && b.code).toBe('CMP_SPEC_INVALID');
    expect(b.ok === false && b.issues[0]?.path).toBe('character.seed');
  });

  it('REQ-UX-025: wrapper problems are UX_PROJECT_INVALID', () => {
    for (const mutate of [
      (d: Record<string, unknown>) => (d['format'] = 'other'),
      (d: Record<string, unknown>) => (d['version'] = 2),
      (d: Record<string, unknown>) => delete d['render'],
      (d: Record<string, unknown>) => (d['export'] = {scales: []}),
      (d: Record<string, unknown>) => (d['graphs'] = []),
    ]) {
      const doc = clone(projectFixture) as Record<string, unknown>;
      mutate(doc);
      const result = parseProjectDocument(doc);
      expect(result.ok === false && result.code).toBe('UX_PROJECT_INVALID');
    }
    expect(parseProjectDocument('x').ok).toBe(false);
  });

  it('REQ-GEN-011: forbidden keys anywhere (including graphs) are rejected', () => {
    const text = JSON.stringify(projectFixture).replace(
      '"graphs":{}',
      '"graphs":{"g":{"__proto__":{}}}',
    );
    expect(parseProjectDocumentJson(text).ok).toBe(false);
  });

  it('REQ-UX-025: text above 1 MiB is rejected before parsing', () => {
    const big = JSON.stringify({pad: 'x'.repeat(MAX_PROJECT_JSON_BYTES)});
    const result = parseProjectDocumentJson(big);
    expect(result.ok).toBe(false);
  });

  it('REQ-EXP-011: canonical project JSON is independent of key order and round-trips', () => {
    const doc = createProjectDocument(createDefaultCharacterSpec());
    const reordered = {
      graphs: doc.graphs,
      export: doc.export,
      render: Object.fromEntries(Object.entries(doc.render).reverse()),
      character: doc.character,
      version: doc.version,
      format: doc.format,
    } as unknown as typeof doc;
    expect(canonicalProjectJson(reordered)).toBe(canonicalProjectJson(doc));
    const again = parseProjectDocument(JSON.parse(canonicalProjectJson(doc)));
    expect(again.ok && canonicalProjectJson(again.value)).toBe(
      canonicalProjectJson(doc),
    );
  });

  it('AC-UX-100.1: a created project validates and its character has no extra keys', () => {
    const doc = createProjectDocument(createDefaultCharacterSpec());
    expect(parseProjectDocument(doc).ok).toBe(true);
    expect(Object.keys(doc.character).sort()).toEqual(
      [
        'format',
        'version',
        'name',
        'seed',
        'style',
        'species',
        'body',
        'parts',
        'anatomy',
        'morphs',
        'tints',
      ].sort(),
    );
  });
});
