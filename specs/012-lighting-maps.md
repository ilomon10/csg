---
id: LIT
title: 2D lighting maps (normal, albedo, mask, specular, UV lookup, depth, emission)
status: draft
owner: spec-writer (review: graphics-engineer)
depends_on: [constitution, 000-overview, 003-pixel-render-pipeline, 004-animation, 005-export]
last_updated: 2026-10-09
---

# 012 – 2D lighting maps

## Context

Users asked for exports that 2D engines can light at runtime (user request 2026-10-09, PM decision in `.tagconn/work/backlog.md`, research brief `.tagconn/work/research-lighting-maps.md`). Godot 4 (`CanvasTexture`), Unity 2D URP (sprite secondary textures `_NormalMap` / `_MaskTex`), Phaser 3 (`Light2D` pipeline) and Defold (multi-texture sprites, ≥ 1.6.4) all light a sprite from a **normal map** laid out exactly like the colour sheet. Hand-drawn pipelines paint these maps or generate them with tools such as Sprite Illuminator or Laigter. We render from 3D, so the scene pass already holds the exact view-space normal, depth and part ID of every pixel (spec 003 REQ-PIX-014). We can export the maps directly and also write true mesh UVs for runtime outfit and palette swaps (the "UV lookup sprite" technique).

This spec owns the auxiliary maps: what each map contains, its encoding, its files and metadata, and the engine presets that wire them up. Sheet layout, naming base, scales, PNG/ZIP determinism and credits stay with spec 005 (EXP). The scene pass, MRT targets and frame readback stay with spec 003 (PIX). Maps reuse the single scene render per frame (REQ-PIX-014); they add post work and readbacks, never another scene pass.

The colour sheet bakes toon lighting. A dynamic light on top of it lights the character twice, so this spec also adds an **albedo** (unlit) colour sheet.

## Goals

- G1: One export gives a 2D engine everything it needs for dynamic lighting: colour or albedo sheet, normal map, optional mask and specular maps, with identical layout.
- G2: Maps are pixel-exact companions of the colour sprite: same cells, same coverage, no anti-aliasing, deterministic bytes.
- G3: Engine-ready wiring for Godot 4, Unity 2D URP and Phaser 3 without hand-written glue.
- G4: UV lookup maps so games can swap outfits, palettes or damage textures at runtime across all frames and directions.

## Non-goals

- NG1: An in-app 2D lighting engine or a lit preview with movable lights. The preview only shows each map as an image (REQ-LIT-026).
- NG2: Hand-painting or editing maps in the app. Users who want to retouch maps do it in an external editor.
- NG3: Generating maps for imported 2D images (Sprite Illuminator / Laigter style). Maps come only from the 3D render.
- NG4: Engine presets for Defold, GameMaker or LÖVE in v1. The user guide documents their manual setup.
- NG5: Shadows cast by the sprite, ambient occlusion, or baked light probes.
- NG6: Per-part layer export (spec 005 NG4 still applies).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | a `_n.png` normal map with the same layout as my sheet | my engine's 2D lights shade the character |
| US-2 | P1 | indie game dev | an unlit albedo sheet | dynamic lights don't double the baked toon lighting |
| US-3 | P1 | indie game dev | the JSON metadata to name the maps and their conventions | my import script finds and configures them |
| US-4 | P2 | Unity dev | a mask map and import notes for `_NormalMap` / `_MaskTex` | Light2D blend styles work out of the box |
| US-5 | P2 | Godot dev | a `CanvasTexture` resource that references diffuse, normal and specular | I drop it on a `Sprite2D` and it is lit |
| US-6 | P2 | tech artist | a UV lookup map with part IDs | I recolour or reskin all frames at runtime with one small texture |
| US-7 | P3 | tech artist | depth and emission maps, a y-down normal option and normal quantization | I can do self-shadowing, glow and a chunkier lit look |

## Requirements

Terms: **covered** pixel = coverage after alpha cutoff (REQ-PIX-023); **opaque** pixel = colour frame alpha 255 (covered pixels plus outline pixels); **colour sheet** = the spec 005 sheet; **map** = any file defined here. `encode8(c)` = `128 + roundHalfAwayFromZero(127 · c)` for `c ∈ [-1, 1]` (range 1..255, `encode8(0) = 128`, `encode8(-c) = 256 - encode8(c)`). This is the `n · 0.5 + 0.5` encoding quantized with a mirror-symmetric rounding; it differs from `round(255 · (n · 0.5 + 0.5))` by at most 1 LSB.

### Shared rules

**REQ-LIT-001 [P1]** WHERE at least one map is enabled THE SYSTEM SHALL derive every map of a frame from the same single scene render as that frame's colour output (REQ-PIX-014), adding only post work and readbacks.

- **AC-LIT-001.1** Given an export of 2 clips × 8 directions × 4 frames with every map enabled, When scene renders are counted with a spy, Then the count equals the number of GPU-rendered frames (64 without `mirrorWest`), the same as with all maps disabled.

**REQ-LIT-002 [P1]** THE SYSTEM SHALL produce byte-identical colour sheets, Aseprite JSON `frames`, previews and `CREDITS.txt` whether maps are enabled or not.

- **AC-LIT-002.1** Given the spec 005 reference fixture exported with all maps off and again with all maps on, Then the SHA-256 of every colour PNG and of `CREDITS.txt` is identical, and the Aseprite JSON differs only by the `meta.maps` key (REQ-LIT-015).

**REQ-LIT-003 [P1]** THE SYSTEM SHALL write each enabled map with exactly the colour sheet's layout: the same PNG dimensions, cell rectangles, layout, row order, `maxColumns`, padding, margin, power-of-two fill, extrude and set of scales, with scales made by nearest-neighbour replication (REQ-EXP-009).

- **AC-LIT-003.1** Given layout `grid-by-animation`, scales [1, 2], padding 2, margin 1, `powerOfTwo` on and the normal and albedo maps enabled, Then each map PNG has the same width and height as the colour PNG of the same scale, and every cell rectangle of the manifest addresses the same frame in each file.
- **AC-LIT-003.2** Given the 1× and 2× normal maps, Then the 2× file equals the 1× file with each pixel replicated 2×2.
- **AC-LIT-003.3** Given `strip-per-animation` with 3 clips and the normal map on, Then 3 normal map PNGs are written, one per strip, named per Data & contracts.

**REQ-LIT-004 [P1]** THE SYSTEM SHALL give the normal, albedo, mask, depth and emission maps the same alpha byte as the colour frame at every pixel (255 on opaque pixels, 0 elsewhere). The UV map (REQ-LIT-022) and the specular map (REQ-LIT-021) define their own alpha.

- **AC-LIT-004.1** Given the default character exported with normal, albedo, mask, depth and emission on, When the alpha channels are compared with the colour sheet, Then they are identical byte for byte in every file and scale.

**REQ-LIT-005 [P1]** THE SYSTEM SHALL write data maps (normal, mask, specular, UV, depth) as 8-bit RGBA PNGs (colour type 6) that are linear data: no sRGB conversion, no palette quantization, no dither, and no `sRGB`, `gAMA`, `cHRM` or `iCCP` chunk (REQ-EXP-018), also WHERE `pngColorType = 'indexed'`.

- **AC-LIT-005.1** Given palette `pico-8`, dither `bayer4` strength 1 and `pngColorType = 'indexed'`, When the normal map is decoded, Then it is colour type 6, it equals byte for byte the normal map of the same export with palette `none` and dither `none`, and its chunk list is exactly `IHDR`, `IDAT`, `IEND`.

### Normal map

**REQ-LIT-006 [P1]** WHERE `maps.normal` is enabled THE SYSTEM SHALL write `<stem>_n.png` holding, for each covered pixel, the view-space unit normal of the visible surface of that frame's direction (after the direction rotation of REQ-PIX-005, x screen-right, y screen-up, z toward the viewer), encoded per channel as `encode8` (R = x, G = y, B = z, green-up / OpenGL convention).

- **AC-LIT-006.1** Given the cube fixture of AC-PIX-012.4 (front face `N = (0, 0, 1)`), When exported with the normal map, Then every covered pixel of the front face is (128, 128, 255, 255).
- **AC-LIT-006.2** Given the sphere fixture at 64 px, side view, When the normal map is decoded with `n = (c - 128) / 127`, Then for every covered pixel at least 2 px inside the silhouette the angle between `n` and the analytic sphere normal at the pixel centre is ≤ 5°, pixels left of the centre column have R < 128, and pixels above the centre row have G > 128.
- **AC-LIT-006.3** Given the cube fixture rendered for directions `e` and `s` (8 directions), Then the visible faces' encoded normals follow the rotated geometry (the face toward the camera reads B = 255 in both directions), showing the normal is taken after the direction rotation.

**REQ-LIT-007 [P1]** THE SYSTEM SHALL normalize each normal before encoding; IF its z component is negative THEN THE SYSTEM SHALL set z to 0 and renormalize x and y; IF the vector has length below 1e-6 (before or after that step) THEN THE SYSTEM SHALL use (0, 0, 1).

- **AC-LIT-007.1** Given the pure encoder, Then (0, 0, 1) → (128, 128, 255); (1, 0, 0) → (255, 128, 128); (-1, 0, 0) → (1, 128, 128); (0, -1, 0) → (128, 1, 128); (0.6, 0.8, 0) → (204, 230, 128); (0.6, 0, -0.8) → (255, 128, 128); (0, 0, 0) → (128, 128, 255).
- **AC-LIT-007.2** Given any fixture export, Then no covered pixel of the normal map has B < 128.

**REQ-LIT-008 [P1]** THE SYSTEM SHALL write every transparent pixel of the normal map, including padding, margin and power-of-two fill, as (128, 128, 255, 0) (flat normal), except pixels copied by `extrudePx`, which copy the edge pixel. This overrides the (0, 0, 0, 0) fill of REQ-EXP-002 and REQ-PIX-023 for the normal map only.

- **AC-LIT-008.1** Given padding 2 and margin 1, Then every pixel of the normal map with alpha 0 is (128, 128, 255, 0).

**REQ-LIT-009 [P1]** THE SYSTEM SHALL give each opaque pixel that is not covered (outer outline pixels, or opaque pixels added by a post graph) the encoded normal of the covered pixel chosen by the darken-neighbour rule of REQ-PIX-017 note (smallest Chebyshev distance 1–3, then first in row-major offset order; 4-neighbourhood order up, left, right, down at distance 1 for width 1); IF no covered pixel lies within Chebyshev distance 3 THEN THE SYSTEM SHALL use (128, 128, 255). Inner line pixels are covered and keep their own normal.

- **AC-LIT-009.1** Given the cube fixture with the outer outline on (width 1), Then each outline pixel above the top edge equals the normal of the covered pixel directly below it, and each outline pixel left of the left edge equals the covered pixel to its right.
- **AC-LIT-009.2** Given a unit test of the dilation reference with outer width 2 and the covered-pixel layout of AC-PIX-017.3, Then the outline pixel P takes A's normal.

**REQ-LIT-010 [P1]** WHERE `mirrorWest` produces a west-facing frame (REQ-PIX-006) THE SYSTEM SHALL produce its normal map by reflecting the matching east-facing normal frame around `pivotColumnPx` with the same pixel mapping as the colour frame, and replacing R by `256 - R` on every opaque pixel.

- **AC-LIT-010.1** Given 2 directions with `mirrorWest`, Then for every opaque pixel of the `w` normal frame, R equals `256 - R` and G, B, A equal the values of the reflected `e` pixel, and its alpha mask equals the `w` colour frame's alpha mask.

**REQ-LIT-011 [P1]** THE SYSTEM SHALL make the normal map independent of the look settings: toon bands and thresholds, rim, light direction and ambient, outline colour modes, palette and dither do not change it.

- **AC-LIT-011.1** Given the default character exported twice, once with defaults and once with 2 bands, rim off, light azimuth 45°, outline mode `custom` #203040, palette `endesga-32` and dither `bayer8`, Then the normal maps are byte-identical.

### Albedo colour sheet

**REQ-LIT-012 [P1]** WHERE `maps.albedo` is enabled THE SYSTEM SHALL write `<stem>_albedo.png`, a colour sheet rendered with toon lighting and rim forced off: each covered pixel's linear colour is `clamp(base, 0, 1)` (REQ-PIX-011 `base`, i.e. `light_k = 1`), followed by the outline, sRGB, dither, palette and final-alpha stages with the export's settings, where `darken` outlines darken the albedo colour.

- **AC-LIT-012.1** Given the cube fixture of AC-PIX-012.4 (base linear (0.5, 0.25, 0.1), rim on, 4 bands) with outlines off and palette `none`, Then every covered pixel of the albedo sheet is (188, 137, 89, 255) ± 1 per channel, while the colour sheet shows the band-2 colour and the 31 rim pixels.
- **AC-LIT-012.2** Given outer outline `black` and inner lines `darken` 0.6 with the sword-and-torso fixture of AC-PIX-016.1, Then outer outline pixels are #000000 and inner line pixels equal the albedo colour × 0.4 in linear RGB (± 1/255 after sRGB decode).
- **AC-LIT-012.3** Given palette `pico-8`, Then every opaque albedo pixel is a PICO-8 colour, and the albedo sheet is an indexed PNG WHERE `pngColorType = 'indexed'` (REQ-EXP-019).

**REQ-LIT-013 [P1]** IF the active material or post graph cannot provide the source data of an enabled map (for example a user material graph with no albedo output, spec 006) THEN THE SYSTEM SHALL skip that map's files, export the rest, and report warning `LIT_MAP_SOURCE_MISSING` naming the map and the graph, in the export dialog and the manifest.

- **AC-LIT-013.1** Given a stub material graph that provides no base colour and the albedo and normal maps enabled, Then no `_albedo` file is written, the normal map is written, and the manifest `warnings` lists `LIT_MAP_SOURCE_MISSING` with `map: 'albedo'`.

### Metadata, credits, limits

**REQ-LIT-014 [P1]** WHERE metadata is `json` or `aseprite-json` and at least one map is enabled THE SYSTEM SHALL add a `maps` object to `<base>.manifest.json` listing, per written map, its files per sheet and scale, its colour space (`srgb` for albedo and emission, `linear` otherwise), its encoding and conventions, and its transparent fill (Data & contracts).

- **AC-LIT-014.1** Given normal and albedo enabled at scales [1, 2], When the manifest is validated against its Zod schema, Then `maps.normal.files` has 2 entries pointing to existing ZIP paths, `maps.normal.convention` is `y-up`, `maps.normal.space` is `view`, `maps.normal.encoding` is `128+127n`, and `maps.albedo.colorSpace` is `srgb`.
- **AC-LIT-014.2** Given all maps off, Then the manifest has no `maps` key and is byte-identical to the spec 005 output.

**REQ-LIT-015 [P1]** WHERE metadata is `aseprite-json` and at least one map is enabled THE SYSTEM SHALL add `meta.maps` to each Aseprite JSON, mapping each map kind to the file name of that map for the JSON's own sheet and scale, plus the normal convention, and SHALL change no other key.

- **AC-LIT-015.1** Given the fixture with the normal map at scale 2, Then `meta.maps.normal.image` is `<base>_n@2x.png`, `meta.maps.normal.convention` is `y-up`, and Phaser 3's `load.aseprite` + `anims.createFromAseprite` still create the same animations as AC-EXP-010.1.

**REQ-LIT-016 [P1]** THE SYSTEM SHALL keep `CREDITS.txt` and the licence warnings of REQ-EXP-020 to 022 unchanged by maps; maps are derived from the same credited assets.

- **AC-LIT-016.1** Covered by AC-LIT-002.1 (identical `CREDITS.txt`); Given an asset with `license: 'other'`, Then the licence dialog appears exactly once per export, with or without maps.

**REQ-LIT-017 [P1]** THE SYSTEM SHALL count map files in the `EXP_TOO_LARGE` and `EXP_LARGE_TEXTURE` checks (REQ-EXP-025), in progress totals (REQ-EXP-023), and in cancellation (REQ-EXP-024).

- **AC-LIT-017.1** Given an export whose colour sheets total 300 MB of uncompressed RGBA, When the normal map is enabled (600 MB total), Then export is refused with `EXP_TOO_LARGE` before rendering.
- **AC-LIT-017.2** Given an export with maps cancelled at 50 % render progress, Then the promise rejects with `EXP_CANCELLED` within 250 ms and no map file is offered.

**REQ-LIT-018 [P1]** THE SYSTEM SHALL produce byte-identical map files for identical inputs on the same backend and app version (P-04, REQ-EXP-018), with no wall-clock values or unseeded randomness in map generation.

- **AC-LIT-018.1** Given the reference fixture with every map on, exported 3 times in one session and once after a reload, Then the SHA-256 of every map file is identical across the 4 runs, on each backend.
- **AC-LIT-018.2** Given the map encoders run in Node on fixture frames, Then their output hashes equal committed golden hashes.

**REQ-LIT-019 [P1]** THE SYSTEM SHALL keep the P-07 reference export (REQ-EXP-026) within its budget with maps off, and complete the same export with normal and albedo enabled in ≤ 1.5× the maps-off median time.

- **AC-LIT-019.1** Given the perf fixture exported 5 times with maps off and 5 times with normal + albedo, Then the maps-off median is ≤ 10 s and the maps-on median is ≤ 1.5 × the maps-off median.

**REQ-LIT-020 [P1]** THE SYSTEM SHALL validate `ExportSettings.maps` with the export settings schema, treat an absent `maps` as all maps off, and report invalid fields with `EXP_INVALID_SETTINGS` and their path.

- **AC-LIT-020.1** Given a project saved before this spec (no `maps`), When loaded, Then validation succeeds and no map is exported.
- **AC-LIT-020.2** Given `maps.quantizeNormals = 4` or `maps.normalConvention = 'x-up'`, Then validation fails with `EXP_INVALID_SETTINGS` on that path.

### Mask, specular and UV maps (P2)

**REQ-LIT-021 [P2]** WHERE `maps.specular` is enabled THE SYSTEM SHALL write `<stem>_s.png` (Godot convention): on each covered pixel RGB = intensity and A = shininess, each `round(255 · v)`, taken per part from the part's specular values or else `maps.specularDefault` (default intensity 0.25, shininess 0.5), with `round(x) = floor(x + 0.5)` and A clamped to 1..255; outline pixels and transparent pixels are (0, 0, 0, 0).
[NEEDS CLARIFICATION: where per-part specular values live: a new optional `lighting.specular { intensity, shininess }` field in the parts manifest (spec 011 / CMP schema) or a derivation from glTF `roughnessFactor`. Owner: asset-pipeline-engineer with the CMP spec owner. Until decided every part uses `maps.specularDefault`. Does not block P1.]

- **AC-LIT-021.1** Given defaults, Then every covered pixel is (64, 64, 64, 128) and every outline pixel is (0, 0, 0, 0).
- **AC-LIT-021.2** Given `specularDefault.shininess = 0`, Then covered pixels have A = 1 (never fully transparent, so engine import steps that bleed colour into alpha-0 pixels do not erase them).

**REQ-LIT-022 [P2]** WHERE `maps.uv` is enabled THE SYSTEM SHALL write `<stem>_uv.png`: on each covered pixel R = `q(u)`, G = `q(v)` from `TEXCOORD_0` of the visible surface (glTF convention, v = 0 at the top of the texture image), B = part ID (REQ-PIX-014), A = 255; on every other pixel, outline pixels included, (0, 0, 0, 0). `q(t) = min(255, floor(t' · 256))` with `t' = t` for `t ∈ [0, 1]` and `t' = t - floor(t)` otherwise.

- **AC-LIT-022.1** Given a camera-facing quad whose UVs span (0, 0) top-left to (1, 1) bottom-right covering 16×16 px, Then the top-left covered pixel has R, G ≤ 15, the bottom-right has R, G ≥ 240, R increases left to right and G top to bottom, and B equals the quad's part ID.
- **AC-LIT-022.2** Given the pure quantizer, Then `q(0) = 0`, `q(0.5) = 128`, `q(1) = 255`, `q(1.25) = 64`, `q(-0.25) = 192`.
- **AC-LIT-022.3** Given the UV map enabled, Then the manifest lists `maps.uv.parts` with each part ID, its `AssetRef` and slot, so a runtime shader knows which lookup texture to use per ID.

**REQ-LIT-023 [P2]** WHERE `maps.mask` is enabled THE SYSTEM SHALL write `<stem>_m.png` for Unity's `_MaskTex`: R = 255 on rim pixels (the REQ-PIX-012 rim set for the export's light direction, computed even when `toon.rim.enabled` is false), else 0; G = 255 on covered pixels that are not inner line pixels (light-receive), else 0; B = 0 (reserved); A = colour frame alpha (REQ-LIT-004).

- **AC-LIT-023.1** Given the cube fixture with rim off and outlines on, Then R is 255 on exactly the 31 pixels of AC-PIX-012.4, G is 255 on the 256 face pixels, and outline pixels are (0, 0, 0, 255).
- **AC-LIT-023.2** Given light elevation 90°, Then R is 0 on every pixel.

**REQ-LIT-024 [P2]** WHERE `enginePreset = 'godot4'` and the normal map is enabled THE SYSTEM SHALL also write, per colour sheet and scale, `<stem>_lit.tres`, a Godot 4 `CanvasTexture` resource (`format=3`) whose `diffuse_texture` is the colour sheet (or the albedo sheet WHERE `maps.albedo` is on), `normal_texture` the normal map, `specular_texture` the specular map when written, and `texture_filter` nearest.

- **AC-LIT-024.1** Given a fixture export, When the `.tres` is loaded by Godot 4 headless in CI, Then it is a `CanvasTexture` whose three textures resolve to the exported files and whose `texture_filter` is `TEXTURE_FILTER_NEAREST`.

**REQ-LIT-025 [P2]** WHERE `enginePreset` is `phaser3` or `unity` and a map is enabled THE SYSTEM SHALL write the engine notes of Data & contracts: for Phaser 3 a multi-atlas JSON `<base>.multiatlas.json` whose texture entries carry `normalMap` and a `README-phaser.txt` section with `load.multiatlas` and `setPipeline('Light2D')`; for Unity a `README-unity-lighting.txt` naming secondary textures `_NormalMap` and `_MaskTex`, sRGB off, point filter, no compression.
[NEEDS CLARIFICATION: Phaser's `MultiAtlasFile` reads `textures[i].normalMap` (checked in the Phaser 4.2.1 source, 2026-10-09). Confirm the same field and URL resolution in the Phaser 3 version pinned by the headless test of AC-EXP-010.1. Owner: asset-pipeline-engineer. Blocks REQ-LIT-025 only.]

- **AC-LIT-025.1** Given the Phaser multi-atlas, When loaded by `this.load.multiatlas` in the headless Phaser 3 test, Then every frame name resolves to its rectangle and the texture has the normal map as its data source.
- **AC-LIT-025.2** Given the Unity preset, Then `README-unity-lighting.txt` exists and contains the strings `_NormalMap`, `_MaskTex` (when the mask map is on) and `sRGB`.

**REQ-LIT-026 [P2]** THE SYSTEM SHALL let the user switch the preview between the colour output and each enabled map, by pointer and keyboard, showing exactly the bytes that the export cell would contain (REQ-PIX-030), with data maps shown as stored RGB on a checkerboard for alpha.

- **AC-LIT-026.1** Given the preview paused on `walk` frame 3, direction `ne`, with view `normal`, When the export with only `walk` runs, Then the exported normal cell equals the preview cell byte for byte.
- **AC-LIT-026.2** Given keyboard-only use, Then the map view control is reachable by Tab, has an accessible name, and its options are announced (P-06).

### Depth, emission and options (P3)

**REQ-LIT-027 [P3]** WHERE `maps.depth` is enabled THE SYSTEM SHALL write `<stem>_d.png` from the depth in output pixels of REQ-PIX-014 (`d`): with `depthPrecision = 8` R = G = B = `clamp(128 + round(d), 1, 255)`; with `depthPrecision = 16` `d16 = clamp(32768 + round(256 · d), 0, 65535)`, R = high byte, G = low byte, B = 0. Alpha follows REQ-LIT-004, outline pixels take the depth of the pixel chosen by REQ-LIT-009, transparent pixels are (0, 0, 0, 0).

- **AC-LIT-027.1** Given the two quads of AC-PIX-014.3 (8.0 px and −4.0 px), Then the 8-bit map reads 136 and 124, and the 16-bit map reads `d16` 34816 and 31744 (± 13, the AC-PIX-014.3 tolerance × 256).

**REQ-LIT-028 [P3]** WHERE `maps.emission` is enabled THE SYSTEM SHALL write `<stem>_e.png` with the material's emissive colour (glTF `emissiveFactor` × `emissiveTexture`) as 8-bit sRGB on covered pixels, (0, 0, 0) on outline pixels, alpha per REQ-LIT-004, without palette or dither.

- **AC-LIT-028.1** Given a fixture part with `emissiveFactor` (1, 0, 0) and no emissive texture, Then its covered pixels are (255, 0, 0, 255) and the other parts' covered pixels are (0, 0, 0, 255).

**REQ-LIT-029 [P3]** WHERE `maps.normalConvention = 'y-down'` THE SYSTEM SHALL replace G by `256 - G` on every opaque pixel of the normal map (DirectX convention) and record `y-down` in the metadata.

- **AC-LIT-029.1** Given the sphere of AC-LIT-006.2 with `y-down`, Then pixels above the centre row have G < 128, and each opaque G equals `256 -` the `y-up` value at the same pixel.

**REQ-LIT-030 [P3]** WHERE `maps.quantizeNormals = q` (odd integer 3..63) THE SYSTEM SHALL snap the x and y components of each normal to the nearest of `q` evenly spaced levels in [−1, 1] (ties away from zero), scale x and y down to unit length if `x² + y² > 1`, set `z = sqrt(max(0, 1 - x² - y²))`, then encode with REQ-LIT-007.

- **AC-LIT-030.1** Given `q = 3` and the sphere fixture, Then the opaque normal pixels use at most 9 distinct (R, G) pairs, and (0, 0, 1) still encodes to (128, 128, 255).

**REQ-LIT-031 [P3]** WHERE `maps.uvPrecision = 16` THE SYSTEM SHALL write the high bytes of `q16(t) = min(65535, floor(t' · 65536))` to `<stem>_uv.png` and the low bytes to `<stem>_uv-lo.png` (R, G low bytes, B = 0, A as `_uv.png`), so that the 8-bit file alone stays valid.

- **AC-LIT-031.1** Given the quad of AC-LIT-022.1 with `uvPrecision = 16`, Then for every covered pixel `256 · R_hi + R_lo` decodes `u` within 2⁻¹² of the analytic value at the pixel centre, and `_uv.png` equals the 8-bit export byte for byte.

## Edge cases

- No visible parts (all frames transparent) → maps are all-transparent fills (normal flat with alpha 0); `EXP_EMPTY_FRAMES` warns once (REQ-LIT-008, REQ-EXP-027).
- `mirrorWest` → normal R reflected (REQ-LIT-010); mask, UV, depth, specular, emission are reflected without value changes (REQ-LIT-003, REQ-LIT-023). The mask rim of mirrored frames sits on the mirrored side, like the colour rim (spec 003 edge cases).
- Back-facing or silhouette normals with z < 0 → clamped to z = 0 (REQ-LIT-007).
- Semi-transparent cards below the cutoff → discarded in the material (REQ-PIX-023 note), so they write no normal, UV or part ID (REQ-LIT-001).
- Outline width 2–3 → outline normals and depth from the darken-neighbour rule up to distance 3 (REQ-LIT-009).
- A user post graph that adds opaque pixels far from coverage (glow) → flat normal on those pixels (REQ-LIT-009 fallback).
- A part with several materials sharing one UV space or different UV spaces → B carries only the part ID; the material is not encoded. Documented in the guide (REQ-LIT-022).
- UVs outside [0, 1] (tiling textures) → wrapped (REQ-LIT-022, AC-LIT-022.2).
- Engine import that "fixes alpha borders" (Godot default) → only RGB of alpha-0 pixels changes; covered specular pixels keep A ≥ 1 (AC-LIT-021.2). The import notes tell users to turn it off for maps.
- Phaser object lit without a normal map disappears in some versions → the guide recommends a 1 px #7F7FFF fallback; our exports always pair sheets with maps (REQ-LIT-025).
- `metadata = 'none'` → map files are still written, with no manifest or `meta.maps` (REQ-LIT-014, REQ-LIT-015).
- `frames-zip` layout → per-frame map PNGs next to each frame (Data & contracts).
- WebGL2 attachment limits → see the MRT design note; any map that cannot be produced reports `LIT_MAP_SOURCE_MISSING` instead of failing the export (REQ-LIT-013).
- Isometric and custom elevations → normals stay view-space (screen space), which is what 2D engines expect (REQ-LIT-006).

## Data & contracts

Extends `ExportSettings` (spec 005) with an optional field. No `ProjectDocument` version bump: an absent `maps` means all off (REQ-LIT-020). The schema owner confirms this during implementation.

```ts
/** Auxiliary lighting map kinds (spec 012). */
export type LightingMapKind = 'normal' | 'albedo' | 'mask' | 'specular' | 'uv' | 'depth' | 'emission';

/** ExportSettings.maps. Every boolean defaults to false. */
export interface LightingMapSettings {
  normal: boolean; // P1, REQ-LIT-006
  albedo: boolean; // P1, REQ-LIT-012
  mask: boolean; // P2, REQ-LIT-023
  specular: boolean; // P2, REQ-LIT-021
  uv: boolean; // P2, REQ-LIT-022
  depth: boolean; // P3, REQ-LIT-027
  emission: boolean; // P3, REQ-LIT-028
  /** Default 'y-up' (OpenGL, Godot, Unity, Phaser). REQ-LIT-029. */
  normalConvention: 'y-up' | 'y-down';
  /** Odd integer 3..63; absent = no quantization. REQ-LIT-030. */
  quantizeNormals?: number;
  /** Default 8. REQ-LIT-031. */
  uvPrecision?: 8 | 16;
  /** Default 8. REQ-LIT-027. */
  depthPrecision?: 8 | 16;
  /** 0..1 each. Default { intensity: 0.25, shininess: 0.5 }. REQ-LIT-021. */
  specularDefault?: { intensity: number; shininess: number };
}

/** Engine → exporter. RGBA8 planes with the RenderedFrame layout (REQ-PIX-029), already mirrored. */
export interface RenderedFrameMaps {
  /** Present only for requested maps; same width/height as RenderedFrame.pixels. */
  planes: Partial<Record<LightingMapKind | 'uv-lo', Uint8Array>>;
}

/** Manifest addition (SpriteExportManifest.maps), REQ-LIT-014. Omitted when no map is written. */
export interface ManifestMapEntry {
  suffix: string; // '_n', '_albedo', …
  colorSpace: 'srgb' | 'linear';
  /** Files in the same order as SpriteExportManifest.sheets. */
  files: Array<{ file: string; sheet: string; scale: number }>;
  transparentFill: [number, number, number, number]; // normal: [128,128,255,0]; others: [0,0,0,0]
  encoding?: '128+127n' | 'depth8' | 'depth16-rg' | 'uv8' | 'uv16-split' | 'rgb-intensity-a-shininess' | 'mask-r-rim-g-receive';
  space?: 'view'; // normal only
  convention?: 'y-up' | 'y-down'; // normal only
  quantizeNormals?: number;
  /** uv and specular only: part IDs in the B channel / per-part values. */
  parts?: Array<{ id: number; ref: AssetRef; slot: string }>;
}
```

Warning code added to `SpriteSheetExport['warnings']`: `LIT_MAP_SOURCE_MISSING` (with `message` naming the map and graph). Validation errors reuse `EXP_INVALID_SETTINGS`.

**File names.** `<stem>` is the colour file name without the `@<s>x` scale suffix and extension (`<base>` or `<base>_<label>`). The map suffix goes before the scale suffix. Labels and base names contain no `_` (REQ-EXP-012, REQ-EXP-016), so names stay unambiguous.

| Map | Grid / strip sheet | Frames ZIP |
|-----|--------------------|-----------|
| Normal | `<stem>_n.png`, `<stem>_n@2x.png` | `<base>/<label>/<dir>/<frame>_n.png` |
| Albedo | `<stem>_albedo.png` | `…/<frame>_albedo.png` |
| Mask | `<stem>_m.png` | `…/<frame>_m.png` |
| Specular | `<stem>_s.png` | `…/<frame>_s.png` |
| UV | `<stem>_uv.png` (+ `<stem>_uv-lo.png` at 16-bit) | `…/<frame>_uv.png` |
| Depth | `<stem>_d.png` | `…/<frame>_d.png` |
| Emission | `<stem>_e.png` | `…/<frame>_e.png` |
| Godot CanvasTexture | `<stem>_lit.tres`, `<stem>_lit@2x.tres` | – |
| Phaser multi-atlas | `<base>.multiatlas.json` | – |
| Unity notes | `README-unity-lighting.txt` | – |

**Aseprite JSON `meta.maps`** (only when a map is written; other keys unchanged)

```json
"maps": {
  "normal": { "image": "knight_n.png", "space": "view", "convention": "y-up", "encoding": "128+127n" },
  "albedo": { "image": "knight_albedo.png" },
  "mask": { "image": "knight_m.png", "channels": { "r": "rim", "g": "light-receive" } }
}
```

**Godot `CanvasTexture`** (`<stem>_lit.tres`; ids are fixed strings for determinism)

```
[gd_resource type="CanvasTexture" load_steps=4 format=3]

[ext_resource type="Texture2D" path="res://knight_albedo.png" id="1_diffuse"]
[ext_resource type="Texture2D" path="res://knight_n.png" id="2_normal"]
[ext_resource type="Texture2D" path="res://knight_s.png" id="3_specular"]

[resource]
diffuse_texture = ExtResource("1_diffuse")
normal_texture = ExtResource("2_normal")
specular_texture = ExtResource("3_specular")
texture_filter = 1
```

**MRT and readback design note** (non-normative for the engine; the result contracts above are normative). The engine decides the storage under the single-scene-render rule (REQ-LIT-001, REQ-PIX-014).

| Map | Source in the scene pass | Status |
|-----|--------------------------|--------|
| normal | `normalDepth.xyz` (view normal) | existing |
| depth | `normalDepth.w` (depth px) | existing |
| mask R | coverage + rim offset (rim stage) | existing, computed in post |
| mask G | coverage + edge-detect output | existing, computed in post |
| UV B, specular per part | part-ID target R | existing |
| albedo | material `base` | **new**: 3 channels, needs an attachment |
| UV RG | `TEXCOORD_0` of the visible fragment | **new**: 2 channels; the free B/A channels of the part-ID target, if its format allows |
| emission | material emissive | **new**: 3 channels |

Constraints: WebGL2 guarantees only 4 draw buffers, and WebGPU's default `maxColorAttachmentBytesPerSample` is 32 bytes (four `rgba16float` targets). The current pass uses 3 targets, so albedo fits as a fourth, while emission needs packing or an amendment (Open questions). Half-float UVs give about 2⁻¹¹ precision near 1.0, enough for 8-bit UVs but not for REQ-LIT-031, which needs 32-bit float UVs. Map-only attachments are created only when that map is requested for export, so the preview and maps-off exports keep the M2 pipeline and goldens.

## Non-functional

- Determinism: P-04 per backend (REQ-LIT-018). Normal, UV and depth bytes depend on GPU interpolation, so goldens are per backend (spec 003 REQ-PIX-028 environment). Encoders and the dilation reference are pure and Node-tested.
- Performance: P-07 unchanged with maps off; ≤ 1.5× with normal + albedo (REQ-LIT-019). Maps add readbacks (one RGBA8 plane per map per frame) and CPU encoding in the export worker, never another scene pass.
- Memory: maps count toward the 512 MB limit (REQ-LIT-017) and the spec 005 memory bound.
- Stability: P-05. Maps use nearest filtering, integer scales and the same texel snapping as the colour frame.
- Privacy: P-03. Maps are part of the local download.
- Accessibility: P-06 for the map view control (REQ-LIT-026) and the export dialog options.
- Framework-agnostic: map encoders live in `packages/engine/src/export/` with no three.js or DOM imports (P-10).

## Open questions

- [NEEDS CLARIFICATION: Spec 005's open question keeps the Aseprite JSON "vanilla". This spec adds `meta.maps` when maps are written (REQ-LIT-015, PM brief for task LIT-spec 2026-10-09). Confirm the extension, or move map names to the manifest only. Owner: maintainers. Blocks REQ-LIT-015 only.]
- [NEEDS CLARIFICATION: Per-part specular source (REQ-LIT-021). Owner: asset-pipeline-engineer and the CMP spec owner. Not blocking P1.]
- [NEEDS CLARIFICATION: Phaser 3 `normalMap` field in multi-atlas JSON (REQ-LIT-025). Owner: asset-pipeline-engineer. Not blocking P1.]
- [NEEDS CLARIFICATION: Godot 4 specular: the docs say `specular_shininess` defaults to 1.0, which "disables specular reflections", and do not say whether the specular texture's alpha holds shininess. Verify with a Godot 4 headless render before REQ-LIT-021/024 ship; the `.tres` may need an explicit `specular_shininess`. Owner: asset-pipeline-engineer. Not blocking P1.]
- [NEEDS CLARIFICATION: Does a Godot `SpriteFrames` `AtlasTexture` whose atlas is a `CanvasTexture` keep the normal and specular maps? If so, the godot4 `SpriteFrames` (REQ-EXP-028) could reference `<stem>_lit.tres` directly. Owner: asset-pipeline-engineer. P2.]
- [NEEDS CLARIFICATION: Emission (REQ-LIT-028) needs a fifth colour channel set beyond the 4-attachment WebGL2 minimum once albedo is present. Options: pack emission and albedo in alternating exports (violates REQ-LIT-001), drop emission on WebGL2, or amend REQ-PIX-014. Owner: graphics-engineer. P3, not blocking.]
- [NEEDS CLARIFICATION: Albedo for user material graphs (M4): spec 006 `output.material` must expose a base-colour input for REQ-LIT-012; until then REQ-LIT-013 applies. Owner: spec 006/007 owner. Not blocking M6 P1 with the built-in material.]
- [NEEDS CLARIFICATION: Should outline normals use an outward silhouette tilt instead of the dilated interior normal (REQ-LIT-009) as an option? Owner: product owner after the first engine test. Not blocking.]

## References

- Research brief `.tagconn/work/research-lighting-maps.md` (2026-10-09) and the PM decision of 2026-10-09 in `.tagconn/work/backlog.md`
- Spec 003 (REQ-PIX-005, 006, 012, 014, 017, 023, 029, 030), spec 005 (layout, naming, REQ-EXP-018, 025), constitution P-03, P-04, P-05, P-06, P-07, P-10
- Godot 4 `CanvasTexture` class reference: https://docs.godotengine.org/en/4.4/classes/class_canvastexture.html (accessed 2026-10-09)
- Godot 4 2D lights and shadows (normal/specular maps, X+ Y+ Z+ convention): https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html (accessed 2026-10-09)
- Unity URP sprite secondary textures (`_NormalMap`, `_MaskTex`, same UV layout): https://docs.unity3d.com/6000.2/Documentation/Manual/urp/SecondaryTextures.html (accessed 2026-10-09)
- Unity Secondary Textures tab reference: https://docs.unity.com/en-us/engine/6000.3/manual/unity2d/sprite/sprite-editor-window-reference/secondary-textures-editor-reference (accessed 2026-10-09)
- Phaser lights concept page (`load.image(key, [url, normalMapUrl])`, `Light2D`, WebGL only): https://docs.phaser.io/phaser/concepts/gameobjects/light (accessed 2026-10-09)
- Phaser `MultiAtlasFile` (`textures[i].normalMap`): https://docs.phaser.io/api-documentation/class/loader-filetypes-multiatlasfile and source https://app.unpkg.com/phaser@4.2.1/files/src/loader/filetypes/MultiAtlasFile.js (accessed 2026-10-09)
- Phaser forum, flat #7F7FFF fallback for lit objects without a normal map: https://phaser.discourse.group/t/phaser3-webgl-lights-light2d-am-i-missing-something-or-are-they-broken/3016 (accessed 2026-10-09)
- CodeAndWeb, Sprite Illuminator and Phaser 3 light effects (`_n` naming, packed normal sheets): https://www.codeandweb.com/spriteilluminator/tutorials/how-to-create-light-effects-in-phaser3 (accessed 2026-10-09)
- Aarthificial UV lookup sprite technique, summary: https://dev.to/derlin/this-guy-may-just-have-revolutionized-2d-pixel-animation-37ip (accessed 2026-10-09)
- Aseprite community, UV coordinate pixels and lookup textures: https://community.aseprite.org/t/export-indexed-color-as-uv-coordinate-pixels-and-a-palette-lookup-texture/14154 (accessed 2026-10-09)
- Further sources named in the research brief (Defold multi-texture sprites, Laigter, Sprite DLight, GameMaker blog, "Light the Sprite" EG 2025) were not re-fetched for this spec.
- WebGL2 `MAX_DRAW_BUFFERS` minimum 4: https://registry.khronos.org/webgl/specs/latest/2.0/ ; WebGPU `maxColorAttachmentBytesPerSample` default 32: https://www.w3.org/TR/webgpu/#limits (accessed 2026-10-09)
