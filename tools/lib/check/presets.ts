/**
 * Preset checks of `assets:check` (spec 011 output layout; spec 002 REQ-ANA-013/022/024,
 * spec 014 REQ-UX-103, spec 001 REQ-CMP-027, spec 006 REQ-EDT-044). Reads built
 * `presets/index.json` files, validates every listed file with the parts-schema preset schemas,
 * compares them with the authored sources, and checks character preset references against the
 * built manifests. Everything read from disk is untrusted.
 */
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SLOT_REGISTRY, parseJson, presetIndexSchema} from '@csg/parts-schema';
import type {CharacterPreset, PartEntry} from '@csg/parts-schema';
import {
  PRESET_FOLDERS,
  readPresetSources,
  validatePresetSet,
} from '../build/presets.js';
import type {PresetFile} from '../build/presets.js';
import {fitsBody} from '../build/sole.js';
import {jsonEqual} from './stale.js';
import type {CheckIssue} from './types.js';
import {THUMBNAIL_SHAPE_STYLES} from '../thumbnails/jobs.js';

/** Presets of one built pack. */
export interface PackPresets {
  packId: string;
  files: PresetFile[];
  /** Parts of the pack's manifest, for reference checks. */
  parts: PartEntry[];
}

function hint(packId: string): string {
  return `Do not edit assets/packs/${packId}/presets by hand: edit tools/packs/${packId}/presets and run pnpm assets:build.`;
}

/**
 * Reads and validates the presets of one built pack. Adds every listed file (and an existing
 * character, look or body-shape thumbnail) to `referenced`. Returns the parsed files for the cross-pack checks.
 */
export async function checkPackPresets(args: {
  packId: string;
  packDir: string;
  configsDir: string;
  referenced: Set<string>;
  add: (issue: CheckIssue) => void;
}): Promise<PackPresets> {
  const {packId, packDir, add} = args;
  const out: PackPresets = {packId, files: [], parts: []};
  const indexPath = join(packDir, 'presets', 'index.json');
  if (!existsSync(indexPath)) return out;
  const fail = (message: string, id?: string) =>
    add({
      severity: 'error',
      code: 'AST_PRESET_INVALID',
      packId,
      ...(id === undefined ? {} : {id}),
      message,
    });
  args.referenced.add('presets/index.json');
  const indexJson = parseJson(await readFile(indexPath, 'utf8'));
  const index = indexJson.ok
    ? presetIndexSchema.safeParse(indexJson.value)
    : null;
  if (index === null || !index.success) {
    fail('presets/index.json is not a valid preset index.');
    return out;
  }
  const kinds = new Map(PRESET_FOLDERS.map(f => [f.kind, f.folder]));
  for (const entry of index.data.files) {
    if (!entry.path.startsWith(`presets/${kinds.get(entry.kind)}/`)) {
      fail(`${entry.path}: not in the folder of kind ${entry.kind}.`);
      continue;
    }
    args.referenced.add(entry.path);
    let text: string;
    try {
      text = await readFile(join(packDir, entry.path), 'utf8');
    } catch {
      fail(`${entry.path}: listed in presets/index.json but missing.`);
      continue;
    }
    const json = parseJson(text);
    if (!json.ok) {
      fail(`${entry.path}: ${json.issues.map(i => i.message).join('; ')}`);
      continue;
    }
    out.files.push({kind: entry.kind, path: entry.path, json: json.value});
  }
  for (const issue of validatePresetSet(out.files).issues) {
    fail(issue.message);
  }

  // Preset thumbnails (REQ-AST-039): warning only; a present file is referenced.
  const expectThumb = (id: string, thumb: string) => {
    if (existsSync(join(packDir, thumb))) args.referenced.add(thumb);
    else {
      add({
        severity: 'warn',
        code: 'AST_THUMBNAIL_MISSING',
        packId,
        id,
        message: `${id}: preset thumbnail ${thumb} is missing (run pnpm assets:thumbnails).`,
      });
    }
  };
  for (const file of out.files) {
    const id = (file.json as {id?: string}).id ?? file.path;
    if (file.kind === 'look') {
      const thumb = (file.json as {thumbnail?: string}).thumbnail;
      if (thumb !== undefined) expectThumb(id, thumb);
    } else if (file.kind === 'character') {
      expectThumb(id, `thumbnails/characters/${id}.webp`);
    }
  }
  // Body shapes: one per (style file, shape) of a supported style (REQ-AST-039 resolution).
  for (const style of out.files.filter(f => f.kind === 'style')) {
    const styleId = String((style.json as {style?: string}).style);
    if (!THUMBNAIL_SHAPE_STYLES.includes(styleId)) continue;
    for (const shape of out.files.filter(f => f.kind === 'body-shape')) {
      const id = String((shape.json as {id?: string}).id);
      expectThumb(id, `thumbnails/shapes/${styleId}/${id}.webp`);
    }
  }

  // Built presets must equal the authored sources.
  if (existsSync(join(args.configsDir, packId, 'presets'))) {
    const source = await readPresetSources(join(args.configsDir, packId));
    const built = new Map(out.files.map(f => [f.path, f.json]));
    const same =
      source.files.length === built.size &&
      source.files.every(f => {
        const b = built.get(f.path);
        return b !== undefined && jsonEqual(b, f.json);
      });
    if (!same) {
      add({
        severity: 'error',
        code: 'AST_MANIFEST_STALE',
        packId,
        message: `presets of ${packId} differ from tools/packs/${packId}/presets. ${hint(packId)}`,
      });
    }
  }
  return out;
}

/**
 * Cross-pack preset rules: character preset refs resolve to built parts of the right slot that
 * fit the body (REQ-UX-103, REQ-CMP-008), the style has a loaded style file (REQ-CMP-045), and
 * Easy category slots exist in the slot registry.
 */
export function checkPresetReferences(
  packs: readonly PackPresets[],
  partsByRef: ReadonlyMap<string, PartEntry>,
  add: (issue: CheckIssue) => void,
): void {
  const styles = new Set<string>();
  for (const pack of packs) {
    for (const file of pack.files) {
      if (file.kind === 'style')
        styles.add(String((file.json as {style?: string}).style));
    }
  }
  const slots = new Set<string>(SLOT_REGISTRY.slots.map(s => s.id));
  for (const pack of packs) {
    const fail = (id: string, message: string) =>
      add({
        severity: 'error',
        code: 'AST_PRESET_REF',
        packId: pack.packId,
        id,
        message: `${id}: ${message}`,
      });
    for (const file of pack.files) {
      if (file.kind === 'easy-category') {
        const def = file.json as {id: string; slots: string[]};
        for (const slot of def.slots ?? []) {
          if (!slots.has(slot))
            fail(
              def.id,
              `category slot "${slot}" is not in the slot registry.`,
            );
        }
      }
      if (file.kind !== 'character') continue;
      const preset = file.json as CharacterPreset;
      const spec = preset.character;
      if (spec === undefined || spec.body === undefined) continue;
      const id = preset.id;
      if (!styles.has(spec.style))
        fail(id, `style "${spec.style}" has no style file in the built packs.`);
      const body = partsByRef.get(spec.body.ref);
      if (body === undefined || body.slot !== 'body') {
        fail(id, `body ${spec.body.ref} is not a built body part.`);
        continue;
      }
      for (const [slot, selection] of Object.entries(spec.parts)) {
        const ref = selection.ref;
        if (!ref.startsWith('builtin:')) {
          fail(
            id,
            `${slot}: ${ref} is not a built-in part (presets use bundled assets only).`,
          );
          continue;
        }
        const part = partsByRef.get(ref);
        if (part === undefined)
          fail(id, `${slot}: ${ref} is not a built part.`);
        else if (part.slot !== slot)
          fail(id, `${slot}: ${ref} is a ${part.slot} part.`);
        else if (!fitsBody(part, body))
          fail(id, `${slot}: ${ref} does not fit body ${spec.body.ref}.`);
      }
    }
  }
}
