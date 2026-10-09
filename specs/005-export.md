---
id: EXP
title: Export (sprite sheets, metadata, credits)
status: draft
owner: spec-writer (review: graphics-engineer)
depends_on: [constitution, 000-overview, 003-pixel-render-pipeline, 004-animation, 008-custom-model-upload]
last_updated: 2026-10-09
---

# 005 – Export

## Context

Export turns the deterministic `RenderedFrame[]` stream from the pixel pipeline (spec 003, `renderFrames`) into files a game engine can use: a sprite-sheet PNG, metadata JSON, optional per-frame PNGs and animated previews, and a mandatory `CREDITS.txt`. Architecture §2.1 and §3.6 define the shape: exporters are **pure functions over `RenderedFrame[]` with no three.js**, so they run and are tested in Node and in a worker. Constitution P-02 (credits and license warnings), P-03 (local only: downloads, no upload) and P-04 (deterministic output) apply directly.

**Naming:** every animation name in files, frame names, tags and engine resources uses the animation's `label` from `RenderSettings.animations` (spec 004 `AnimationSelection.label`, `[a-z0-9-]{1,48}`, unique per export), never the `clipId` (`ClipRef`), which contains `:`, `/` and `#`. `<label>` below means that label. The `clipId` is recorded only in the manifest for reproduction.

Everything is rendered once at 1× (the cell resolution). Larger scales are made by integer nearest-neighbour upscaling in the exporter, so they cost no GPU time.

## Goals

- G1: One click from the editor to an engine-ready sheet + metadata + credits.
- G2: Byte-identical files for identical inputs on the same backend and app version.
- G3: Metadata that Aseprite-aware tools (Phaser, many engine importers) read without changes, plus our own manifest for exact reproduction.
- G4: Honest licensing: every used asset is credited, and risky licenses are confirmed before download.

## Non-goals

- NG1: Texture packing with trimming or rotation (MaxRects etc.). Cells are a fixed size on a grid. Trimming may come later.
- NG2: Server-side or cloud export, and "share to" integrations (P-03).
- NG3: Video formats (MP4/WebM).
- NG4: Per-part layer export (see spec 003 NG3). [Revisit after M3.]
- NG5: Writing directly into a game project folder (File System Access API). Downloads only in v1.

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | a PNG sheet with one row per animation and direction, plus JSON | I can slice it in my engine |
| US-2 | P1 | indie game dev | 1×, 2× and 4× versions in one export | I can use them in UI and in the game world |
| US-3 | P1 | indie game dev | a CREDITS.txt and a warning if an asset can't be used commercially | I ship legally |
| US-4 | P1 | indie game dev | progress and a cancel button | a long export doesn't lock the editor |
| US-5 | P2 | Godot/Phaser dev | an engine-specific file | I can drop the sheet into my project without writing glue code |
| US-6 | P2 | indie game dev | a GIF/APNG of each animation | I can post previews or check them quickly |

## Requirements

### Inputs and cell content

**REQ-EXP-001 [P1]** THE SYSTEM SHALL build every export from the `RenderedFrame` sequence of spec 003, ordered by clip (in `RenderSettings.animations` order), then direction (by index), then frame index. It SHALL reject frames whose size differs from the first frame with `EXP_FRAME_SIZE_MISMATCH`.

- **AC-EXP-001.1** Given frames delivered out of order by the renderer, When the exporter runs, Then the sheet and metadata order is clip → direction → frame.
- **AC-EXP-001.2** Given one 64×64 frame and one 48×64 frame, Then the export fails with `EXP_FRAME_SIZE_MISMATCH`.

**REQ-EXP-002 [P1]** THE SYSTEM SHALL copy each frame into its cell without resampling, blending or color conversion. Pixels outside every cell (padding, margin, power-of-two fill) are RGBA (0, 0, 0, 0).

- **AC-EXP-002.1** Given a fixture export at scale 1, When each cell is cropped from the sheet, Then it equals the input frame byte for byte.
- **AC-EXP-002.2** Given padding 2, Then every padding pixel is (0, 0, 0, 0).

### Sheet layout

**REQ-EXP-003 [P1]** WHERE the layout is `grid-by-animation` THE SYSTEM SHALL write one PNG with one row per (clip, direction) pair and one column per frame. Rows are clip-major by default, or direction-major when `rowOrder = 'direction-major'`. Rows shorter than the longest clip leave empty transparent cells.

- **AC-EXP-003.1** Given clips `idle` (4 frames) and `walk` (8 frames) at 8 directions, 64 px, padding 0, Then the sheet is 512×1024 px, row 0 is `idle/e`, row 8 is `walk/e`, and cells 4–7 of `idle` rows are transparent.
- **AC-EXP-003.2** Given `rowOrder = 'direction-major'`, Then row 0 is `idle/e` and row 1 is `walk/e`.

**REQ-EXP-004 [P1]** WHERE `maxColumns` is set (1–256) THE SYSTEM SHALL wrap each (clip, direction) row after `maxColumns` frames onto the following row(s), and never put frames of two different (clip, direction) pairs on one row.

- **AC-EXP-004.1** Given an 8-frame clip, 1 direction and `maxColumns = 3`, Then the clip uses 3 rows (3 + 3 + 2 frames) and the sheet is 3 columns wide.

**REQ-EXP-005 [P1]** WHERE the layout is `strip-per-animation` THE SYSTEM SHALL write one PNG per clip, with one row per direction and one column per frame, and the metadata SHALL reference each PNG.

- **AC-EXP-005.1** Given 3 clips, Then 3 PNGs named per REQ-EXP-016 are produced, and each has `directions` rows.

**REQ-EXP-006 [P1]** THE SYSTEM SHALL apply `paddingPx` (0–16) between neighbouring cells and `marginPx` (0–16) around the outer edge of every sheet.

- **AC-EXP-006.1** Given 4 columns of 32 px, padding 2 and margin 1, Then the sheet width is `1 + 4×32 + 3×2 + 1 = 136` px and cell (col 1, row 0) starts at x = 35.

**REQ-EXP-007 [P2]** WHERE `powerOfTwo` is enabled THE SYSTEM SHALL extend each sheet's width and height independently to the next power of two by adding transparent pixels on the right and bottom, without moving cells.

- **AC-EXP-007.1** Given a 136×64 sheet, Then the output is 256×64 and the cell rectangles in the metadata are unchanged.

**REQ-EXP-008 [P3]** WHERE `extrudePx` (0–2) is set THE SYSTEM SHALL copy each cell's edge pixels outward into the padding by that many pixels, and SHALL require `paddingPx ≥ 2 × extrudePx`.

- **AC-EXP-008.1** Given extrude 1 and padding 2, Then the pixel left of each cell's left edge equals the edge pixel. Given extrude 2 and padding 2, Then validation fails with `EXP_INVALID_SETTINGS`.

### Scales

**REQ-EXP-009 [P1]** THE SYSTEM SHALL export one complete file set for each selected scale in `scales` (subset of 1, 2, 4, 8; at least one), upscaling every cell by nearest-neighbour replication of each pixel into an s×s block. Padding and margin are scaled too, and power-of-two is applied after scaling.

- **AC-EXP-009.1** Given scales [1, 2, 4], Then three PNG sheets are produced, and for each the 2× (4×) sheet equals the 1× sheet with each pixel replicated 2×2 (4×4).
- **AC-EXP-009.2** Given scales [], Then validation fails with `EXP_INVALID_SETTINGS`.

### Metadata

**REQ-EXP-010 [P1]** WHERE metadata is `aseprite-json` THE SYSTEM SHALL write an Aseprite-compatible JSON file in the array form (`frames` as an array) per sheet and scale, with `frame`, `rotated: false`, `trimmed: false`, `spriteSourceSize`, `sourceSize` and `duration` (ms) per frame, and `meta` with `app`, `version`, `image`, `format: "RGBA8888"`, `size`, `scale` and one `frameTags` entry per (clip, direction).

- **AC-EXP-010.1** Given a fixture export, When the JSON is loaded by Phaser 3's `load.aseprite` + `anims.createFromAseprite` in a headless test, Then one animation per (clip, direction) is created with the right frame count.
- **AC-EXP-010.2** Given clip fps 12, Then every frame's `duration` is `round(1000 / 12) = 83`.
- **AC-EXP-010.3** Given a non-looping clip, Then its tag has `"direction": "forward"` and the manifest records `loop: false`. Given a looping clip, Then the tag direction is also `"forward"` (looping is a playback choice in the engine) and the manifest records `loop: true`.
- **AC-EXP-010.4** Given an animation with `pingPong: true` and `bakePingPong: false` (spec 004 REQ-ANM-010), Then its tags have `"direction": "pingpong"` and the manifest records `direction: 'pingpong'`. Given `bakePingPong: true`, Then the baked frames are written in sequence and the tag direction is `"forward"`.

**REQ-EXP-011 [P1]** WHERE metadata is `json` or `aseprite-json` THE SYSTEM SHALL write our own manifest `<base>.manifest.json` following the `SpriteExportManifest` contract (Data & contracts). It records app version, three.js version, backend, a SHA-256 of the canonical ProjectDocument, cell size, pivot, scales, and per frame its clip, direction label, frame index, sheet file and rectangle.

- **AC-EXP-011.1** Given a fixture export, When the manifest is validated against its Zod schema, Then it passes, and `frames.length` equals the number of rendered frames.
- **AC-EXP-011.2** Given the manifest and the ProjectDocument used, When `sha256(canonicalJson(project))` is recomputed, Then it equals `manifest.source.projectSha256`.

**REQ-EXP-012 [P1]** THE SYSTEM SHALL name frames `<label>_<dir>_<frame>`, with the frame index zero-padded to 3 digits, and tags `<label>_<dir>` (e.g. `walk_ne_004`, `walk_ne`), using the animation `label` (spec 004) and the direction labels from spec 003 `DIRECTION_ORDER`. Because labels contain no `_`, the parts of a name split unambiguously at `_`.

- **AC-EXP-012.1** Given an animation labelled `attack-1`, direction `s`, frame 0, Then the frame name is `attack-1_s_000`.
- **AC-EXP-012.2** Given clip `builtin:quaternius-ual/attack-1` added twice with labels `attack-1` and `attack-1-2` (REQ-ANM-006), Then the tags are `attack-1_<dir>` and `attack-1-2_<dir>`, and no name contains `:`, `/` or `#`.

### Per-frame PNGs and animated previews

**REQ-EXP-013 [P1]** WHERE the layout is `frames-zip` THE SYSTEM SHALL write one PNG per frame named `<base>/<label>/<dir>/<frame>.png` (frame zero-padded to 3 digits) inside the export ZIP, for each selected scale (`<base>@<s>x/…` for s > 1).

- **AC-EXP-013.1** Given 2 clips × 2 directions × 4 frames at scale 1, Then the ZIP contains 16 frame PNGs at the expected paths, plus metadata and `CREDITS.txt`.

**REQ-EXP-014 [P2]** WHERE `previews.apng` is enabled THE SYSTEM SHALL write one looping APNG per (clip, direction) at `previews.scale`, with frame delay exactly `1/fps` s (`delay_num = 1`, `delay_den = fps`).

- **AC-EXP-014.1** Given a 12 fps clip, When the APNG is parsed, Then every `fcTL` chunk has delay 1/12, and `acTL.num_plays = 0`.

**REQ-EXP-015 [P2]** WHERE `previews.gif` is enabled THE SYSTEM SHALL write one looping GIF per (clip, direction) with a single global color table, transparency index for alpha-0 pixels, and frame delay `max(2, round(100 / fps))` centiseconds. IF the frames contain more than 255 distinct opaque colors THEN THE SYSTEM SHALL skip the GIF, emit warning `EXP_GIF_TOO_MANY_COLORS`, and suggest a palette or APNG.

- **AC-EXP-015.1** Given palette `pico-8` and an 8 fps clip, Then the GIF's color table has ≤ 17 entries and each frame delay is 13 cs.
- **AC-EXP-015.2** Given palette `none` and a fixture with 400 distinct colors, Then no GIF is written and the warning is shown.

### Files, naming and packaging

**REQ-EXP-016 [P1]** THE SYSTEM SHALL derive the base file name from `ExportSettings.baseName`, or else from `CharacterSpec.name`, sanitized to `[a-z0-9-]`, lowercased, with runs of other characters replaced by one `-`, trimmed of leading and trailing `-`, at most 64 characters, and `character` if the result is empty. File names follow the table in Data & contracts.

- **AC-EXP-016.1** Given name `"Sir Knight #2 (blue)"`, Then the base name is `sir-knight-2-blue` and the 2× sheet is `sir-knight-2-blue@2x.png`.
- **AC-EXP-016.2** Given name `"???"`, Then the base name is `character`.

**REQ-EXP-017 [P1]** WHEN an export produces more than one file THE SYSTEM SHALL offer a single ZIP download `<base>.zip`. WHEN it produces exactly one file plus `CREDITS.txt` THE SYSTEM SHALL still use the ZIP, so that credits always travel with the sprites.

- **AC-EXP-017.1** Given any export, Then the user receives exactly one download, and it is a ZIP containing `CREDITS.txt` at its root.

**REQ-EXP-018 [P1]** THE SYSTEM SHALL write files deterministically. PNGs are 8-bit RGBA (color type 6), non-interlaced, with only `IHDR`, `IDAT`, `IEND` and, for APNG, `acTL`/`fcTL`/`fdAT`. There is no `tIME`, `tEXt` or `iCCP`, and a fixed zlib level is used. ZIP entries are sorted by path, use DOS time 1980-01-01 00:00:00 and no extra fields. JSON uses UTF-8, a fixed key order, 2-space indentation, LF line endings and a trailing newline, and contains no wall-clock values.

- **AC-EXP-018.1** Given the same ProjectDocument exported twice on the same backend (once after a reload), Then the SHA-256 of the ZIP, and of every file in it, is identical.
- **AC-EXP-018.2** Given an exported PNG, When its chunks are listed, Then only the allowed chunk types appear.
- **AC-EXP-018.3** Given the exporter running in Node on fixture frames, Then its output hashes equal the committed golden hashes.

**REQ-EXP-019 [P2]** WHERE `pngColorType = 'indexed'` and the frames contain ≤ 255 distinct opaque colors THE SYSTEM SHALL write palette PNGs (color type 3, `PLTE` + `tRNS` with index 0 transparent), with palette entries sorted by first occurrence in row-major order.

- **AC-EXP-019.1** Given a `pico-8` export with indexed PNGs, When decoded, Then the RGBA pixels equal the RGBA export byte for byte.

### Credits and licensing

**REQ-EXP-020 [P1]** THE SYSTEM SHALL always include `CREDITS.txt` listing every asset used by the export: body, equipped parts (including parts with hidden regions), animation clips used, face decal and palette preset. Each entry gives title or name, the `AssetRef` (the `ClipRef` for clips; consistency review 2026-10-08), license, author, source URL and whether attribution is required. Entries are sorted by that ref string (code-unit order) and the file format follows Data & contracts.

- **AC-EXP-020.1** Given a character with 1 body, 4 parts, 1 user upload, 2 clips and palette `endesga-32`, Then `CREDITS.txt` has 9 entries in `AssetRef` order, and the user upload shows the license, author and source URL declared at upload (spec 008).
- **AC-EXP-020.2** Given `ExportSettings.includeCredits` set to `false` in a hand-edited project file, When validated, Then validation fails (the field is the literal `true`).

**REQ-EXP-021 [P1]** IF any used asset has `license: 'other'` or `commercialUse: 'unknown'` (`LICENSE_UNKNOWN`), `commercialUse: 'no'` (`LICENSE_NON_COMMERCIAL`), or a share-alike license (`LICENSE_SHARE_ALIKE`) THEN THE SYSTEM SHALL show a blocking dialog that lists the assets per warning code before export starts, and continue only after explicit confirmation.

- **AC-EXP-021.1** Given an uploaded part with license `other`, When the user clicks Export, Then a dialog lists it under "Unknown license", and no rendering starts until the user confirms. Cancel returns to the editor with nothing exported.
- **AC-EXP-021.2** Given only CC0 assets, Then no dialog is shown.
- **AC-EXP-021.3** Given a confirmed warning, Then `CREDITS.txt` contains a `WARNINGS` section repeating the codes and asset refs, and the manifest lists them in `warnings`.

**REQ-EXP-022 [P1]** THE SYSTEM SHALL list attribution-required assets in a separate "Attribution required" block at the top of `CREDITS.txt`, with one ready-to-paste line each: `"<title>" by <author> (<license>) <sourceUrl>`.

- **AC-EXP-022.1** Given one CC-BY-4.0 upload, Then the block contains exactly its line, and CC0 assets are not in the block.

### Progress, cancel, limits

**REQ-EXP-023 [P1]** WHILE an export runs THE SYSTEM SHALL report progress as `{ phase: 'render' | 'encode' | 'package', done, total }` at least every 250 ms, and keep the editor responsive, with no main-thread task longer than 50 ms caused by encoding (encoding runs in a worker).

- **AC-EXP-023.1** Given the P-07 reference export, When progress events are recorded, Then the gap between events is ≤ 250 ms, `done` is non-decreasing per phase, and the last event per phase has `done === total`.
- **AC-EXP-023.2** Given the same export under a Long Tasks observer, Then no long task over 50 ms is attributed to PNG/ZIP encoding.

**REQ-EXP-024 [P1]** WHEN the user cancels an export THE SYSTEM SHALL stop rendering and encoding within 250 ms, release its buffers, offer no download, and leave the editor state unchanged.

- **AC-EXP-024.1** Given an export at 50 % render progress, When the AbortSignal fires, Then the promise rejects with `EXP_CANCELLED` within 250 ms, no download starts, and the preview resumes.

**REQ-EXP-025 [P1]** IF a sheet would exceed 8192 px in either dimension, or the export would exceed 4096 frames or 512 MB of uncompressed RGBA across all files, THEN THE SYSTEM SHALL refuse it before rendering with `EXP_TOO_LARGE`, naming the limit and suggesting fewer scales, `maxColumns`, `strip-per-animation` or fewer directions. Above 4096 px in either dimension it SHALL warn `EXP_LARGE_TEXTURE` (some mobile GPUs and engines cap textures at 4096).

- **AC-EXP-025.1** Given 128 px cells, scale 8 and 9 columns (9216 px wide), Then export is refused with `EXP_TOO_LARGE` before any frame renders.
- **AC-EXP-025.2** Given a 4608 px wide sheet, Then the export proceeds and the warning `EXP_LARGE_TEXTURE` is shown and written to the manifest.

**REQ-EXP-026 [P1]** THE SYSTEM SHALL complete the P-07 reference export (64 px, 8 directions, 4 clips × 8 frames, scale 1, `aseprite-json`) in ≤ 10 s end to end on the reference machine, with encoding and packaging ≤ 3 s of that.

- **AC-EXP-026.1** Given the perf fixture, When exported 5 times, Then the median total time is ≤ 10 s and the median encode+package time is ≤ 3 s.

**REQ-EXP-027 [P2]** IF all frames of an export are fully transparent THEN THE SYSTEM SHALL warn `EXP_EMPTY_FRAMES` before offering the download.

- **AC-EXP-027.1** Given a character with every region hidden and no parts, Then the warning is shown, and the user can still download.

### Engine presets

**REQ-EXP-028 [P2]** WHERE `enginePreset = 'godot4'` THE SYSTEM SHALL also write `<base>.tres`, a Godot 4 `SpriteFrames` resource (`format=3`) with one `AtlasTexture` sub-resource per frame (region = cell rectangle), one animation per (clip, direction) named `<label>_<dir>`, `speed` = fps, `loop` from the clip, and the sheet referenced as `res://<base>.png` relative to the `.tres`.

- **AC-EXP-028.1** Given a fixture export, When the `.tres` is loaded by Godot 4 headless (`--headless --script` test in CI), Then the animation names, frame counts, speeds and loop flags match the manifest.

**REQ-EXP-029 [P2]** WHERE `enginePreset = 'phaser3'` THE SYSTEM SHALL write the Aseprite JSON (REQ-EXP-010) together with a Phaser JSON-hash atlas `<base>.atlas.json` (frames keyed by frame name), and a short `README-phaser.txt` showing the loader calls.

- **AC-EXP-029.1** Given the atlas, When loaded by `this.load.atlas` in a headless Phaser test, Then every frame name from the manifest resolves to the right rectangle.

**REQ-EXP-030 [P3]** WHERE `enginePreset = 'unity'` THE SYSTEM SHALL write metadata that lets Unity slice the sheet into named sprites with the pivot from spec 003. [NEEDS CLARIFICATION: target format — a `.meta` with `spriteSheet` rects (fragile across Unity versions), a TexturePacker-style JSON plus an importer script, or the 2D Sprite package's format.]

- **AC-EXP-030.1** Given the chosen format, When imported in a Unity CI project, Then the sprite names and pivots match the manifest.

**REQ-EXP-031 [P3]** WHERE `enginePreset = 'tiled'` THE SYSTEM SHALL write a Tiled tileset JSON (`.tsj`) that uses the sheet as an image, with tile width/height = cell size, spacing = padding, margin = margin, and one animated tile per (clip, direction) whose frames have `duration` = `round(1000 / fps)` ms.

- **AC-EXP-031.1** Given the `.tsj`, When opened by the Tiled CLI or parsed by a test against the Tiled JSON schema, Then tile count, spacing and animation durations match the manifest.

## Edge cases

- Clips with different fps in one sheet → durations per frame differ, manifest records fps per clip (REQ-EXP-010, 011).
- Clip with 1 frame → a one-cell row; GIF/APNG preview is a single still frame (REQ-EXP-003, 014, 015).
- `mirrorWest` frames (spec 003) → exported like rendered frames, and the manifest marks `mirrored: true` (REQ-EXP-011).
- Character name with non-Latin characters only (`"騎士"`) → base name `character` (REQ-EXP-016).
- Same clip selected twice → allowed with distinct labels (spec 004 REQ-ANM-006). The exporter asserts unique (label, direction) tags and fails with `EXP_DUPLICATE_TAG` if two entries share a label.
- Ping-pong in engines without ping-pong playback (Godot `SpriteFrames`, Tiled animated tiles) → those files list the frames as sampled; the export dialog suggests `bakePingPong` (spec 004 REQ-ANM-010). Aseprite JSON and Phaser use `pingpong` (AC-EXP-010.4).
- User asset deleted from OPFS between composing and exporting → render fails earlier (UPL/CMP). Credits never list missing assets.
- Asset license changed after upload (edited record) → credits use the record at export time (REQ-EXP-020).
- Browser blocks downloads or storage is full → `EXP_DOWNLOAD_FAILED` with retry, and nothing is lost (REQ-EXP-017).
- Cancel during packaging → same as REQ-EXP-024.
- Export of 1 direction with label `s` → tags `<label>_s` (REQ-EXP-012).
- Feet or a lying pose below the ground row → with auto framing spec 003 fits them into the cell and no `PIX_FRAMING_CLIPPED` warning is passed through; the warning appears only with fixed framing or when `pivotRowPx` leaves no room below the outline margin (spec 003 REQ-PIX-007 note, AC-PIX-009.3). The pivot in the manifest is unchanged (REQ-PIX-008). *(Added 2026-10-09 (M2-01b).)*
- WebGL2 without `EXT_color_buffer_float` → the pixel pipeline cannot be created and the export fails with `PIX_BACKEND_UNAVAILABLE` before any frame is rendered; no files are offered (spec 003 AC-PIX-026.2). *(Added 2026-10-09 (M2-01b).)*

## Data & contracts

Refines `ExportSettings` and `SpriteSheetExport` in `docs/architecture.md` §3.4 / §3.6. `scale` becomes `scales` (multi-scale); the architecture doc must be updated in the implementing PR.

```ts
export interface ExportSettings {
  /** NEW. Optional override for the file base name (sanitized per REQ-EXP-016). */
  baseName?: string;
  layout: 'grid-by-animation' | 'strip-per-animation' | 'frames-zip';
  /** NEW. Row order for grid-by-animation. Default 'clip-major'. */
  rowOrder: 'clip-major' | 'direction-major';
  /** NEW. Wrap rows after N frames (1..256); null = no wrap. */
  maxColumns: number | null;
  /** CHANGED from `scale`. Non-empty, unique, ascending. Default [1]. */
  scales: Array<1 | 2 | 4 | 8>;
  paddingPx: number; // 0..16, default 0
  /** NEW. 0..16, default 0. */
  marginPx: number;
  /** NEW [P2]. Default false. */
  powerOfTwo: boolean;
  /** NEW [P3]. 0..2, default 0. */
  extrudePx: number;
  /** 'json' = manifest only; 'aseprite-json' = Aseprite JSON + manifest (default). */
  metadata: 'none' | 'json' | 'aseprite-json';
  /** NEW [P2]. Default 'rgba'. */
  pngColorType: 'rgba' | 'indexed';
  /** NEW [P2/P3]. Default 'none'. */
  enginePreset: 'none' | 'godot4' | 'phaser3' | 'unity' | 'tiled';
  /** NEW [P2]. Default both false, scale 2. */
  previews: { gif: boolean; apng: boolean; scale: 1 | 2 | 4 | 8 };
  includeCredits: true;
}

/** Pure; no three.js. Runs in a worker. */
export function exportSpriteSheet(
  frames: RenderedFrame[],
  settings: ExportSettings,
  context: ExportContext,
  options?: { signal?: AbortSignal; onProgress?: (p: ExportProgress) => void },
): Promise<Result<SpriteSheetExport, EngineError>>;

export interface ExportContext {
  render: RenderSettings;
  /** canonicalJson(ProjectDocument) hash, computed by the caller. */
  projectSha256: string;
  characterName: string;
  /** `ref` is a ClipRef for kind 'clip', otherwise an AssetRef (consistency review 2026-10-08, MED-7). */
  credits: Array<{ ref: AssetRef | ClipRef; kind: 'body' | 'part' | 'clip' | 'decal' | 'palette'; license: AssetLicense }>;
  build: { appVersion: string; threeVersion: string; backend: 'webgpu' | 'webgl2' };
  /** Pivot in cell pixels, top-left origin (spec 003 REQ-PIX-008). */
  pivotPx: [number, number];
}

export interface ExportProgress {
  phase: 'render' | 'encode' | 'package';
  done: number;
  total: number;
}

export interface SpriteSheetExport {
  /** Sorted by name. The UI zips them per REQ-EXP-017. */
  files: Array<{ name: string; mime: string; bytes: Uint8Array }>;
  warnings: Array<{
    code:
      | 'LICENSE_UNKNOWN' | 'LICENSE_NON_COMMERCIAL' | 'LICENSE_SHARE_ALIKE'
      | 'EXP_LARGE_TEXTURE' | 'EXP_GIF_TOO_MANY_COLORS' | 'EXP_EMPTY_FRAMES' | 'PIX_FRAMING_CLIPPED';
    assets?: AssetRef[];
    message?: string;
  }>;
}

export interface SpriteExportManifest {
  format: 'sprite-export-manifest';
  version: 1;
  source: { projectSha256: string; appVersion: string; threeVersion: string; backend: 'webgpu' | 'webgl2' };
  cell: { width: number; height: number };
  pivotPx: [number, number];
  directions: string[]; // labels in index order
  scales: number[];
  sheets: Array<{ file: string; scale: number; width: number; height: number }>;
  clips: Array<{
    label: string;          // spec 004 AnimationSelection.label; used in all names
    clipId: string;         // ClipRef, for reproduction only
    fps: number;
    frameCount: number;     // emitted frames (after bakePingPong)
    loop: boolean;
    direction: 'forward' | 'pingpong';
  }>;
  frames: Array<{
    name: string; // walk_ne_004
    label: string;
    direction: string;
    frame: number;
    durationMs: number;
    mirrored: boolean;
    /** Rect at scale 1; multiply by scale for other sheets. */
    sheet: string;
    rect: { x: number; y: number; w: number; h: number };
  }>;
  warnings: SpriteSheetExport['warnings'];
}
```

**File names** (`<base>` from REQ-EXP-016, `@<s>x` suffix only for s > 1)

| File | Name |
|------|------|
| Sheet (grid) | `<base>.png`, `<base>@2x.png` |
| Sheet (strip) | `<base>_<label>.png`, `<base>_<label>@2x.png` |
| Aseprite JSON | same stem as the sheet + `.json` |
| Manifest | `<base>.manifest.json` (one, covering all scales) |
| Frames | `<base>/<label>/<dir>/<frame>.png`, `<base>@2x/…` |
| Previews | `previews/<label>_<dir>.gif` / `.png` (APNG) |
| Godot | `<base>.tres` (one per scale, `<base>@2x.tres`) |
| Phaser atlas | `<base>.atlas.json` |
| Credits | `CREDITS.txt` |
| Download | `<base>.zip` |

**Aseprite JSON example** (one frame shown)

```json
{
  "frames": [
    {
      "filename": "walk_e_000",
      "frame": { "x": 0, "y": 0, "w": 64, "h": 64 },
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 64, "h": 64 },
      "sourceSize": { "w": 64, "h": 64 },
      "duration": 83
    }
  ],
  "meta": {
    "app": "https://github.com/<org>/character-sprite-generator",
    "version": "0.1.0",
    "image": "knight.png",
    "format": "RGBA8888",
    "size": { "w": 512, "h": 1024 },
    "scale": "1",
    "frameTags": [{ "name": "walk_e", "from": 0, "to": 7, "direction": "forward" }],
    "layers": [],
    "slices": []
  }
}
```

**CREDITS.txt format** (UTF-8, LF)

```
Credits for knight (exported with Character Sprite Generator 0.1.0)

== Attribution required ==
"Leather Hood" by Jane Doe (CC-BY-4.0) https://example.org/hood

== All assets ==
builtin:quaternius-ubc/body-regular-m
  Title: Regular Male | License: CC0-1.0 | Author: Quaternius
  Source: https://quaternius.itch.io/universal-base-characters | Attribution required: no
user:6f1c…
  Title: Leather Hood | License: CC-BY-4.0 | Author: Jane Doe
  Source: https://example.org/hood | Attribution required: yes

== WARNINGS ==
LICENSE_UNKNOWN: user:9a2e…
```

The `WARNINGS` section appears only when warnings exist. No dates or times appear in the file.

**Error codes:** `EXP_FRAME_SIZE_MISMATCH`, `EXP_INVALID_SETTINGS`, `EXP_TOO_LARGE`, `EXP_CANCELLED`, `EXP_DUPLICATE_TAG`, `EXP_DOWNLOAD_FAILED`; warnings as listed in `SpriteSheetExport`.

## Non-functional

- Determinism: P-04, strengthened. Our own encoders make the **files** byte-identical, not just the pixel data (REQ-EXP-018).
- Privacy: P-03. Export is a local download. No network request is made during export (covered by AC-GEN-003.1).
- Licensing: P-02 (REQ-EXP-020 to 022).
- Performance: P-07 export budget (REQ-EXP-026). Architecture §4.3 has a stricter target (5 clips × 8 × 8 < 5 s), which stays a stretch goal. The constitution wins.
- Memory: peak extra memory during export ≤ 2× the uncompressed size of all output images, and ≤ 1 GB (REQ-EXP-025 caps the input at 512 MB).
- Accessibility: P-06. The progress UI, the license dialog and cancel work by keyboard and announce progress via `aria-live` (UI details in spec 009).
- Framework-agnostic: exporters live in `packages/engine/src/export/` with no three.js or DOM imports (P-10), and are unit-tested in Node.

## Open questions

- [NEEDS CLARIFICATION: Should the Aseprite JSON carry a `meta.csg` block (manifest hash, pivot) so a single file is enough, or stay strictly vanilla? Current choice: vanilla + separate manifest. Owner: maintainers.]
- [NEEDS CLARIFICATION: Unity target format for REQ-EXP-030. Owner: community/maintainers. Not blocking (P3).]
- [NEEDS CLARIFICATION: Should GIF previews also be used by the website (spec 010, W2)? If so, the site needs a fixed export preset. Owner: web track.]
- [NEEDS CLARIFICATION: Should `CREDITS.txt` list the app itself and its code license? Proposal: one footer line with the repo URL and license. Owner: maintainers.]
- [NEEDS CLARIFICATION: Sheet paging (splitting into several PNGs instead of refusing with `EXP_TOO_LARGE`)? Proposal: P2 follow-up.]

## References

- `docs/architecture.md` §2.1, §3.4, §3.6, §4.1, §4.3
- `specs/constitution.md` P-02, P-03, P-04, P-07, P-10
- Spec 003 (PIX): `RenderedFrame`, pivot, `DIRECTION_ORDER`, `PIX_FRAMING_CLIPPED`, `PIX_BACKEND_UNAVAILABLE` (amended 2026-10-09 (M2-01b))
- ADR-0005 (licensing UX, local-first)
- Aseprite CLI `--sheet` / `--data` JSON format: https://www.aseprite.org/docs/cli/ (accessed 2026-10-08)
- Phaser 3 Aseprite loader: https://docs.phaser.io/api-documentation/class/loader-loaderplugin#aseprite (accessed 2026-10-08)
- Godot 4 SpriteFrames: https://docs.godotengine.org/en/stable/classes/class_spriteframes.html (accessed 2026-10-08)
- Tiled JSON map format (tilesets, animations): https://doc.mapeditor.org/en/stable/reference/json-map-format/ (accessed 2026-10-08)
- PNG spec (chunks, color types): https://www.w3.org/TR/png-3/ (accessed 2026-10-08)
- APNG (`acTL`, `fcTL`, `fdAT`): https://www.w3.org/TR/png-3/#apng-frame-based-animation (accessed 2026-10-08)
- GIF89a (delays in 1/100 s, browser minimum delay behaviour): https://www.w3.org/Graphics/GIF/spec-gif89a.txt (accessed 2026-10-08)
- ZIP APPNOTE (DOS timestamps): https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (accessed 2026-10-08)
