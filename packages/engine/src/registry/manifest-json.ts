/**
 * Parsing of generated pack manifests (`manifest.json`, `clips.json`) from JSON text through
 * `@csg/parts-schema` (spec 011 REQ-AST-013, spec 004 REQ-ANM-001, REQ-GEN-011).
 */
import {
  parseClipManifest,
  parseJson,
  parsePartManifest,
  validatePartsAgainstRig,
} from '@csg/parts-schema';
import type {ClipManifest, PartManifest, SchemaResult} from '@csg/parts-schema';

/**
 * Parses `manifest.json` text: rejects forbidden keys, validates the schema, and checks every
 * skinned part's rig and skeleton groups against the embedded rigs (AC-CMP-037.3). Never throws.
 *
 * @param text JSON text of a part manifest.
 * @returns The manifest, or issues naming the part ID and field.
 */
export function parsePartManifestJson(
  text: string,
): SchemaResult<PartManifest> {
  const json = parseJson(text);
  if (!json.ok) return json;
  const manifest = parsePartManifest(json.value);
  if (!manifest.ok) return manifest;
  const rigCheck = validatePartsAgainstRig(manifest.value);
  return rigCheck.ok ? manifest : rigCheck;
}

/**
 * Parses `clips.json` text: rejects forbidden keys and validates the schema. Never throws.
 *
 * @param text JSON text of a clip manifest.
 * @returns The manifest, or issues naming the clip ID and field.
 */
export function parseClipManifestJson(
  text: string,
): SchemaResult<ClipManifest> {
  const json = parseJson(text);
  if (!json.ok) return json;
  return parseClipManifest(json.value);
}
