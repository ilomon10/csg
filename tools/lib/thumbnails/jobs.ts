/**
 * Thumbnail plan of `pnpm assets:thumbnails` (spec 011 REQ-AST-015, REQ-AST-039). Pure: turns the
 * built manifests and preset files into one render job per thumbnail, each with an `inputs`
 * hash over everything that changes its pixels. The GPU harness renders the jobs
 * (`packages/engine/test/gpu/thumbnails/`); `assets:check` recomputes the plan to flag stale
 * thumbnails (no GPU needed).
 *
 * Rules (the framing rule of REQ-AST-015 as implemented in M3-21):
 *
 * - Every job renders through the export pixel pipeline (`prepareFrames` / `renderFrames` or the
 *   same frame target with a region framing), WebGL2 (`forceWebGL`), pose = frame 0 of the first
 *   default clip (`idle`), one facing: `se` for the three-quarter and isometric cameras, `e` for
 *   the side camera. Transparent background, binary alpha.
 * - Parts: the part alone on its compatible default body (the default character's body when the
 *   part fits it, otherwise the first fitting body by reference), every other slot empty, default
 *   tints and anatomy, the default look (`classic-16bit`), three-quarter camera. A 64 px cell
 *   framed on the slot region (table {@link SLOT_FRAMING_REGIONS}) united with the part's own
 *   screen box, square, centred, with a 4 px margin; nearest-upscaled x2 to 128x128.
 *   Bodies use the full-body auto framing instead.
 * - Character presets: the preset's character in the preset's camera (default `side`), auto
 *   framing (the export framing), 64 px cell upscaled x2 to 128x128.
 * - Looks: the default character under the look, three-quarter camera, auto framing, 64x64.
 * - Body shapes: the default character with the shape applied over the style's anatomy preset
 *   (REQ-ANA-023), three-quarter camera, 64x64, with one shared scale per style (the largest
 *   auto-framing scale of the style's six shapes), so tall and petite differ in height.
 */
import {createHash} from 'node:crypto';
import {
  BODY_REGIONS,
  DEFAULT_CHARACTER_DATA,
  applyBodyShape,
  parseRenderSettings,
} from '@csg/parts-schema';
import type {
  AnatomyParams,
  BodyRegion,
  CameraPreset,
  CharacterSpec,
  PartEntry,
  RenderSettings,
  SlotId,
} from '@csg/parts-schema';
import {fitsBody} from '../build/sole.js';
import {stableStringify} from '../check/stale.js';

/**
 * Version of the render recipe. Bump it when the framing rules, the pose, the encoder settings
 * or the approved look change in a way the input hash cannot see (engine code, the container
 * image, three); every thumbnail then reports as stale until re-rendered.
 */
export const THUMBNAIL_RECIPE = 'm3-21.1';

/** Look applied to part, character and shape thumbnails (spec 006 REQ-EDT-044 default). */
export const DEFAULT_LOOK_ID = 'classic-16bit';

/** Cell side of every render, px. */
export const THUMBNAIL_CELL_PX = 64;

/**
 * Margin around a region framing, px of the 64 px cell: room for the 1 px outline plus a little
 * context, so a tile does not look cropped at its edges.
 */
export const REGION_MARGIN_PX = 4;

/** Upper size limit of one part thumbnail (AC-AST-015.1). */
export const MAX_THUMBNAIL_BYTES = 12 * 1024;

/**
 * Styles that get body-shape thumbnails: the (style, `human`) pairs of the engine's
 * `SUPPORTED_STYLE_COMBOS` (REQ-AST-039 resolution). Tools may not import the engine catalog
 * (architecture rule 6), so the harness asserts this list equals the engine constant.
 */
export const THUMBNAIL_SHAPE_STYLES: readonly string[] = ['realistic', 'chibi'];

/**
 * Body regions a slot's thumbnail is framed on (united with the part's own box). A slot missing
 * here is framed on the whole body.
 */
export const SLOT_FRAMING_REGIONS: Readonly<
  Record<string, readonly BodyRegion[]>
> = {
  hair: ['head', 'hair', 'neck'],
  eyebrows: ['head', 'hair', 'neck'],
  beard: ['head', 'hair', 'neck'],
  face: ['head', 'hair', 'neck'],
  headwear: ['head', 'hair', 'neck'],
  torso: ['neck', 'torso', 'pelvis', 'upper-arms'],
  back: ['neck', 'torso', 'pelvis', 'upper-arms'],
  accessory: ['neck', 'torso', 'upper-arms'],
  arms: ['upper-arms', 'lower-arms', 'hands'],
  hands: ['lower-arms', 'hands'],
  legs: ['pelvis', 'upper-legs', 'lower-legs'],
  feet: ['lower-legs', 'feet'],
};

/** How a job is framed. */
export type ThumbnailFraming =
  | {readonly mode: 'auto'}
  | {readonly mode: 'shared'; readonly group: string}
  | {
      readonly mode: 'region';
      readonly slot: SlotId;
      readonly regions: readonly BodyRegion[];
      readonly marginPx: number;
    };

/** Kind of a thumbnail. */
export type ThumbnailKind = 'part' | 'character' | 'look' | 'shape';

/** One thumbnail to render. Serialised to JSON for the GPU harness. */
export interface ThumbnailJob {
  /** Pack that holds the file. */
  readonly packId: string;
  /** Pack-relative output path. */
  readonly path: string;
  readonly kind: ThumbnailKind;
  /** Part or preset ID. */
  readonly id: string;
  /** Style of a shape thumbnail. */
  readonly style?: string;
  readonly character: CharacterSpec;
  /** Validated settings (resolution = cell, one direction, one idle frame). */
  readonly settings: RenderSettings;
  readonly framing: ThumbnailFraming;
  /** Render cell side, px. */
  readonly cellPx: number;
  /** Integer nearest upscale of the cell; the file is `cellPx * scale` square. */
  readonly scale: number;
  /** SHA-256 over the recipe, the job and every input file entry. */
  readonly inputs: string;
}

/** A parsed preset file of a built pack. */
export interface PlanPreset {
  readonly kind: string;
  readonly json: unknown;
}

/** One built pack, as read from `assets/packs/<packId>/`. */
export interface PlanPack {
  readonly packId: string;
  readonly parts: readonly PartEntry[];
  /** `manifest.rigs` (embedded rig copy, with the measured sole offsets). */
  readonly rigs: readonly unknown[];
  /** `clips.json` entries, when the pack has clips. */
  readonly clips?: readonly {readonly id: string}[];
  readonly presets: readonly PlanPreset[];
}

/** Result of {@link planThumbnails}. */
export interface ThumbnailPlan {
  readonly jobs: readonly ThumbnailJob[];
  /** Planning problems (unresolved refs, invalid look settings); the job is skipped. */
  readonly problems: readonly string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Deep merge of a look's `render` patch (objects merge, everything else replaces). */
export function mergePatch(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN.has(key)) continue;
    const current = out[key];
    out[key] =
      isRecord(value) && isRecord(current) && key !== 'params'
        ? mergePatch(current, value)
        : value;
  }
  return out;
}

/** Facing of a thumbnail for a camera preset. */
export function facingFor(camera: CameraPreset): 'e' | 'se' {
  return camera === 'side' ? 'e' : 'se';
}

/**
 * Render settings of a thumbnail: the look over the camera defaults, one direction, frame 0 of
 * `clip`. Returns the settings-parser issues when the look does not validate.
 */
export function thumbnailSettings(args: {
  camera: CameraPreset;
  cellPx: number;
  clip: string;
  look?: unknown;
}): {ok: true; value: RenderSettings} | {ok: false; message: string} {
  let input: Record<string, unknown> = {
    resolution: {width: args.cellPx, height: args.cellPx},
    camera: {preset: args.camera},
    directions: 1,
    singleFacing: facingFor(args.camera),
    animations: [
      {clipId: args.clip, label: 'idle', frameCount: 1, fps: 8, loop: true},
    ],
  };
  if (isRecord(args.look)) {
    const look = args.look;
    if (isRecord(look['render'])) input = mergePatch(input, look['render']);
    for (const key of ['materialGraph', 'postGraph', 'params'] as const) {
      if (look[key] !== undefined) input[key] = look[key];
    }
  }
  const parsed = parseRenderSettings(input);
  if (!parsed.ok) {
    return {
      ok: false,
      message: parsed.issues.map(i => `${i.path}: ${i.message}`).join('; '),
    };
  }
  return {ok: true, value: parsed.value};
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Refs of every part a character uses, body first, then slots in key order. */
function refsOf(spec: CharacterSpec): string[] {
  return [
    spec.body.ref,
    ...Object.keys(spec.parts)
      .sort()
      .map(slot => spec.parts[slot as SlotId]!.ref),
  ];
}

function packOf(ref: string): string {
  return ref.slice('builtin:'.length).split('/')[0] ?? '';
}

/**
 * Plans every thumbnail of the built packs (REQ-AST-015, REQ-AST-039). Deterministic: packs,
 * parts and presets are visited in sorted order and the result is sorted by pack then path.
 */
export function planThumbnails(packs: readonly PlanPack[]): ThumbnailPlan {
  const problems: string[] = [];
  const sorted = [...packs].sort((a, b) => (a.packId < b.packId ? -1 : 1));
  const parts = new Map<string, PartEntry>();
  const rigsByPack = new Map<string, readonly unknown[]>();
  const clips = new Map<string, unknown>();
  const presets: Array<{packId: string; kind: string; json: unknown}> = [];
  for (const pack of sorted) {
    rigsByPack.set(pack.packId, pack.rigs);
    for (const part of pack.parts)
      parts.set(`builtin:${pack.packId}/${part.id}`, part);
    for (const clip of pack.clips ?? [])
      clips.set(`builtin:${pack.packId}/${clip.id}`, clip);
    for (const p of pack.presets) presets.push({packId: pack.packId, ...p});
  }
  const presetsOf = (kind: string) =>
    presets
      .filter(p => p.kind === kind && isRecord(p.json))
      .map(p => ({packId: p.packId, json: p.json as Record<string, unknown>}))
      .sort((a, b) =>
        String(a.json['id'] ?? a.json['style']) <
        String(b.json['id'] ?? b.json['style'])
          ? -1
          : 1,
      );

  const defaults = DEFAULT_CHARACTER_DATA;
  const clip = defaults.clips[0] as string;
  const looks = presetsOf('look');
  const defaultLook = looks.find(l => l.json['id'] === DEFAULT_LOOK_ID)?.json;

  const jobs: ThumbnailJob[] = [];
  const add = (
    job: Omit<ThumbnailJob, 'inputs'>,
    extra: Record<string, unknown> = {},
  ) => {
    const refs = refsOf(job.character);
    const deps: Record<string, unknown> = {};
    for (const ref of refs) {
      const entry = parts.get(ref);
      if (entry === undefined) {
        problems.push(`${job.packId}/${job.path}: ${ref} is not a built part.`);
        return;
      }
      const {thumbnail: _t, ...rest} = entry;
      deps[ref] = rest;
    }
    const rigs: Record<string, unknown> = {};
    for (const ref of refs) rigs[packOf(ref)] = rigsByPack.get(packOf(ref));
    const clipEntry = clips.get(clip);
    const {packId: _p, path: _q, ...rendered} = job;
    const inputs = sha256(
      stableStringify({
        recipe: THUMBNAIL_RECIPE,
        job: rendered,
        deps,
        rigs,
        clip: clipEntry ?? clip,
        ...extra,
      }),
    );
    jobs.push({...job, inputs});
  };
  const settingsOr = (
    where: string,
    camera: CameraPreset,
    look: unknown,
  ): RenderSettings | null => {
    const s = thumbnailSettings({
      camera,
      cellPx: THUMBNAIL_CELL_PX,
      clip,
      look,
    });
    if (s.ok) return s.value;
    problems.push(`${where}: render settings invalid: ${s.message}`);
    return null;
  };

  // Bodies in fallback order: the default body first, then by reference.
  const bodies = [...parts.entries()]
    .filter(([, p]) => p.slot === 'body')
    .sort(([a], [b]) =>
      a === defaults.character.body.ref
        ? -1
        : b === defaults.character.body.ref
          ? 1
          : a < b
            ? -1
            : 1,
    );

  // Parts (REQ-AST-015).
  for (const pack of sorted) {
    for (const part of [...pack.parts].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const ref = `builtin:${pack.packId}/${part.id}`;
      const path = `thumbnails/${part.id}.webp`;
      let bodyRef = ref;
      if (part.slot !== 'body') {
        const body = bodies.find(([, b]) => fitsBody(part, b));
        if (body === undefined) {
          problems.push(`${pack.packId}/${path}: no built body fits ${ref}.`);
          continue;
        }
        bodyRef = body[0];
      }
      const style =
        part.styles !== undefined &&
        part.styles.length > 0 &&
        !part.styles.includes(defaults.character.style)
          ? (part.styles[0] as CharacterSpec['style'])
          : defaults.character.style;
      const settings = settingsOr(path, 'three-quarter', defaultLook);
      if (settings === null) continue;
      const character: CharacterSpec = {
        ...defaults.character,
        style,
        body: {ref: bodyRef},
        parts: part.slot === 'body' ? {} : {[part.slot]: {ref}},
      };
      add({
        packId: pack.packId,
        path,
        kind: 'part',
        id: part.id,
        character,
        settings,
        framing:
          part.slot === 'body'
            ? {mode: 'auto'}
            : {
                mode: 'region',
                slot: part.slot,
                regions: SLOT_FRAMING_REGIONS[part.slot] ?? BODY_REGIONS,
                marginPx: REGION_MARGIN_PX,
              },
        cellPx: THUMBNAIL_CELL_PX,
        scale: 2,
      });
    }
  }

  // Character presets (REQ-AST-039).
  for (const {packId, json} of presetsOf('character')) {
    const id = String(json['id']);
    const path = `thumbnails/characters/${id}.webp`;
    const camera = (json['camera'] as CameraPreset | undefined) ?? 'side';
    const settings = settingsOr(path, camera, defaultLook);
    if (settings === null || !isRecord(json['character'])) continue;
    add({
      packId,
      path,
      kind: 'character',
      id,
      character: json['character'] as unknown as CharacterSpec,
      settings,
      framing: {mode: 'auto'},
      cellPx: THUMBNAIL_CELL_PX,
      scale: 2,
    });
  }

  // Looks (REQ-AST-039).
  for (const {packId, json} of looks) {
    const id = String(json['id']);
    const path =
      typeof json['thumbnail'] === 'string'
        ? json['thumbnail']
        : `thumbnails/looks/${id}.webp`;
    const settings = settingsOr(path, 'three-quarter', json);
    if (settings === null) continue;
    add({
      packId,
      path,
      kind: 'look',
      id,
      character: defaults.character,
      settings,
      framing: {mode: 'auto'},
      cellPx: THUMBNAIL_CELL_PX,
      scale: 1,
    });
  }

  // Body shapes (REQ-AST-039 resolution): every style file x shape whose style is supported.
  const anatomy = new Map(
    presetsOf('anatomy-preset').map(p => [String(p.json['id']), p.json]),
  );
  const shapes = presetsOf('body-shape');
  for (const {packId: stylePack, json: style} of presetsOf('style')) {
    const styleId = String(style['style']);
    if (!THUMBNAIL_SHAPE_STYLES.includes(styleId)) continue;
    const presetId =
      typeof style['anatomyPreset'] === 'string'
        ? style['anatomyPreset']
        : 'default';
    const base = anatomy.get(presetId)?.['values'] as AnatomyParams | undefined;
    if (base === undefined) {
      problems.push(`style ${styleId}: anatomy preset ${presetId} not found.`);
      continue;
    }
    const settings = settingsOr(
      `shapes/${styleId}`,
      'three-quarter',
      defaultLook,
    );
    if (settings === null) continue;
    for (const {packId, json: shape} of shapes) {
      if (packId !== stylePack) continue;
      const id = String(shape['id']);
      const factors = (shape['factors'] ?? {}) as Partial<AnatomyParams>;
      add(
        {
          packId,
          path: `thumbnails/shapes/${styleId}/${id}.webp`,
          kind: 'shape',
          id,
          style: styleId,
          character: {
            ...defaults.character,
            style: styleId as CharacterSpec['style'],
            anatomy: applyBodyShape(base, factors),
          },
          settings,
          framing: {mode: 'shared', group: `shapes/${packId}/${styleId}`},
          cellPx: THUMBNAIL_CELL_PX,
          scale: 1,
        },
        // A shared scale depends on every member of the group.
        {
          group: shapes
            .filter(s => s.packId === packId)
            .map(s => ({id: s.json['id'], factors: s.json['factors']})),
          base,
        },
      );
    }
  }

  jobs.sort((a, b) =>
    a.packId !== b.packId
      ? a.packId < b.packId
        ? -1
        : 1
      : a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0,
  );
  return {jobs, problems};
}
