---
id: PIX
title: Pixel render pipeline
status: draft
owner: spec-writer (review: graphics-engineer)
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 004-animation]
last_updated: 2026-10-09
---

# 003 – Pixel render pipeline

## Context

ADR-0001 says characters are built from rigged 3D parts and rendered in the browser through a pixel-art shader pipeline. ADR-0003 fixes the technology: `WebGPURenderer` (three r186, pinned) with an automatic WebGL2 fallback, TSL node materials, and one `RenderPipeline` with a single `pass(scene, camera)` that writes MRT outputs (color, normal, depth, part ID). The data flow is in `docs/architecture.md` §2.1. Determinism and pixel stability are constitution principles P-04 and P-05.

This spec owns everything between an assembled, posed character and an RGBA8 `RenderedFrame`. It covers render resolution, cameras, directions, framing, toon lighting, outlines, palette quantization, dithering, alpha, pixel stability, backend parity, determinism, preview vs export, and performance. Composition (CMP), anatomy (ANA), clip sampling times (ANM) and file packaging (EXP) are owned elsewhere.

M2 ships these stages as fixed TypeScript/TSL functions. In M4 they must be expressible as the default material and post shader graphs (`builtin:material-toon`, `builtin:post-default`) and must reproduce M2 output pixel-exactly (REQ-PIX-035).

## Goals

- G1: Readable, stable pixel-art frames at 32–128 px from any composed character, for side-view and top-down/3/4/isometric games.
- G2: The same look on WebGPU and WebGL2, with byte-identical output per backend for identical inputs.
- G3: A look that non-experts can tune (bands, rim, outline, palette, dither) without editing graphs.
- G4: The preview shows exactly what the export will contain.

## Non-goals

- NG1: Perspective cameras. All cameras are orthographic.
- NG2: Cast shadows, ambient occlusion, bloom, or other screen-space effects in the default pipeline. Users can add effects in a post graph (spec 006/007). *(Amended 2026-10-09 (FX-J, user D2): the 1 px screen-space rim edge of REQ-PIX-012 and the outlines are the only screen-space effects in the default pipeline.)*
- NG3: Per-part layer export (one PNG per part). Possible later, owned by EXP.
- NG4: Anti-aliased or sub-pixel output. Output is hard-edged by design.
- NG5: Identical pixels across backends. Determinism is per backend (P-04).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to choose 48 px, isometric, 8 directions | the sprites fit my RPG grid |
| US-2 | P1 | indie game dev | all frames of a sheet framed with the feet on the same pixel row | the character does not jitter in my engine |
| US-3 | P1 | pixel artist | to limit output to PICO-8 or my own palette, with optional dither | the sprites match my game's art |
| US-4 | P1 | pixel artist | 1 px outlines in black or a darkened shade | silhouettes stay readable at 32 px |
| US-5 | P1 | tech artist | the built-in look to be a normal shader graph later | I can start from it instead of from scratch |
| US-6 | P2 | pixel artist | to import my `.gpl`/`.hex` palette from Lospec or Aseprite | I don't retype colors |

## Requirements

Defaults for every setting are listed in the Data & contracts section. "Cell" means one rendered frame of `resolution.width × resolution.height` pixels.

### Resolution and rasterization

**REQ-PIX-001 [P1]** THE SYSTEM SHALL accept a render resolution whose width and height are each an integer from 32 to 128 px, and SHALL reject any other value with error code `PIX_INVALID_RESOLUTION`.

- **AC-PIX-001.1** Given RenderSettings with resolution 48×64, When `setRenderSettings` is called, Then the result is ok and the next `RenderedFrame` is 48×64.
- **AC-PIX-001.2** Given resolution values 31, 129, 64.5 or NaN on either axis, When the settings are validated, Then validation fails with `PIX_INVALID_RESOLUTION`, and the previous settings stay active.

**REQ-PIX-002 [P1]** THE SYSTEM SHALL render the scene pass directly at the cell resolution with nearest filtering, no MSAA, no mipmaps and no post anti-aliasing. It SHALL NOT render at a higher resolution and downsample.

- **AC-PIX-002.1** Given any fixture at 64×64, When the pipeline is inspected in a test, Then every render target is 64×64, `samples` is 0, min/mag filters are nearest and `generateMipmaps` is false.
- **AC-PIX-002.2** Given the default fixture rendered with the palette set to `none`, When the frame is analysed, Then every pixel's alpha is either 0 or 255.

*(Clarified 2026-10-09 (M2-01), PM decision D3.)* "Nearest filtering, no mipmaps" applies to the pipeline's render targets and the palette LUT. Textures of the parts themselves are sampled with mipmaps (REQ-PIX-038).

### Cameras and directions

**REQ-PIX-003 [P1]** THE SYSTEM SHALL provide orthographic camera presets `side` (elevation 0°), `three-quarter` (elevation 35°) and `isometric` (elevation 30°, which gives 2:1 pixel isometry).

- **AC-PIX-003.1** Given the `side` preset, When the default fixture is rendered facing `e`, Then the camera's view direction is horizontal (elevation 0° ± 0.001°) and the projection is orthographic.
- **AC-PIX-003.2** Given the `isometric` preset, When a 1×1 world-unit ground square rotated 45° about the vertical axis is projected, Then the width:height ratio of its screen bounding box is 2:1 within 0.1 %.
- **AC-PIX-003.3** Given the `three-quarter` preset, When rendered, Then the camera elevation is 35° ± 0.001°.

**REQ-PIX-004 [P2]** WHERE the camera preset is `custom` THE SYSTEM SHALL use a user-defined elevation from 0° to 90° inclusive, in steps of 0.5°.

- **AC-PIX-004.1** Given preset `custom` with elevation 90, When rendered, Then the view is straight down (top-down) and frames render without errors.
- **AC-PIX-004.2** Given preset `custom` with elevation 91 or 12.3, When validated, Then validation fails with `PIX_INVALID_CAMERA`.

*(Amended 2026-10-09 (M2-01b), PM-approved.)* The `custom` preset starts from the `three-quarter` defaults: elevation 35°, 8 directions, `singleFacing` `s`, `pivotRowPx` ~~4~~ from the `three-quarter` rule `round(H·3/16)`, 12 at the default 64 px height (Defaults table; value amended 2026-10-09 (FX-H)). `camera.elevationDeg` is range-checked (0..90, 0.5° steps) only WHERE the preset is `custom`; for the other presets the field is ignored and never causes a validation error.

- **AC-PIX-004.3** Given settings `{ camera: { preset: 'custom' } }` with every other field omitted, When validated, Then the result is ok with elevation 35, directions 8, `singleFacing` `s` and `pivotRowPx` ~~4~~ 12 (default resolution 64×64); and Given preset `side` with `elevationDeg` 91, When validated, Then the result is ok and the rendered elevation is 0°. *(Added 2026-10-09 (M2-01b). Amended 2026-10-09 (FX-H): the expected `pivotRowPx` is 12, the resolution-relative `three-quarter` default at height 64, AC-PIX-008.5.)*

**REQ-PIX-005 [P1]** THE SYSTEM SHALL render 1, 2, 4 or 8 directions by rotating the model about the vertical axis relative to the camera, with no camera movement. Directions use the labels and order in `DIRECTION_ORDER` (Data & contracts). Direction index `i` of `n` uses the label at position `i × 8 / n` in that order.

- **AC-PIX-005.1** Given 8 directions, When frames are sampled, Then the model yaw for index `i` is `i × 45°` measured counter-clockwise from facing screen-right (`e`), and the labels are `e, ne, n, nw, w, sw, s, se`.
- **AC-PIX-005.2** Given 4 directions, Then labels are `e, n, w, s`. Given 2 directions, Then labels are `e, w`.
- **AC-PIX-005.3** Given 1 direction and `singleFacing = 's'`, Then the single direction faces the camera (yaw 270°) and has label `s`.
- **AC-PIX-005.4** Given 3 or 6 directions, When validated, Then validation fails with `PIX_INVALID_DIRECTIONS`.

*(Clarified 2026-10-09 (M1-33), after the M1 preview showed direction `e` facing the camera.)* "Model yaw" in AC-PIX-005.1 is the **facing angle** of the character, not the raw rotation applied to it. Built models face +Z (spec 011 REQ-AST-011), and the default camera looks along −Z, so a model with no rotation faces the camera (`s`, facing angle 270°). The rotation about +Y applied to the character's parent is therefore `facing angle + 90°` (mod 360°): 90° for `e`, 0° for `s`. The preview and the export use the same mapping.

- **AC-PIX-005.5** Given 8 directions and a fixture model facing +Z, When direction index 0 (`e`) is rendered, Then the model's forward vector in view space points to screen-right (± 1e-6), and for index 6 (`s`) it points toward the camera; the applied rotation about +Y is 90° and 0° respectively. *(Added 2026-10-09 (M1-33).)*

**REQ-PIX-006 [P2]** WHERE `mirrorWest` is enabled THE SYSTEM SHALL produce each west-facing direction (`w`, `nw`, `sw`) by flipping the matching east-facing frame (`e`, `ne`, `se`) horizontally around the pivot column, instead of rendering it.

- **AC-PIX-006.1** Given 2 directions with `mirrorWest`, When frames are produced, Then each `w` frame equals the `e` frame with columns reflected around `pivotColumnPx` (pixels outside the cell after reflection are dropped, uncovered pixels are transparent).
- **AC-PIX-006.2** Given `mirrorWest`, When export time is measured, Then only east-facing directions (plus `n`/`s`) are rendered on the GPU.

### Framing, pivot and pixel stability

**REQ-PIX-007 [P1]** WHEN frames are rendered for export THE SYSTEM SHALL first compute the union of the character's screen-space bounds over every requested clip, frame and direction, then use one fixed camera framing (world units per pixel and camera position) for every frame of that export.

- **AC-PIX-007.1** Given a fixture with `walk` and `attack` clips in 8 directions, When exported, Then all frames share one camera matrix (identical 16 floats) and no opaque pixel touches a cell edge unless REQ-PIX-009 reports clipping.
- **AC-PIX-007.2** Given the union-bounds pass, When timed, Then it adds ≤ 15 % to total render time (it may use skinned bounding boxes, not pixel readback).

*(Amended 2026-10-09 (M2-01b), PM-approved after task FX-F: at 30–35° elevation the feet in front of the pivot project below the ground row and were clipped.)* In auto mode the scale fits the union bounds, inflated by `outerWidth + 1` px, on all four sides of the pivot; the pivot row does not move. Here `outerWidth` is `outline.outer.widthPx` when the outer outline is enabled and 0 otherwise. Auto mode chooses the smallest world-units-per-pixel for which the inflated bounds fit left of, right of, above and below the pivot. Below the pivot the available room is `pivotRowPx - (outerWidth + 1)` px; WHEN that room is less than 1 px the extent below the pivot does not enter the scale, and geometry there clips and is reported by REQ-PIX-009 (AC-PIX-009.3).

**REQ-PIX-008 [P1]** THE SYSTEM SHALL place the character's ground pivot (the root bone's ground projection in rest position) on pixel row `pivotRowPx` (counted from the bottom, 0 = bottom row) and pixel column `pivotColumnPx = floor(width / 2)` in every frame of a sheet.

- **AC-PIX-008.1** Given an idle clip in side view with `pivotRowPx = 2`, When rendered, Then the lowest opaque pixel row of the feet (excluding the outline) is row 2 from the bottom in every frame where both feet are on the ground. *(Note 2026-10-09 (FX-G): currently not met on the Quaternius rig. Joint-based grounding (spec 002 REQ-ANA-008, AC-ANA-008.2/.3) puts `ball_leaf_*` at y = 0, which is about 2 cm above the sole; with the idle dip the soles sit 2.4–3.1 cm below ground, so the lowest row is 1. [NEEDS CLARIFICATION: ground definition, resolved in M3 per user decision 2026-10-09; preferred direction is a per-skeleton-group sole offset in rig data. Owner: PM with spec 002/011 owners.] The test is an expected failure until then.)*
- **AC-PIX-008.2** Given any export, Then the frame manifest (EXP) reports the pivot as `[pivotColumnPx, height - 1 - pivotRowPx]` in top-left pixel coordinates.

*(Amended 2026-10-09 (M2-01), A6.)* The pivot is a **pixel corner**, not a pixel center: the ground pivot projects onto the left edge of column `pivotColumnPx` and the bottom edge of row `pivotRowPx`. In continuous top-left screen coordinates (x right, y down, 1 unit = 1 output pixel) that point is `(floor(width / 2), height - pivotRowPx)`. The pixel reported in AC-PIX-008.2 is the pixel whose bottom-left corner is the pivot. The camera frustum edges are whole multiples of the world-units-per-pixel size measured from the pivot, so pixel edges, not pixel centers, lie on the ground plane and on the pivot's vertical line.

- **AC-PIX-008.3** Given the pure framing function with resolution 64×64, `pivotRowPx = 2` and world units per pixel `s`, When the framing is computed, Then the frustum relative to the pivot is left `-32·s`, right `32·s`, bottom `-2·s`, top `62·s`, and the pivot projects to continuous screen point (32, 62). With resolution 33×48 and `pivotRowPx = 4`, Then left is `-16·s`, right `17·s`, bottom `-4·s`, top `44·s`, and the pivot projects to (16, 44). *(Added 2026-10-09 (M2-01).)*
- **AC-PIX-008.4** Given side view, width 64, fixed framing `s = 0.25` world units per pixel, and an unrotated box 1 world unit wide (4 px) centered horizontally on the pivot and standing on the ground, When rendered, Then it covers columns 30–33 exactly and its lowest covered row is row `pivotRowPx` from the bottom (no half-covered column or row). *(Added 2026-10-09 (M2-01).)*

*(Amended 2026-10-09 (FX-H), PM-approved after task FX-G.)* The default `pivotRowPx` is resolution-relative (Defaults table). With `H = resolution.height` and `outerWidth` as defined in the REQ-PIX-007 note (`outline.outer.widthPx` when the outer outline is enabled, else 0):

- `side`: `outerWidth + 2` (3 with the default outline width 1; 2 with the outer outline disabled), independent of `H`.
- `three-quarter`: `round(H·3/16)`.
- `isometric`: `round(H·5/32)`.
- `custom`: the `three-quarter` rule.

`round(x)` is `floor(x + 0.5)` (halves round up, e.g. `H = 40` gives `round(7.5) = 8` for `three-quarter`). WHEN `camera.pivotRowPx` is omitted, validation fills in this default from the validated preset, resolution height and outer outline; an explicit `camera.pivotRowPx` (0..height−1) always overrides it. Rationale: at 30–35° elevation the feet in front of the pivot project below the ground row, and with the previous fixed defaults (2 / 4 / 6) auto framing (REQ-PIX-007 note) shrank the default character to 19–39 % of a 64 px cell height; with the new values FX-G measured 92 % (`side`), 75 % (`three-quarter`) and 77 % (`isometric`) with no clipping. The `side` rule equals the minimum `outerWidth + 2` for which AC-PIX-009.3 applies. AC-PIX-008.1, AC-PIX-008.3 and AC-PIX-008.4 set `pivotRowPx` explicitly and are unchanged.

- **AC-PIX-008.5** Given settings with only `camera.preset` and `resolution` set (outer outline at its default, enabled, width 1) and `camera.pivotRowPx` omitted, When validated, Then `pivotRowPx` is: for `side` 3, 3, 3; for `three-quarter` 6, 12, 24; for `isometric` 5, 10, 20; for `custom` 6, 12, 24 at heights 32, 64 and 128 respectively (square resolutions). And Given preset `side` with the outer outline disabled, Then `pivotRowPx` is 2 at each of those heights; Given preset `side` with outer width 3, Then it is 5; Given preset `three-quarter`, resolution 64×40, Then it is 8; Given preset `isometric` at 64×64 with explicit `pivotRowPx` 4, Then it is 4. *(Added 2026-10-09 (FX-H).)*

**REQ-PIX-009 [P1]** WHERE `camera.framing` is a number THE SYSTEM SHALL use that value as world units per pixel for all characters, so that characters exported separately share one scale. IF any opaque pixel of the union bounds falls outside the cell THEN THE SYSTEM SHALL return the warning `PIX_FRAMING_CLIPPED` with the affected clip and direction, and still render.

- **AC-PIX-009.1** Given two fixture characters of different heights with `framing = 0.03125`, When both are exported at 64 px, Then the taller one's head is proportionally higher (head row differs by `round(Δheight / 0.03125)` ± 1 px).
- **AC-PIX-009.2** Given a framing value so small that the head leaves the cell, When exported, Then `PIX_FRAMING_CLIPPED` names the clips and directions, and the frames are still produced.
- **AC-PIX-009.3** Given auto framing and a foot extending below the ground row, When framed, Then no clip is reported and the lowest pixel stays at least outerWidth + 1 px above the cell bottom. *(Added 2026-10-09 (M2-01b); applies WHEN `pivotRowPx ≥ outerWidth + 2`, so at least 1 px of room remains below the margin. With fixed framing, or with a smaller `pivotRowPx`, the below-pivot geometry may clip and `PIX_FRAMING_CLIPPED` is reported, REQ-PIX-007 note.)*

**REQ-PIX-010 [P1]** THE SYSTEM SHALL snap the camera position and the character's root translation in the camera plane to whole multiples of the world-units-per-pixel size before rendering each frame.

- **AC-PIX-010.1** Given a static pose rendered twice in a row, When the frames are compared, Then they are byte-identical (zero shimmer, P-05).
- **AC-PIX-010.2** Given a clip with root motion of 0.37 px per frame along screen X, When frames are rendered, Then the character shifts by whole pixels only, and the shape of a rigid prop is pixel-identical between frames where only translation changed.
- **AC-PIX-010.3** Given the snap function (pure, unit-tested), When it is called with an offset of 2.5 px exactly, Then it rounds half away from zero in a documented direction, and the same input always gives the same output.

### Lighting and toon shading

**REQ-PIX-011 [P1]** THE SYSTEM SHALL shade surfaces with a toon ramp of 2, 3 or 4 bands, where the band of a pixel is chosen by comparing the Lambert term `max(dot(N, L), 0)` to `bands - 1` ascending thresholds (default evenly spaced: `k / bands`).

- **AC-PIX-011.1** Given a lit sphere fixture with 3 bands and the palette set to `none`, When rendered, Then the sphere shows exactly 3 distinct lit colors per tint (plus rim and outline colors when enabled).
- **AC-PIX-011.2** Given `bands = 5` or thresholds that are not strictly ascending in (0, 1), When validated, Then validation fails with `PIX_INVALID_TOON`.

*(Amended 2026-10-09 (M2-01), A5. ~~**Provisional** pending user approval of the default look, PM decision D2.~~ Provisional marker removed 2026-10-09 (FX-J-spec2): the user approved the direction "Brighter + punchier", D2.)* Band brightness and the combine with rim are defined as follows. `N` is the view-space unit normal, `L` the view-space light direction of REQ-PIX-013, `λ = max(dot(N, L), 0)`. The band index `k` is the number of thresholds `t_j` with `t_j ≤ λ`, so `k ∈ {0, …, bands - 1}` and a value exactly on a threshold goes to the brighter band. The band brightness is `light_k = ambient + (1 - ambient) · k / (bands - 1)`. The lit color per linear RGB channel is ~~`clamp(base · light_k + rim, 0, 1)`~~ `clamp(base · light_k, 0, 1)`, where `base` is the material base color (tinted albedo, spec 001) ~~and `rim` is the scalar of REQ-PIX-012 (0 when rim is off)~~. ~~The formula and the default values in Data & contracts are frozen only when the user approves sample sprites (D2); the golden images of REQ-PIX-028 SHALL NOT be committed before that approval is recorded in this spec.~~ *(Superseded 2026-10-09 (FX-J-spec2) by the note below.)*

*(Amended 2026-10-09 (FX-J, user D2).)* The rim is no longer added in the material. The material outputs `base · light_k` only, and it also hands `light_k` to the post stages (builtin `scene.light`, spec 007; Data & contracts). The rim brightens selected silhouette pixels in a post stage (REQ-PIX-012) with the ~~hue-keeping combine `base · min(light_k + strength, 1)`~~ combine `clamp(base · (light_k + strength), 0, 1)` (amended 2026-10-09 (FX-J-spec2)), which reuses this `base` and `light_k`. ~~The user approved the look direction "Brighter + punchier" (D2) on 2026-10-09; the exact defaults come from FX-J tuning and the goldens stay unfrozen until the user confirms the FX-J look (Open questions).~~

*(Amended 2026-10-09 (FX-J-spec2).)* **Look status.** The user approved the look direction "Brighter + punchier" (D2) on 2026-10-09. The formula above, the rim combine of REQ-PIX-012 and the shared defaults in Data & contracts (FX-J values) are the approved look; they are no longer provisional. ~~The golden images of REQ-PIX-028 may be frozen (task M2-18) once the user has confirmed the final FX-J look on the look-review strips; the PM records that confirmation date in this note.~~ Any later change to these defaults re-baselines the goldens.

*(Amended 2026-10-09 (D2 approved).)* **Final look approved.** On 2026-10-09 the user approved the final default look after reviewing the look-review strips of the default character: authored texture colors through texel × tint, hair #7a4a26 (spec 001 default), black outer outline, `darken` inner lines, 1 px screen-space rim with strength 0.5, 3 evenly spaced toon bands, ambient 0.1, and resolution-relative pivot rows (REQ-PIX-008 note). This look and the Defaults table are final. The REQ-PIX-028 goldens may now be frozen (task M2-18), generated only in the canonical container per backend (AC-PIX-028.1 to AC-PIX-028.5).

- **AC-PIX-011.3** Given the sphere fixture with base linear color (1, 1, 1), 3 default bands, ambient 0.15, rim off and palette `none`, When rendered, Then the opaque non-outline pixels have exactly the gray values 108, 200 and 255 (the 8-bit sRGB encodings of linear 0.15, 0.575 and 1.0), on both backends. *(Added 2026-10-09 (M2-01).)*
- **AC-PIX-011.4** Given a unit test of the toon stage with `bands = 3`, thresholds (1/3, 2/3) and `λ` exactly 1/3, Then `k = 1`; with `λ = 0` (back-facing), Then `k = 0` and the color is `base · ambient`. *(Added 2026-10-09 (M2-01).)*

**REQ-PIX-012 [P1]** WHERE rim light is enabled THE SYSTEM SHALL ~~add a rim term `step(1 - width, 1 - max(dot(N, V), 0)) × strength` on lit-side pixels, with `strength` and `width` each in [0, 1]~~ set every rim pixel (a covered pixel whose 8-neighbour toward the screen-space light direction is uncovered, defined in the note below) to the color ~~`base · min(light_k + strength, 1)`~~ `clamp(base · (light_k + strength), 0, 1)` per linear RGB channel in a post stage, with `strength` in [0, 1]. *(Amended 2026-10-09 (FX-J, user D2): the material rim term of A5 is replaced by a screen-space 1 px lit edge; `width` is superseded. Combine amended 2026-10-09 (FX-J-spec2), PM decision: the `min(…, 1)` ceiling on the factor is replaced by a clamp of the result, so brightest-band rim pixels also brighten.)*

- **AC-PIX-012.1** Given the sphere fixture with rim strength 1 ~~and width 0.2~~, When rendered, Then a band of brighter pixels appears on the lit edge of the silhouette, and no rim pixels appear when strength is 0. *(Amended 2026-10-09 (FX-J, user D2): `width` no longer exists as a rendering input; a `width` value in the settings is ignored.)*

~~*(Amended 2026-10-09 (M2-01), A5, provisional per D2.)* The camera is orthographic, so `V = (0, 0, 1)` in view space and `dot(N, V) = N.z`. The rim term is `rim = step(1 - width, 1 - max(N.z, 0)) · strength` WHERE `dot(N, L) > 0`, and `rim = 0` elsewhere. It is added equally to the three linear channels before the clamp of REQ-PIX-011.~~ *(Superseded 2026-10-09 (FX-J, user D2) by the note below. Task FX-I found that this term caused the stray light pixels on the default character: `N.z ≤ width` holds only on scattered sub-pixel samples near the silhouette, and the additive `+ strength` pushed those pixels toward white.)*

- **AC-PIX-012.2** ~~deprecated~~ (2026-10-09 (FX-J, user D2): the material rim term no longer exists; replaced by AC-PIX-012.5 and AC-PIX-012.6.) ~~Given the sphere fixture with base linear color (0.2, 0.2, 0.2), 3 bands, ambient 0.15, rim strength 0.35 and width 0.25, palette `none`, When rendered and the normal target is read back, Then every opaque non-outline pixel's linear value is `0.2 · light_k + r` (± 1/255 after sRGB decode) with `r ∈ {0, 0.35}`, `r = 0.35` exactly on pixels where `N.z ≤ 0.25` and `dot(N, L) > 0`, and no pixel with `dot(N, L) ≤ 0` has `r = 0.35` (pixels whose read-back `N.z` or `dot(N, L)` is within 0.01 of a boundary are excluded, because the normal target is half-float).~~ *(Added 2026-10-09 (M2-01).)*

*(Amended 2026-10-09 (FX-J, user D2).)* **Screen-space rim edge.** The rim is a post stage that runs after coverage and before the outline (REQ-PIX-025). It is defined as follows.

- **Rim offset.** Let `θ` be the angle of the screen-projected light vector `L.xy` (REQ-PIX-013 note), in degrees from screen-right, counter-clockwise, in [0, 360). The sector is `d = floor(θ / 45 + 0.5) mod 8` (a direction exactly between two sectors goes to the counter-clockwise one). The rim offset `o = (dx, dy)` in top-left pixel coordinates (x right, y down) is, for `d = 0..7`: `(1, 0)`, `(1, -1)`, `(0, -1)`, `(-1, -1)`, `(-1, 0)`, `(-1, 1)`, `(0, 1)`, `(1, 1)`. The default light (azimuth 135°) gives `d = 3`, `o = (-1, -1)` (upper-left). IF `|L.xy| < 1e-6` (light elevation 90°) THEN there is no rim offset and no pixel is a rim pixel.
- **Rim pixel.** A pixel `p` is a rim pixel WHEN `p` is covered (REQ-PIX-023, before any outline) and `p + o` is not covered. Positions outside the cell count as not covered. The rim set therefore depends only on the coverage mask and `o`.
- ~~**Combine (hue-keeping).** A rim pixel's linear RGB becomes `base · min(light_k + strength, 1)`, where `base` and `light_k` are the material values of REQ-PIX-011 at that pixel (about one toon band brighter, never brighter than `base`). Each channel is scaled by the same factor, so the linear hue does not change.~~ *(Superseded 2026-10-09 (FX-J-spec2) by the next sentence.)* **Combine** (amended 2026-10-09 (FX-J-spec2), PM decision). A rim pixel's linear RGB becomes, per channel, `clamp(base · (light_k + strength), 0, 1)`, where `base` and `light_k` are the material values of REQ-PIX-011 at that pixel (about one toon band brighter; in the brightest band it may be brighter than `base`). Each channel is scaled by the same factor before the clamp, so the linear hue does not change unless a channel clips at 1. IF `light_k = 0` (only possible with ambient 0) THEN the pixel keeps its color (unchanged rule). Non-rim pixels are not changed. Alpha is not changed.
- **Outline interaction.** Outer outline pixels are uncovered, so they are never rim pixels and the rim lies inside the outline. WHEN a pixel is both a rim pixel and an inner line pixel, the inner line color wins (the outline stage runs later). The `darken` source colors of REQ-PIX-017 are the scene colors before the rim.
- **Uniforms.** `rim.enabled`, `rim.strength` and the light direction are uniforms: changing them never recompiles (REQ-PIX-034). The stage is deterministic (REQ-PIX-027): no randomness, no time, the same coverage and offset always select the same pixels.
- **Visibility.** ~~On pixels already in the brightest band (`light_k = 1`) the combine has no visible effect, by design (see Open questions).~~ *(Amended 2026-10-09 (FX-J-spec2).)* With the clamp combine, a rim pixel in the brightest band (`light_k = 1`) becomes `clamp(base · (1 + strength), 0, 1)`, so the rim is visible on every band unless all channels of `base` are already 1 or `strength` is 0.

- **AC-PIX-012.3** Given the pure rim-offset function, Then light azimuth 135° (elevation 45°) gives `(-1, -1)`; azimuth 0° gives `(1, 0)`; 90° gives `(0, -1)`; 180° gives `(-1, 0)`; 315° gives `(1, 1)`; 22.4° gives `(1, 0)` and 22.6° gives `(1, -1)`; and elevation 90° (any azimuth) gives no offset, so a render with rim enabled equals the rim-off render byte for byte. *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-PIX-012.4** Given side view, 64×64, fixed framing `s = 0.125`, `pivotRowPx = 3`, an unrotated 2×2×2 world-unit cube centered on the pivot and standing on the ground (a 16×16 px camera-facing front face, `N = (0, 0, 1)`), base linear color (0.5, 0.25, 0.1), 4 bands with thresholds (1/4, 1/2, 3/4) (so the face, `λ ≈ 0.707`, is in band 2 of 0..3), ambient 0.15, default light, rim enabled with strength 0.3, outlines off and palette `none`, When rendered, Then the pixels that differ from the same render with rim disabled are exactly the top row and the left column of the face (31 pixels, a 1 px L-shape), on both backends. *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-PIX-012.5** Given the sphere fixture (AC-PIX-011.1) at 64 px with the base color and settings of AC-PIX-012.4, When rendered and the coverage and normal targets are read back, Then (a) the set `R` of pixels that differ from the rim-off render equals the set of covered pixels `p` with `p + (-1, -1)` uncovered ~~and band `k < bands - 1` (pixels whose read-back `λ` is within 0.01 of a threshold are excluded)~~ (amended 2026-10-09 (FX-J-spec2): with the clamp combine every band, including the brightest, changes, because `base` has no channel at 1 and ambient 0.15 gives `light_k > 0`); (b) the band is 1 px thick along the offset: for no `p` are both `p` and `p - o` in `R`; (c) every pixel of `R` lies on the lit half: `(c_p - c) · (-1, -1) / √2 > -1` px, where `c_p` is the pixel center and `c` the sphere's screen center; and (d) `R` is not empty. *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-PIX-012.6** Given the render of AC-PIX-012.5, Then every pixel of `R` has the linear value ~~`base · min(light_k + 0.3, 1)`~~ `clamp(base · (light_k + 0.3), 0, 1)` per channel (± 1/255 after sRGB decode, `k` from the normal read-back as in AC-PIX-011.3; pixels whose read-back `λ` is within 0.01 of a threshold are excluded from this value check), and every pixel outside `R` equals the rim-off render byte for byte. In particular a pixel of `R` in the brightest band (`k = 3`) has the linear value (0.65, 0.325, 0.13). *(Added 2026-10-09 (FX-J, user D2). Amended 2026-10-09 (FX-J-spec2): clamp combine.)*
- **AC-PIX-012.7** Given the look-review export of the default character (spec 001 default `CharacterSpec`, preset `three-quarter`, 64×64, 8 directions, `idle` 1 frame and `walk` 4 frames, default RenderSettings, palette `none`), When each rim pixel (a pixel that differs from the same export with rim disabled) whose rim-off sRGB chroma `max(R, G, B) - min(R, G, B)` (channels / 255) is at least 0.1 is compared with its rim-off color, Then its HSV hue (sRGB) differs from the rim-off hue by at most 10° (circular difference), on both backends. *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-PIX-012.8** ~~Given the export of AC-PIX-012.7 with default RenderSettings, When the FX-I light-pixel metric is computed on every frame, Then the number of isolated light pixels is 0 on both backends.~~ ~~Given the default character (spec 001 default `CharacterSpec`) exported at 64×64 with default RenderSettings and palette `none` (8 directions, `idle` 1 frame and `walk` 4 frames), once with the rim enabled and once with `toon.rim.enabled: false`, for each of the presets `side`, `three-quarter` and `isometric`, When the FX-I light-pixel metric is computed on every frame of both exports, Then on both backends count(rim on) ≤ count(rim off) for (a) all isolated light pixels and (b) isolated light pixels on the silhouette; that is, the rim stage adds no isolated light pixel.~~ *(Amended 2026-10-09 (FX-L): the literal "0" is struck because authored light texture details (the neutral-grey UBC hair strands, light Ranger trim) are legitimate isolated light pixels; FX-K measured 13–24 isolated light pixels with the rim on and more with the rim off. The criterion now targets the FX-I artifact itself: light speckles added by the rim.)* ~~A silhouette pixel is a covered pixel with at least one uncovered 4-neighbour inside the cell.~~ Given the default character (spec 001 default `CharacterSpec`) at 64×64 with default RenderSettings and palette `none`, 8 directions × (`idle` 1 frame + `walk` 4 frames), for each of the presets `side`, `three-quarter` and `isometric`, rendered once with the rim enabled and once with `toon.rim.enabled: false`, on both backends, When every frame of the rim-on render is compared with the same frame of the rim-off render, Then the number of isolated rim-made light pixels is 0. A pixel is rim-made light WHEN it is a light pixel in the rim-on frame and its sRGB Rec. 709 luminance in the rim-off frame is < 0.4; it is isolated WHEN none of its 8 neighbours inside the cell is a light pixel in the rim-on frame. *(Amended 2026-10-09 (FX-M): the FX-L clause "count(rim on) ≤ count(rim off)" is struck because FX-L showed the rim legitimately brightens pale authored trim at diagonally exposed silhouette corners (rim on 4–13 vs rim off 1–2 isolated light pixels); the criterion now targets only the FX-I artifact, the rim turning dark cloth into isolated near-white speckles.)* A light pixel is a covered pixel whose sRGB values (channels / 255) have Rec. 709 luminance `0.2126 R + 0.7152 G + 0.0722 B > 0.6` and chroma `max - min < 0.25`; it is isolated WHEN none of its 8 neighbours inside the cell is a light pixel. *(Added 2026-10-09 (FX-J, user D2). The metric is the one of the FX-I diagnosis test, `packages/engine/test/gpu/light-edge-pixels.gpu.ts`.)*
- **AC-PIX-012.9** Given a spy on node-material and post-node rebuilds, When `toon.rim.enabled` is toggled 10 times, `toon.rim.strength` is changed 100 times and `lighting.azimuthDeg` is changed from 135° to 45° (offset `(1, -1)`), Then the rebuild count is 0 and the next preview frame shows the rim on the new side. *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-PIX-012.10** Given the cube of AC-PIX-012.4 with the outer outline on (width 1, mode `black`), When rendered, Then the 31 rim pixels are unchanged from the outline-off render, every outer outline pixel is #000000, and no outline pixel is a rim pixel. *(Added 2026-10-09 (FX-J, user D2).)*
- **AC-PIX-012.11** ~~Given the pure per-channel rim-combine function, Then for `base` 0.25, `light_k` 0 and strength 0.3 it returns 0.25 (unchanged); for `base` 0.5, `light_k` 1 and strength 0.5 it returns 0.75; for `base` 0.8, `light_k` 1 and strength 0.5 it returns 1.0 (clamped); and for `base` 0.4, `light_k` 0.55 and strength 0.5 it returns 0.42 (± 1e-6).~~ Given the pure per-channel rim-combine function, whose input is the lit channel `c = base · light_k` that the post stage reads from the scene color (it has no access to `base`), so that it returns `clamp(c · (light_k + strength) / light_k, 0, 1) = clamp(base · (light_k + strength), 0, 1)` for `light_k > 0` and `c` for `light_k = 0`, Then (± 1e-6): for `c` 0.25, `light_k` 0 and strength 0.3 it returns 0.25 (the `light_k = 0` guard keeps the input; a real pixel with `light_k = 0` has `c = 0`, the non-zero value only proves the guard); for `c` 0.5 (`base` 0.5, `light_k` 1) and strength 0.5 it returns 0.75; for `c` 0.8 (`base` 0.8, `light_k` 1) and strength 0.5 it returns 1.0 (clamped from 1.2); and for `c` 0.22 (`base` 0.4, `light_k` 0.55) and strength 0.5 it returns 0.42 (= 0.4 · 1.05). *(Added 2026-10-09 (FX-J-spec2). Amended 2026-10-09 (QA-E): the cases are stated in terms of the function input `c`; the struck wording passed `base` as the input, which agrees with the formula only when `light_k` is 0 or 1 (with `base` 0.4 and `light_k` 0.55 passed as `c` the function returns 0.7636, not 0.42). Expected values and the REQ-PIX-012 formula are unchanged.)*

**REQ-PIX-013 [P1]** THE SYSTEM SHALL define the key light direction relative to the camera (azimuth in degrees around the view axis and elevation towards the viewer), so that the lighting is the same for every camera preset and direction set.

- **AC-PIX-013.1** Given the default light (azimuth 135°, elevation 45°: from upper-left, toward the viewer), When the camera preset changes from `side` to `isometric`, Then the light comes from the same screen-space direction (upper-left), verified on the sphere fixture.
- **AC-PIX-013.2** Given 8 directions, When the character turns, Then the light stays fixed relative to the camera (the character's own shading changes, the light does not rotate with it).

*(Amended 2026-10-09 (M2-01), A5.)* The light direction is a view-space unit vector (x screen-right, y screen-up, z toward the viewer) computed once on the CPU: `L = (cos e · cos a, cos e · sin a, sin e)` with `a = azimuthDeg` and `e = elevationDeg` in radians.

- **AC-PIX-013.3** Given azimuth 135° and elevation 45°, When `L` is computed, Then it equals (-0.5, 0.5, 0.70711) ± 1e-5 and is the same value for every camera preset and direction. *(Added 2026-10-09 (M2-01).)*

**REQ-PIX-014 [P1]** THE SYSTEM SHALL write color, view-space normal, linear depth and part ID in a single MRT scene pass, assigning part IDs deterministically by slot order of `SlotId` (body = 1, then slots in their declared order, props last; 0 = background), never by load order.

- **AC-PIX-014.1** Given the same CharacterSpec loaded twice with parts resolving in a different order (simulated network delays), When the part-ID target is read back, Then both readbacks are identical.
- **AC-PIX-014.2** Given the pipeline, When inspected, Then there is exactly one scene render per frame.

*(Amended 2026-10-09 (M2-01), A9.)* "Linear depth" in the MRT pass is the signed distance of the fragment from the **pivot plane** (the plane through the pivot, perpendicular to the view axis), measured in **output pixels** (world distance divided by world units per pixel), positive toward the camera. The same unit is used by `scene.depth`, `post.sampleDepth@1` (spec 006) and `depthThresholdPx` (REQ-PIX-016).

- **AC-PIX-014.3** Given side view with fixed framing `s = 0.03125` and two camera-facing quads at view-axis distances 0.25 and −0.125 world units from the pivot plane (toward and away from the camera), When the depth target is read back, Then the quads read 8.0 and −4.0 px respectively, ± 0.05 px. *(Added 2026-10-09 (M2-01).)*

### Outline

**REQ-PIX-015 [P1]** WHERE the outer outline is enabled THE SYSTEM SHALL draw outline pixels on transparent pixels whose 4-neighbourhood (width 1) or Chebyshev distance ≤ width (width 2–3) contains a covered pixel, with width an integer from 1 to 3.

- **AC-PIX-015.1** Given the default fixture at 64 px with outer width 1, When rendered, Then every transparent pixel 4-adjacent to the silhouette is an outline pixel and no other new pixels appear (checked against the coverage mask).
- **AC-PIX-015.2** Given width 1 at 32 px and at 128 px, Then outlines are exactly 1 px wide at both resolutions (no scaling with resolution).
- **AC-PIX-015.3** Given auto framing and outer width `w`, Then the union bounds are inflated by `w + 1` px so the outline is never clipped.

**REQ-PIX-016 [P1]** WHERE inner lines are enabled THE SYSTEM SHALL draw 1 px lines inside the silhouette where neighbouring covered pixels differ in part ID, or in linear depth by more than `depthThresholdPx` pixel sizes, or in normal by more than `normalThresholdDeg`. Each source can be switched on or off. The line is drawn on the pixel that is farther from the camera.

- **AC-PIX-016.1** Given a fixture with a sword in front of the torso and only the part-ID source on, When rendered, Then a 1 px line separates sword and torso, drawn on torso pixels.
- **AC-PIX-016.2** Given all sources off, Then the inner region equals the render without inner lines.

*(Amended 2026-10-09 (M2-01), A9.)* `depthThresholdPx` is in output pixels of the depth unit of REQ-PIX-014: two neighbouring covered pixels form a depth edge WHEN the absolute difference of their depths is strictly greater than `depthThresholdPx`. "Farther from the camera" means the smaller depth value. The threshold does not change with the camera framing in pixels, so a given value draws the same lines at 32 px and at 128 px for the same on-screen depth step.

- **AC-PIX-016.3** Given only the depth source on, `depthThresholdPx = 4`, and a fixture of three overlapping camera-facing quads whose depths differ by 3 px (quads A/B) and by 5 px (quads B/C), When rendered, Then a 1 px line appears along the B/C boundary on the farther quad's pixels, and no line appears along the A/B boundary. *(Added 2026-10-09 (M2-01).)*

*(Amended 2026-10-09 (M2-01b), PM-approved.)* **Equal-depth tie rule.** WHEN two neighbouring covered pixels form an edge (any source) and their depth values are exactly equal, the inner line goes on the pixel with the higher part ID; IF the part IDs are also equal THEN it goes on the pixel that comes later in row-major order (top-left origin: larger `y`, or same `y` and larger `x`). Exactly one pixel of each such pair carries the line, so an edge is never drawn on both sides or on neither side.

- **AC-PIX-016.4** Given a unit test of the edge-detect reference with the part-ID source on and two horizontally adjacent covered pixels at equal depth with part IDs 3 (left) and 5 (right), Then only the right pixel is a line pixel; with part IDs 5 (left) and 3 (right), Then only the left pixel is; and Given the normal source on, two vertically adjacent pixels with equal depth and equal part ID whose normals differ by more than `normalThresholdDeg`, Then only the lower pixel (later in row-major order) is a line pixel. The same cases rendered on both backends give the same line pixels as the reference. *(Added 2026-10-09 (M2-01b).)*

**REQ-PIX-017 [P1]** THE SYSTEM SHALL color outline pixels by one of these modes: `black` (#000000, or the darkest palette color when a palette is active), `darken` (the adjacent covered pixel's color, or the pixel's own color for inner lines, multiplied by `1 - darkenAmount` in linear RGB), or `custom` (a user HexColor). Outline colors go through palette quantization like any other color.

- **AC-PIX-017.1** Given mode `black` and palette `pico-8`, Then outline pixels are #000000. Given palette `endesga-32` (no pure black), Then they are the palette entry with the lowest OKLab lightness (#181425).
- **AC-PIX-017.2** Given mode `darken` with amount 0.5 and palette `none`, Then each outer outline pixel equals its covered neighbour's linear color × 0.5, re-encoded to sRGB. Ties between several covered neighbours pick the one in order up, left, right, down.

*(Amended 2026-10-09 (M2-01), A2.)* **Darken neighbour.** For an outer outline pixel, the neighbour whose color is darkened is the covered pixel at the smallest Chebyshev distance `d` (`1 ≤ d ≤ widthPx`) that lies in the outline's neighbourhood; among the covered pixels at that distance, the first in row-major order of offsets `(dx, dy)` (top-left coordinates: `dy` ascending, then `dx` ascending) wins. For width 1 the neighbourhood is the 4-neighbourhood, so the order is up `(0, -1)`, left `(-1, 0)`, right `(1, 0)`, down `(0, 1)`, as in AC-PIX-017.2. For widths 2–3 the neighbourhood is the full Chebyshev square, so the distance-1 ring includes diagonals. Inner line pixels darken their own color. **Black.** Mode `black` uses the engine value `render.paletteDarkest` (spec 007): #000000 WHEN the palette is `none`, otherwise the palette entry with the lowest OKLab lightness, ties broken by the lowest palette index.

- **AC-PIX-017.3** Given mode `darken`, amount 0.5, outer width 2, palette `none`, and a test cell whose only covered pixels are A at offset (−1, −1) and B at offset (1, −1) from an outline pixel P, plus C at offset (0, −2), When rendered, Then P equals A's linear color × 0.5 (distance 1 beats distance 2; A precedes B in row-major order). *(Added 2026-10-09 (M2-01).)*
- **AC-PIX-017.4** Given the pure `darkestColor` function, Then it returns #000000 for `pico-8`, #181425 for `endesga-32`, and #102030 for the custom palette `['#ffffff', '#102030']`; and Given palette `none`, the builtin `render.paletteDarkest` is linear (0, 0, 0). *(Added 2026-10-09 (M2-01).)*

*(Amended 2026-10-09 (FX-J-spec2), PM decision at the FX-J look review.)* **Separate modes for outer outline and inner lines.** The mode is chosen separately: `outline.colorMode` colors outer outline pixels (REQ-PIX-015) only, and the NEW field `outline.inner.colorMode` (`black` | `darken` | `custom`) colors inner line pixels (REQ-PIX-016). Both modes follow the rules above and share `outline.darkenAmount` and `outline.color`. Defaults: outer `black`, inner `darken` with `darkenAmount` 0.6 (Defaults table), so the default look has a black outer outline and darkened inner part lines. WHEN `outline.inner.colorMode` is omitted, validation fills in `darken`; settings saved before this amendment therefore keep their outer mode and get darkened inner lines. IF either mode is `custom` and `outline.color` is missing THEN validation fails with `PIX_INVALID_SETTINGS` on path `outline.color` (REQ-PIX-037 note).

- **AC-PIX-017.5** Given default RenderSettings (outer `black`, inner `darken`, `darkenAmount` 0.6), palette `none`, and the sword-and-torso fixture of AC-PIX-016.1 with the part-ID source on, When rendered, Then every outer outline pixel is #000000 and every inner line pixel equals its own scene linear color × 0.4 (± 1/255 after sRGB decode); Given `outline.inner.colorMode` `black`, Then the inner line pixels are #000000; Given outer `darken` and inner `black`, Then outer outline pixels follow AC-PIX-017.2 and inner line pixels are #000000; Given settings with `outline.inner.colorMode` omitted, When validated, Then it is `darken`; and Given `outline.inner.colorMode` `custom` with `outline.color` omitted, When validated, Then validation fails with `PIX_INVALID_SETTINGS` on `outline.color`, and with `outline.color` `#203040` the inner line pixels are #203040 while the outer outline keeps its own mode. *(Added 2026-10-09 (FX-J-spec2).)*

### Palette and dither

**REQ-PIX-018 [P1]** THE SYSTEM SHALL offer palette presets `none`, `pico-8` (16 colors) and `endesga-32` (32 colors), loaded from data files with license records (P-02, P-11).

- **AC-PIX-018.1** Given palette `pico-8`, When any fixture is rendered, Then every opaque pixel's RGB is one of the 16 PICO-8 colors listed in Data & contracts.
- **AC-PIX-018.2** Given palette `none`, Then no quantization is applied and output is 8-bit sRGB from the explicit conversion of REQ-PIX-024.

**REQ-PIX-019 [P1]** WHERE the palette is `custom` THE SYSTEM SHALL accept 1 to 256 unique opaque HexColors and SHALL drop duplicate colors, keeping the first occurrence.

- **AC-PIX-019.1** Given 257 colors, When validated, Then validation fails with `PIX_PALETTE_TOO_LARGE`.
- **AC-PIX-019.2** Given `['#ff0000', '#FF0000', '#00ff00']`, Then the stored palette is `['#ff0000', '#00ff00']` and a `PIX_PALETTE_DUPLICATES` warning lists 1 removed color.

**REQ-PIX-020 [P2]** WHEN the user imports a `.hex` file (one `RRGGBB` per line, optional `#`) or a GIMP `.gpl` file THE SYSTEM SHALL parse it into a custom palette, ignoring comments, blank lines, color names and the GPL header lines (`GIMP Palette`, `Name:`, `Columns:`).

- **AC-PIX-020.1** Given the Lospec `endesga-32.hex` fixture, When imported, Then the custom palette equals the `endesga-32` preset in order.
- **AC-PIX-020.2** Given a `.gpl` with a malformed line (`12 300 4 Bad`), When imported, Then import fails with `PIX_PALETTE_PARSE` naming the line number, and the current palette is unchanged.
- **AC-PIX-020.3** Given a file over 64 KB, Then import is refused with `PIX_PALETTE_PARSE` before parsing.

**REQ-PIX-021 [P1]** THE SYSTEM SHALL map each color to its nearest palette entry using Euclidean distance in OKLab (default) or in sRGB (`metric = 'srgb'`), breaking ties by the lowest palette index. The mapping SHALL be precomputed on the CPU as a 64×64×64 LUT by a pure, Node-testable function, and the GPU SHALL only look up that LUT.
The LUT worker is started through the `csg-worker-url` Trusted Types policy from a host-supplied factory (spec 000 REQ-GEN-014), obeys the worker hygiene rule (REQ-GEN-015), and its replies are validated with a timeout and `messageerror` handling (REQ-GEN-016). *(Cross-reference added 2026-10-09 (M2-23s).)*

- **AC-PIX-021.1** Given palette `pico-8`, When the LUT builder runs twice in Node, Then both outputs are byte-identical, and the entry for sRGB (255, 0, 77) is PICO-8 index 8 (#FF004D).
- **AC-PIX-021.2** Given a 256-color palette, When the LUT is built in a worker on the reference machine, Then it completes in ≤ 250 ms and the preview keeps the previous palette until it is ready.
- **AC-PIX-021.3** Given a GPU-rendered frame and the CPU reference applied to the same pre-quantization colors (read back from a debug target), Then the indices match for 100 % of pixels.

*(Amended 2026-10-09 (M2-01), A7.)* The LUT contract is:

- **Index.** An 8-bit sRGB channel value `c8` maps to the LUT level `lutIndex(c8) = floor((c8 · 63 + 127) / 255)` (integer arithmetic, result 0..63). The GPU first converts each post-dither sRGB channel `c ∈ [0, 1]` to `c8 = clamp(floor(c · 255 + 0.5), 0, 255)` and then applies the same integer formula.
- **Cell color.** LUT level `i` stands for the 8-bit value `lutLevel(i) = floor((i · 255 + 31) / 63)`, so `lutIndex(lutLevel(i)) = i` for every `i`. Entry `(r, g, b)` holds the nearest palette entry (REQ-PIX-021 metric and tie rule) to the sRGB color `(lutLevel(r), lutLevel(g), lutLevel(b))`.
- **Layout.** A 512×512 RGBA8 texture, uploaded without flip, row 0 first, tightly packed. Blue level `b` selects the 64×64 tile at tile column `b mod 8` and tile row `floor(b / 8)`; inside the tile, x = `r` and y = `g`. So entry `(r, g, b)` is texel `(x, y) = ((b mod 8) · 64 + r, floor(b / 8) · 64 + g)` at byte offset `(y · 512 + x) · 4`. Its RGB is the chosen palette color as 8-bit sRGB and its A is the palette index (0..255). The GPU reads it with an integer texel fetch (no filtering).
- **Portable builder.** The builder SHALL use only addition, subtraction, multiplication, division and comparisons on IEEE-754 doubles, a committed 256-entry table for sRGB8 → linear, and a cube root by a fixed number of Newton iterations. It SHALL NOT call `Math.pow`, `Math.cbrt`, `Math.exp` or `Math.log`, whose results may differ between JavaScript engines.

- **AC-PIX-021.4** Given the pure functions, Then `lutIndex(0) = 0`, `lutIndex(2) = 0`, `lutIndex(3) = 1`, `lutIndex(77) = 19`, `lutIndex(255) = 63`, and `lutIndex(lutLevel(i)) = i` for all `i` in 0..63; and a test that greps the builder modules fails on any `Math.pow`, `Math.cbrt`, `Math.exp`, `Math.log` or `**`. *(Added 2026-10-09 (M2-01).)*
- **AC-PIX-021.5** Given the `pico-8` LUT, When the texel for entry (63, 0, 19) is read at byte offset `((2 · 64 + 0) · 512 + (3 · 64 + 63)) · 4`, Then it is (255, 0, 77, 8). Given the `pico-8` and `endesga-32` LUTs, Then every palette color `p` maps to its own index through `lutIndex`, and the LUT built in Node equals, byte for byte, the LUT built in the browser worker. *(Added 2026-10-09 (M2-01).)*

*(Amended 2026-10-09 (M2-codes): registers the code the M2 engine already raises.)* **LUT build failure.** IF a palette LUT build fails (the builder throws, or the injected LUT worker rejects, times out after 5,000 ms, or fires `error` or `messageerror`, spec 000 REQ-GEN-016) THEN THE SYSTEM SHALL fail with `PIX_PALETTE_LUT_FAILED` and SHALL NOT build that LUT on the main thread instead. A renderer started without a worker factory builds on the main thread by design; that is not a fallback. WHERE the failure is itself an engine error that already carries a code, that code is reported instead. Per entry point:

- **Settings change** (`setRenderSettings`): the call resolves with `{ ok: false }` and the code, the error is reported exactly once through `onError`, and the renderer and the pipeline both keep all previous settings (the apply is atomic, so resolution and cell size stay unchanged too). Settings calls queued behind the failed one still run in call order.
- **Renderer creation**: creation resolves with `{ ok: false }` and the code; no renderer is returned.
- **Export** (`renderFrames`): IF the LUT of the export settings fails THEN the frame iterator throws a `FrameSamplerError` with the code before it yields any frame, the preview settings stay active and the renderer lock is released. This failure goes to the export caller, not through `onError`.
- **Preview restore after an export**: IF the LUT of the preview settings fails while the preview is restored THEN the export frames already yielded are unaffected, the error is reported once through `onError`, and preview draws are skipped until the next exclusive operation (for example a settings change) re-applies the preview settings. Each failed re-apply is reported once more.

In the editor, a code reported through `onError` appears in the preview's alert as `<code>: <message>` (architecture §4.4: errors show their code, never a stack trace). [NEEDS CLARIFICATION: The M2 preview (`apps/web/src/app/use-preview.ts`) turns every `onError` report into the terminal `error` status. That disables all preview controls and hides "Dismiss", so a recoverable `PIX_PALETTE_LUT_FAILED` (the previous palette still renders) leaves the preview unusable until reload. Spec 009 REQ-UX-031/032 asks for a dismissable error toast instead. Should a recoverable engine error keep the preview controls enabled? Owner: PM with editor-ux-engineer (spec 009).]

- **AC-PIX-021.6** Given a renderer with an injected LUT worker that rejects every build, When `setRenderSettings` switches the palette to `pico-8` and the resolution to 32×32, Then the call resolves with `{ ok: false }` and code `PIX_PALETTE_LUT_FAILED`, `onError` is called exactly once with that code, the renderer's and the pipeline's settings and the cell width equal the previous ones, `paletteLutStats` is `{ workerBuilds: 0, mainThreadBuilds: 0, failures: 1 }`, and a following settings call without a palette change resolves `{ ok: true }`. Given instead a worker that never replies (mockable clock), Then the same result occurs after 5,000 ms (AC-GEN-016.2). *(Added 2026-10-09 (M2-codes).)*
- **AC-PIX-021.7** Given an export whose palette LUT build fails, When `renderFrames` is consumed, Then the iterator rejects with a `FrameSamplerError` whose code is `PIX_PALETTE_LUT_FAILED` before any frame is yielded, the pipeline holds the preview settings and `busy` is false. Given instead an export whose LUT succeeds and a preview palette whose LUT fails on restore, Then every export frame is yielded, `onError` is called exactly once with `PIX_PALETTE_LUT_FAILED`, `draw()` renders nothing, and the next `setRenderSettings` call re-applies the preview settings before its own, after which `draw()` renders a frame. *(Added 2026-10-09 (M2-codes).)*
- **AC-PIX-021.8** Given initial settings whose palette LUT build fails, When the renderer is created, Then creation resolves with `{ ok: false }` and code `PIX_PALETTE_LUT_FAILED`, and no renderer is returned. *(Added 2026-10-09 (M2-codes).)*

**REQ-PIX-022 [P1]** WHERE dither is `bayer2`, `bayer4` or `bayer8` THE SYSTEM SHALL add an ordered-dither offset `(M[y mod n][x mod n] + 0.5) / n² − 0.5`, scaled by `strength × DITHER_SPREAD`, to each color channel before palette lookup. `M` is the Bayer matrix of size `n` (Data & contracts), indexed row first: the row index is `y mod n` and the column index is `x mod n`. `x, y` are integer cell-local pixel coordinates: (0, 0) is the top-left pixel of the cell, `x` increases to the right and `y` increases downward. `strength` is in [0, 1]. *(Index order corrected 2026-10-09 (review L4): the earlier text read `M[x mod n][y mod n]`, which contradicted the `[y][x]` indexing in Data & contracts; the engine already implements `[y][x]`.)*

- **AC-PIX-022.1** Given strength 0, Then output equals the undithered output byte for byte.
- **AC-PIX-022.2** Given `bayer4` and a flat gradient fixture, Then the dither pattern repeats every 4 px in x and y, and is identical in every frame of the sheet for pixels with the same pre-dither color.
- **AC-PIX-022.3** Given dither enabled with palette `none`, Then dither is ignored, and the UI shows that it needs a palette.
- **AC-PIX-022.4** Given `bayer4` (rows of `M4`: `[0, 8, 2, 10]`, `[12, 4, 14, 6]`, `[3, 11, 1, 9]`, `[15, 7, 13, 5]`), When the threshold is evaluated for cell pixels (x, y), Then (0, 0) gives `M4[0][0] = 0` → −0.46875, (1, 0) gives `M4[0][1] = 8` → 0.03125, (0, 1) gives `M4[1][0] = 12` → 0.28125, and (5, 9) equals (1, 1) → `M4[1][1] = 4` → −0.21875. Given `bayer2`, Then (1, 0) gives `M2[0][1] = 2` → 0.125 and (0, 1) gives `M2[1][0] = 3` → 0.375. The CPU oracle and the GPU threshold node return these values exactly. *(Added 2026-10-09 (review L4).)*
- **AC-PIX-022.5** Given a test post graph that writes the `threshold` output of `post.bayerDither@1` (`bayer4`, `px` from the default cell-local pixel builtin) to the R channel as `threshold + 0.5`, When one cell is rendered and read back on WebGPU and on WebGL2 (`forceWebGL: true`), with row 0 as the top row of the read-back image, Then the R bytes at (0, 0), (1, 0), (0, 1) and (1, 1) are within ±1 of 8, 135, 199 and 72 (`round((M4[y][x] + 0.5) / 16 · 255)`), so R(0, 1) > R(1, 0) > R(1, 1) > R(0, 0), and both backends return the same bytes. A transposed index (`M[x][y]`) or a bottom-left origin fails this ordering. *(Added 2026-10-09 (review L4): pins the top-left origin and y-down orientation end to end.)*

### Alpha, color space and stage order

**REQ-PIX-023 [P1]** THE SYSTEM SHALL compute coverage as `alpha ≥ alphaCutoff` (alphaCutoff in [0.01, 1], default 0.5), output alpha 255 for covered and outline pixels, and output RGBA (0, 0, 0, 0) for every other pixel.

- **AC-PIX-023.1** Given any export, Then every pixel with alpha 0 has RGB (0, 0, 0), and no pixel has an alpha other than 0 or 255.
- **AC-PIX-023.2** Given a semi-transparent hair card with alpha 0.4 and cutoff 0.5, Then those pixels are transparent; with cutoff 0.3 they are opaque.

*(Amended 2026-10-09 (M2-01), A8.)* The cutoff also applies in the material: a fragment whose material alpha is below `alphaCutoff` SHALL be discarded in the scene pass, so it writes neither color nor normal/depth nor part ID, and it hides nothing behind it. The material and the post coverage stage read the same `alpha.cutoff` uniform (spec 007), so the two tests can never disagree.

- **AC-PIX-023.3** Given a hair card with alpha 0.4 in front of the torso and cutoff 0.5, When rendered with inner lines on (part-ID source), Then the torso pixels behind the card equal the render without the card byte for byte, and the part-ID readback there is the torso's ID. With cutoff 0.3, Then the card's pixels show the card and its part ID. *(Added 2026-10-09 (M2-01).)*

*(Amended 2026-10-09 (M2-01b), PM-approved.)* **Material alpha.** The material alpha that the cutoff tests is: for a tint in `replace` mode (spec 001 REQ-CMP-014), the alpha of the part's albedo texel (the tint replaces RGB only, so cut-out cards keep their shape); for `multiply` mode and untinted materials, the texel alpha as well. A material that is not alpha-tested (opaque, no alpha texture) writes output alpha 1 for every pixel it covers, so the coverage stage sees it as covered for any `alphaCutoff` in [0.01, 1].

- **AC-PIX-023.4** Given a camera-facing card with a `replace`-mode tint #ff0000 and an albedo texture whose left half has alpha 0 and right half alpha 1, cutoff 0.5, palette `none`, When rendered, Then only the right half's pixels are covered and they show the tinted color; the left half is transparent (RGBA 0, 0, 0, 0). *(Added 2026-10-09 (M2-01b).)*
- **AC-PIX-023.5** Given an opaque fixture material with no alpha texture and `alphaCutoff = 1`, When the scene color target is read back, Then every pixel the mesh covers has alpha exactly 1.0 and every such pixel is covered in the output (alpha 255). *(Added 2026-10-09 (M2-01b).)*

*(Clarified 2026-10-09 (QA-E).)* **Texel alpha only drives the cutoff.** For every part material, alpha-tested or not, the material alpha (texel alpha × source opacity, after the tint of spec 001 REQ-CMP-014, which changes RGB only) is used for the cutoff test and nothing else. A fragment that passes the test writes scene color alpha exactly 1.0, so no partial texel alpha reaches the coverage stage or the output. This is consistent with AC-CMP-014.3, whose alpha 0.4 is the material (base) alpha, not an output value.

- **AC-PIX-023.6** Given a camera-facing card with a `multiply`-mode tint #00ff00 and an albedo texel #ff8000 with alpha 0.4 everywhere, palette `none`, outlines and rim off, When rendered with `alphaCutoff` 0.3 and the scene color target is read back, Then every card pixel has scene alpha exactly 1.0 and output alpha 255, and its linear RGB is `(0, 0.216, 0) · light_k` (the AC-CMP-014.3 product shaded by REQ-PIX-011, ± 1/255 after sRGB decode); When rendered with `alphaCutoff` 0.5, Then every card pixel is RGBA (0, 0, 0, 0). *(Added 2026-10-09 (QA-E).)*

**REQ-PIX-024 [P1]** THE SYSTEM SHALL light in linear RGB, disable `outputColorTransform`, and convert to sRGB explicitly once, immediately before dithering and palette lookup.

- **AC-PIX-024.1** Given tint #808080 on an unlit (emissive-only) test material with palette `none`, When rendered, Then output pixels are (128, 128, 128) ± 0 on both backends.

**REQ-PIX-025 [P1]** THE SYSTEM SHALL apply post stages in this fixed order: coverage (alpha cutoff) → ~~outer and inner outline~~ rim edge (REQ-PIX-012) → outer and inner outline → sRGB conversion → dither → palette lookup → final alpha. *(Amended 2026-10-09 (FX-J, user D2): rim edge stage inserted after coverage and before the outline.)*

- **AC-PIX-025.1** Given a unit test over the stage list of the default post pipeline, Then the stage IDs are in exactly this order, equal to `DEFAULT_POST_STAGES` in Data & contracts (`coverage`, `rim`, `outline`, `srgb`, `dither`, `palette`, `final-alpha`). *(Amended 2026-10-09 (FX-J, user D2).)*

### Backends, determinism and readback

**REQ-PIX-026 [P1]** THE SYSTEM SHALL support every setting in this spec on both the WebGPU backend and the WebGL2 fallback (`forceWebGL: true`). No stage may be WebGPU-only.

- **AC-PIX-026.1** Given the golden matrix of REQ-PIX-028, When run with `forceWebGL: true`, Then every case renders and passes its WebGL2 golden.

*(Amended 2026-10-09 (M2-01b), PM-approved.)* The normal and depth MRT targets need float color buffers. IF the WebGL2 context does not support `EXT_color_buffer_float` THEN THE SYSTEM SHALL detect this when the pipeline is created (before any frame is rendered) and fail pipeline creation with `PIX_BACKEND_UNAVAILABLE`. An RGBA8 encoding fallback for those targets is deferred (not in M2).

- **AC-PIX-026.2** Given a WebGL2 renderer whose context reports no `EXT_color_buffer_float` (stubbed in a test), When the pixel pipeline is created, Then creation fails with `PIX_BACKEND_UNAVAILABLE`, no render target is allocated and no frame is rendered. *(Added 2026-10-09 (M2-01b).)*

**REQ-PIX-027 [P1]** THE SYSTEM SHALL produce byte-identical `RenderedFrame.pixels` for the same CharacterSpec, RenderSettings, graphs, app version and backend, with no reads of wall-clock time or unseeded randomness in the render path used for export (P-04).

- **AC-PIX-027.1** Given a fixture export run 3 times in one session and once after a page reload, Then the SHA-256 of every frame is identical across all 4 runs.
- **AC-PIX-027.2** Given a lint rule over `packages/engine/src/{pipeline,sampler}/**`, Then `Date.now`, `performance.now` and `Math.random` do not appear.

**REQ-PIX-028 [P1]** THE SYSTEM SHALL keep golden images per backend for presets `side`, `three-quarter` and `isometric` at 32, 64 and 128 px (18 cases), compared with tolerance 0 differing pixels unless a test documents an override and the reason.

- **AC-PIX-028.1** Given the canonical golden environment (a pinned Playwright container image with a software rasterizer: SwiftShader through ANGLE for WebGL2 and Dawn's SwiftShader adapter for WebGPU; image digest, browser, three and adapter info recorded in the goldens' `environment.json`), When the golden suite runs in CI, Then 9 WebGPU and 9 WebGL2 cases pass with 0 differing pixels. **Fallback** (only if the WebGPU software adapter cannot render to a target and read back reproducibly): the 9 WebGL2 cases are gated in CI in that container, the 9 WebGPU goldens are generated and gated on a maintainer GPU machine whose adapter info is recorded in `environment.json`, and CI reports the WebGPU cases as skipped with the reason "software adapter". *(Amended 2026-10-09 (M2-01), A10, PM decision D1; previously "Given CI on the fixed runner image".)*
- **AC-PIX-028.2** Given the same case on both backends, Then the share of differing opaque pixels is reported (informational, not failing) and a warning is logged above 2 %.
- **AC-PIX-028.3** Given the golden suite run outside the canonical environment for a backend (e.g. on a developer's real GPU), When cases differ, Then the differing-pixel count per case is reported, the run does not fail, and no golden file is written. *(Added 2026-10-09 (M2-01), D1.)*
- **AC-PIX-028.4** Given a golden update request (`--update`), When the current environment does not match `environment.json` for that backend, Then no golden is written and the command fails naming the mismatching field; When it matches, Then only the cases that differ are rewritten and the change requires a stated reason. *(Added 2026-10-09 (M2-01), D1.)*
- **AC-PIX-028.5** Given a failing golden case, When the suite finishes, Then the actual and diff images for that case are written as CI artifacts. *(Added 2026-10-09 (M2-01).)*

**REQ-PIX-029 [P1]** THE SYSTEM SHALL return `RenderedFrame.pixels` as tightly packed RGBA8 rows (`width × 4` bytes per row, no row padding), with the origin at the top-left, on both backends.

- **AC-PIX-029.1** Given a 48×40 frame (row size 192 bytes, not a multiple of WebGPU's 256-byte alignment), When read back, Then `pixels.length === 48 × 40 × 4` and an asymmetric test pattern (a marker in the top-left corner) appears at index 0 on both backends.

### Preview vs export

**REQ-PIX-030 [P1]** WHILE the preview shows a given clip, frame index and direction THE SYSTEM SHALL render pixels identical to the export frame with the same settings, except that the preview may use framing computed from the clips currently selected in the editor.

- **AC-PIX-030.1** Given the editor paused on `walk` frame 3, direction `ne`, When an export with only `walk` is run, Then the exported frame equals the preview cell's pixels byte for byte (read from the preview render target).
- **AC-PIX-030.2** Given the preview playing, Then it advances in whole frames at the clip's export fps (no in-between poses).

**REQ-PIX-031 [P1]** THE SYSTEM SHALL display the preview upscaled by an integer factor with nearest sampling, choosing the largest integer scale at which one sprite pixel covers a whole number of device pixels and the cell fits the viewport.

- **AC-PIX-031.1** Given devicePixelRatio 1.5 and a 64 px cell in a 400 CSS px viewport, Then the canvas backing store is a whole-number multiple of 64 device pixels, and every sprite pixel maps to an equal square of device pixels (checked by screenshot).

### Performance and robustness

**REQ-PIX-032 [P1]** WHILE the preview is playing at 64 px with 8 equipped parts and the default pipeline THE SYSTEM SHALL keep p95 frame time ≤ 16.7 ms and GPU time ≤ 8 ms per frame on the reference machine (P-07).

- **AC-PIX-032.1** Given the perf fixture, When the preview runs for 10 s, Then p95 frame time ≤ 16.7 ms on both backends.
- **AC-PIX-032.2** Given the same fixture at 128 px, Then p95 frame time ≤ 16.7 ms (P2 target, reported but not failing in M2).

**REQ-PIX-033 [P1]** THE SYSTEM SHALL render export frames at an average of ≤ 20 ms per frame including readback, so that the P-07 export budget (256 frames at 64 px in ≤ 10 s end to end) leaves time for encoding.

- **AC-PIX-033.1** Given 4 clips × 8 directions × 8 frames at 64 px, When `renderFrames` is consumed, Then all 256 frames are produced in ≤ 5.1 s.

**REQ-PIX-034 [P1]** WHEN only a numeric, color or boolean setting changes (bands thresholds, rim, light, outline color, dither strength, alpha cutoff) THE SYSTEM SHALL update uniforms without recompiling shaders and show the result on the next preview frame. Changing band count, outline sources, dither mode or palette may rebuild, within 300 ms.

- **AC-PIX-034.1** Given a spy on node-material rebuilds, When rim strength changes 100 times, Then the rebuild count is 0.
- **AC-PIX-034.2** Given a change from `bayer4` to `bayer8`, Then the new preview frame is shown within 300 ms.

*(Note 2026-10-09 (M2-01b), PM decision.)* The 300 ms limit stays. AC-PIX-034.2 is gated only on the reference machine (constitution perf CI), not in the software-rasterizer golden container; task M2-19 measures it. M2-14 measured 500–1180 ms in development, mostly in readback, so the result of M2-19 decides whether the implementation or the measurement point changes.

*(Clarified 2026-10-09 (FX-J-spec2).)* The outline color modes `outline.colorMode` and `outline.inner.colorMode` are `field` bindings (spec 007 reserved IDs), so changing either may rebuild within the same 300 ms; `outline.darkenAmount` and `outline.color` are uniforms and never rebuild.

**REQ-PIX-035 [P1]** THE SYSTEM SHALL implement each M2 stage (toon material, rim edge (added 2026-10-09 (FX-J, user D2)), outline, sRGB conversion, dither, palette lookup, alpha) as a function with the shape of a shader-graph node emitter, `(ctx: CompileContext, inputs, fields) => Record<outputId, node>` (the argument order of spec 007 `NodeEmitter.compile(ctx, inputs, node)`, with typed `fields` in place of the `GraphNode`), with its settings exposed as uniforms. In M4 the built-in graphs `builtin:material-toon` and `builtin:post-default` SHALL reproduce the M2 golden images pixel-exactly.

- **AC-PIX-035.1** Given the 18 golden cases, When rendered through the compiled built-in graphs (M4), Then all pass against the unchanged M2 goldens with 0 differing pixels. *(Note 2026-10-09 (QA-E): not testable in M2; verification lands in M4 with the graph compiler and the compiled `builtin:material-toon` / `builtin:post-default` graphs. Meaning unchanged.)*
- **AC-PIX-035.2** Given the stage modules, Then each exports an emitter-shaped function and none creates a material or render target itself.

*(Amended 2026-10-09 (M2-01), A1.)* The previous text gave the shape as `(inputs, ctx) => node`, which contradicted spec 007. The contract is the `StageEmitter` type in Data & contracts: context first, then inputs keyed by the spec 006 catalog input socket IDs, then typed fields; the result is keyed by the catalog output socket IDs, so the M4 `NodeEmitter.compile` can forward its arguments without reordering.

- **AC-PIX-035.3** Given each stage function and the spec 006 catalog entry it implements (table in Data & contracts), When a type-level test and a unit test with a stub `CompileContext` run, Then the function takes `(ctx, inputs, fields)` in that order, its input keys are catalog input socket IDs or the extra inputs listed for it in that table, and the keys of its result equal the catalog output socket IDs. *(Added 2026-10-09 (M2-01).)*

**REQ-PIX-036 [P2]** IF the GPU device is lost THEN THE SYSTEM SHALL recreate the renderer on the same backend, restore the current preview within 2 s, and fail any in-flight export with `PIX_DEVICE_LOST` (no partial result).

- **AC-PIX-036.1** Given a simulated device loss during preview, Then within 2 s the preview renders the same pixels as before the loss.
- **AC-PIX-036.2** Given a device loss during export, Then the export promise rejects with `PIX_DEVICE_LOST` and no files are offered.

**REQ-PIX-037 [P1]** THE SYSTEM SHALL validate RenderSettings with the Zod schema in `@csg/parts-schema`, fill missing optional fields with the defaults in Data & contracts, and report every invalid field (path + code) in one result.

- **AC-PIX-037.1** Given settings with an invalid resolution and an invalid palette, When validated, Then the result lists both errors with their paths.
- **AC-PIX-037.2** Given settings that omit `lighting`, `toon` and `outline`, Then validation succeeds and the defaults are used.

*(Amended 2026-10-09 (M2-01b), PM-approved.)* Each reported error carries the field path and one code. Paths under `resolution` use `PIX_INVALID_RESOLUTION`, `camera.*` `PIX_INVALID_CAMERA`, `directions` and `singleFacing` `PIX_INVALID_DIRECTIONS`, `toon.*` `PIX_INVALID_TOON`, and `palette.id` and `palette.colors` `PIX_PALETTE_PARSE` (unknown palette ID, a `custom` palette with no colors, or a color that is not a valid HexColor). More than 256 colors uses `PIX_PALETTE_TOO_LARGE` (AC-PIX-019.1). Every other invalid field (for example `lighting.ambient`, `outline.color`, `alphaCutoff`) uses the generic `PIX_INVALID_SETTINGS`.

- **AC-PIX-037.3** Given settings with `palette.id` `'gameboy'`, `alphaCutoff` 2 and `lighting.ambient` −0.1, When validated, Then the result lists `palette.id` with `PIX_PALETTE_PARSE`, and `alphaCutoff` and `lighting.ambient` each with `PIX_INVALID_SETTINGS`; Given `palette.id` `custom` with `colors: []` or `colors: ['#12345g']`, Then the error on `palette.colors` has code `PIX_PALETTE_PARSE`. *(Added 2026-10-09 (M2-01b).)*

### Part texture sampling

**REQ-PIX-038 [P1]** THE SYSTEM SHALL sample part textures (albedo and any other texture of a part material) with mipmaps and a mipmapped minification filter: the filter of the part's glTF sampler when it is one of the four mipmap filters, otherwise `LINEAR_MIPMAP_LINEAR`. Nearest filtering without mipmaps (REQ-PIX-002) applies only to the pipeline's render targets and the palette LUT. *(Added 2026-10-09 (M2-01), PM decision D3: bundled part textures of 256–512 px are minified into cells of at most 128 px, and sampling them without mipmaps produces texel noise that changes from frame to frame.)*

- **AC-PIX-038.1** Given a loaded part whose glTF sampler declares no filters, When its material is inspected, Then the albedo texture has mipmaps (`generateMipmaps` true or a full mip chain) and `minFilter` is `LinearMipmapLinearFilter`; Given a glTF sampler with `minFilter` NEAREST (9728), Then `minFilter` is `LinearMipmapLinearFilter`; and every pipeline render target still has nearest filters and no mipmaps (AC-PIX-002.1).
- **AC-PIX-038.2** Given an unlit test material (as AC-PIX-024.1) with a 512×512 texture of a 1-texel black/white checkerboard on a camera-facing quad that covers 16×16 output pixels, palette `none`, When rendered, Then the 8-bit gray values of the quad's interior pixels (excluding the outline and the outermost ring) differ from each other by at most 8.

### Preview failure

**REQ-PIX-039 [P2]** IF drawing a preview frame throws THEN THE SYSTEM SHALL stop the preview loop, pause playback, report the error with code `PIX_PREVIEW_FAILED` once through `onError`, and not rethrow it into the animation loop. `resume()` SHALL restart playback from the paused time without reloading the clip. *(Added 2026-10-09 (M2-codes): registers the code the M2 engine already raises.)*

The same code is reported once through `onError` IF restoring the preview after an export (the preview clip or the preview binding) throws; the export frames already yielded are unaffected and the renderer lock is released. A palette LUT failure during that restore is `PIX_PALETTE_LUT_FAILED` instead (REQ-PIX-021 note). WHERE the thrown value is itself an engine error that already carries a code, that code is reported instead of `PIX_PREVIEW_FAILED`. In the editor the code appears in the preview's alert as `<code>: <message>`; for the state of the preview controls after the error, see the open question on recoverable errors (REQ-PIX-021 note).

- **AC-PIX-039.1** Given a playing preview whose pipeline render throws on the next frame, When the animation loop runs that frame, Then no exception escapes the loop callback, the animation loop is cleared, `playing` is false, and `onError` was called exactly once with `PIX_PREVIEW_FAILED`; When the render no longer throws and `resume()` is called, Then it returns `true` and the animation loop runs again. *(Added 2026-10-09 (M2-codes).)*
- **AC-PIX-039.2** Given an export after which restoring the preview clip throws (stub), When `renderFrames` is consumed to the end, Then every export frame is yielded, `onError` is called exactly once with `PIX_PREVIEW_FAILED`, and `busy` is false. *(Added 2026-10-09 (M2-codes).)*

## Edge cases

- Character with no visible parts (all hidden or empty body) → frames are fully transparent; EXP reports `EXP_EMPTY_FRAMES` (REQ-PIX-023, spec 005).
- Clip that moves far (root motion) → clips render in place by default (spec 004 REQ-ANM-013, `rootMotion: 'in-place'`), so the union bounds stay small; with `rootMotion: 'metadata'` the character is still rendered in place and offsets go to metadata (REQ-ANM-015). REQ-PIX-007/009 still apply to vertical motion (jumps).
- Death clip lying below the pivot → in auto framing the scale also fits the extent below the pivot, so nothing clips (REQ-PIX-007 note, AC-PIX-009.3). It clips, with `PIX_FRAMING_CLIPPED` (REQ-PIX-009), only with fixed (numeric) framing or WHEN `pivotRowPx` leaves no room below the `outerWidth + 1` px margin. *(Amended 2026-10-09 (M2-01b).)*
- Width not a multiple of 64 → readback row padding stripped (REQ-PIX-029).
- WebGL2 without float color buffer support (`EXT_color_buffer_float`) → detected at pipeline creation and reported as `PIX_BACKEND_UNAVAILABLE`; an RGBA8 encoding fallback is deferred (REQ-PIX-026 note, AC-PIX-026.2). *(Amended 2026-10-09 (M2-01b); previously "normal/depth targets fall back to RGBA8 encodings".)*
- Palette LUT worker blocked by the CSP, crashing or not replying → `PIX_PALETTE_LUT_FAILED`, previous palette kept, no silent main-thread build (REQ-PIX-021 note, AC-PIX-021.6). *(Added 2026-10-09 (M2-codes).)*
- Preview frame that throws (for example a shader error) → the loop stops once with `PIX_PREVIEW_FAILED` instead of throwing every animation frame (REQ-PIX-039). *(Added 2026-10-09 (M2-codes).)*
- Two parts touching at exactly equal depth → the inner line goes on the higher part ID, then on the later pixel in row-major order (REQ-PIX-016 note).
- Cut-out card with a `replace`-mode tint → keeps the texel alpha, so the card keeps its shape (REQ-PIX-023 note, AC-PIX-023.4).
- Palette without black and outline mode `black` → darkest entry (REQ-PIX-017).
- Single-color custom palette → every covered pixel becomes that color; outlines then only show via alpha (REQ-PIX-019).
- More than 254 parts with distinct IDs → impossible by slot count (≤ 15 slots); IDs are capped at 254 (REQ-PIX-014).
- Non-square cells (e.g. 32×48) with isometric → allowed; pivot column `floor(width/2)` (REQ-PIX-008).
- Odd width → the pivot column is left of center by 0.5 px; documented, deterministic (REQ-PIX-008).
- Two custom palette colors within one LUT cell of each other (≤ about 2 levels per 8-bit channel) → one of them may not map to itself; the LUT result is still deterministic and follows the tie rule (REQ-PIX-021 note). Presets are checked by AC-PIX-021.5.
- Semi-transparent card in front of another part → discarded below the cutoff in the material, so it neither hides the part behind it nor creates inner lines (REQ-PIX-023 note, AC-PIX-023.3).
- Very thin geometry exactly on a pixel edge (pivot is a pixel corner) → coverage is decided by the rasterizer's top-left rule, deterministic per backend (REQ-PIX-008 note, REQ-PIX-027).
- Mirrored sprites with asymmetric props (sword in right hand becomes left hand) → expected behaviour of `mirrorWest`, warned in the UI (REQ-PIX-006).
- *(Added 2026-10-09 (FX-J, user D2).)* Rim with `mirrorWest` → the `w` frames are mirrored `e` frames, so their rim sits on the mirrored side (upper-right with the default light). Expected behaviour of `mirrorWest` (REQ-PIX-006, REQ-PIX-012).
- *(Added 2026-10-09 (FX-J, user D2).)* Light straight from the viewer (elevation 90°) → `L.xy = 0`, no rim pixels (REQ-PIX-012 note, AC-PIX-012.3).
- *(Added 2026-10-09 (FX-J, user D2).)* One-pixel-wide covered features (a thin strap or staff) whose neighbour toward the light is uncovered → the whole feature becomes rim colored. Deterministic and expected (REQ-PIX-012).
- *(Added 2026-10-09 (FX-J, user D2).)* Rim pixel ~~in the brightest band, or~~ with `light_k = 0` (ambient 0) → color unchanged (REQ-PIX-012 note). *(Amended 2026-10-09 (FX-J-spec2): brightest-band rim pixels now brighten to `clamp(base · (1 + strength), 0, 1)`; only a `base` that is already 1 in every channel stays unchanged.)*
- *(Added 2026-10-09 (FX-J-spec2).)* Bright, saturated `base` in the brightest band → one or two channels clip at 1 in the rim combine, so the rim pixel's hue can shift slightly toward the unclipped channels. Accepted by the PM (REQ-PIX-012 note); AC-PIX-012.7 bounds the shift on the default character.
- *(Added 2026-10-09 (FX-J, user D2).)* Covered pixel on the cell edge → the position outside the cell counts as uncovered, so it can be a rim pixel; auto framing keeps a margin so this happens only with fixed framing (REQ-PIX-007, REQ-PIX-012).
- *(Added 2026-10-09 (FX-J, user D2).)* Custom material graph that does not write the band brightness → `scene.light` is 1 (spec 006 `output.material.light` default), so the rim has no visible effect on that material.

## Data & contracts

Refines `RenderSettings` in `docs/architecture.md` §3.4. Fields marked NEW are additions; the architecture doc must be updated in the same PR that implements them. `animations` stays owned by spec 004 (ANM).

```ts
/** Direction labels in canonical order: counter-clockwise from screen-right. */
export const DIRECTION_ORDER = ['e', 'ne', 'n', 'nw', 'w', 'sw', 's', 'se'] as const;
export type DirectionLabel = (typeof DIRECTION_ORDER)[number];

/** Strength 1 shifts a channel by at most ±DITHER_SPREAD / 2 in sRGB [0, 1]. Tunable before `accepted`. */
export const DITHER_SPREAD = 0.25;
/** LUT size per channel; the LUT is stored as a 512×512 RGBA8 texture (64 slices of 64×64). Layout: REQ-PIX-021 note. */
export const PALETTE_LUT_SIZE = 64;
/** REQ-PIX-021 (A7). Integer formulas shared by the CPU builder and the GPU lookup. */
export function lutIndex(c8: number): number; // floor((c8 * 63 + 127) / 255)
export function lutLevel(i: number): number; // floor((i * 255 + 31) / 63)
/** REQ-PIX-017 (A2). Lowest OKLab L, ties lowest index. Feeds builtin render.paletteDarkest. */
export function darkestColor(colors: readonly HexColor[]): HexColor;

/** REQ-PIX-025. Post stage IDs of the default post pipeline, in their fixed order. Amended 2026-10-09 (FX-J, user D2): 'rim' inserted. */
export const DEFAULT_POST_STAGES = ['coverage', 'rim', 'outline', 'srgb', 'dither', 'palette', 'final-alpha'] as const;
export type PostStageId = (typeof DEFAULT_POST_STAGES)[number];
/** Spec 006 catalog nodes behind each post stage, in chain order. Added 2026-10-09 (FX-J, user D2). */
export const POST_STAGE_NODE_TYPES: Readonly<Record<PostStageId, readonly string[]>> = {
  coverage: ['post.alphaCutoff@1'],
  rim: ['post.rimEdge@1'],
  outline: ['post.edgeDetect@1', 'post.outline@1'],
  srgb: ['color.linearToSrgb@1'],
  dither: ['post.bayerDither@1'],
  palette: ['post.paletteQuantize@1'],
  'final-alpha': ['post.alphaCutoff@1'],
};
/**
 * REQ-PIX-012 note. Pure: rim offset (dx, dy) in top-left pixel coordinates from the
 * view-space light direction, or null when |L.xy| < 1e-6. Added 2026-10-09 (FX-J, user D2).
 */
export function rimOffset(lightDir: readonly [number, number, number]): readonly [number, number] | null;

/** REQ-PIX-035 (A1). Same argument order as spec 007 NodeEmitter.compile; fields replace the GraphNode. Pure. */
export type StageEmitter<I extends string, O extends string, F extends object = Record<string, never>> = (
  ctx: CompileContext, // spec 007
  inputs: Readonly<Record<I, TslNode>>,
  fields: Readonly<F>,
) => Record<O, TslNode>;

export interface RenderSettings {
  resolution: { width: number; height: number }; // integers 32..128
  camera: {
    preset: CameraPreset; // 'side' | 'three-quarter' | 'isometric' | 'custom'
    /** Ignored (not range-checked) unless preset = 'custom'; 0..90 in 0.5 steps. Presets: 0 / 35 / 30; custom default 35. */
    elevationDeg: number;
    /** 'auto' = fit union bounds; number = world units per pixel (> 0). */
    framing: 'auto' | number;
    /** Ground pivot row from the bottom, 0..height-1. Omitted = resolution-relative preset default (Defaults table, REQ-PIX-008 note; amended 2026-10-09 (FX-H)). */
    pivotRowPx: number;
  };
  directions: 1 | 2 | 4 | 8;
  /** NEW. Facing used when directions = 1. */
  singleFacing: DirectionLabel;
  /** NEW [P2]. Mirror e/ne/se into w/nw/sw instead of rendering them. */
  mirrorWest: boolean;
  /** Owned by spec 004 (`AnimationSelection`: clipId, label, frameCount, fps, loop, pingPong, bakePingPong, timing, range, rootMotion, directionOverrides). */
  animations: AnimationSelection[];
  /** NEW. Key light relative to the camera. */
  lighting: {
    azimuthDeg: number; // 0..360, 0 = from screen-right, 90 = from screen-top
    elevationDeg: number; // 0..90, 90 = from the viewer
    ambient: number; // 0..1, brightness of the darkest band (light_k, REQ-PIX-011 note)
  };
  /** NEW. */
  toon: {
    bands: 2 | 3 | 4;
    /** bands-1 strictly ascending values in (0, 1); omitted = evenly spaced. */
    thresholds?: number[];
    /**
     * REQ-PIX-012 (amended 2026-10-09 (FX-J, user D2)): screen-space 1 px lit edge.
     * strength 0..1. width: DEPRECATED, superseded by the screen-space rim; optional,
     * still range-checked 0..1 when present so saved settings load, never used for rendering.
     */
    rim: { enabled: boolean; strength: number; width?: number };
  };
  /** NEW. */
  outline: {
    outer: { enabled: boolean; widthPx: 1 | 2 | 3 };
    inner: {
      enabled: boolean;
      partId: boolean;
      depth: boolean;
      normal: boolean;
      depthThresholdPx: number; // > 0, output pixels from the pivot plane (REQ-PIX-014/016 notes)
      normalThresholdDeg: number; // 1..179
      /** NEW (amended 2026-10-09 (FX-J-spec2)). Inner line color mode (REQ-PIX-017 note); omitted = 'darken'. */
      colorMode: 'black' | 'darken' | 'custom';
    };
    /** Outer outline color mode only (amended 2026-10-09 (FX-J-spec2); previously both outer and inner). */
    colorMode: 'black' | 'darken' | 'custom';
    darkenAmount: number; // 0..1, shared by outer and inner `darken`
    color?: HexColor; // required when colorMode or inner.colorMode = 'custom' (amended 2026-10-09 (FX-J-spec2))
  };
  materialGraph: string; // default 'builtin:material-toon'
  postGraph: string; // default 'builtin:post-default'
  params: Record<string, number | boolean | HexColor | [number, number, number]>;
  palette: {
    id: 'none' | 'pico-8' | 'endesga-32' | 'custom';
    colors?: HexColor[]; // required when id = 'custom', 1..256, unique
    /** NEW. Nearest-color metric. */
    metric: 'oklab' | 'srgb';
    dither: { mode: 'none' | 'bayer2' | 'bayer4' | 'bayer8'; strength: number }; // 0..1
  };
  alphaCutoff: number; // 0.01..1
}
```

**Binding to graphs (M4).** When `materialGraph`/`postGraph` are the built-ins, the typed fields above are the values of the built-in graphs' exposed params, using the reserved param ID families `toon.*`, `rim.*`, `light.*`, `outline.*`, `palette.*`, `dither.*` and `alpha.cutoff`. For user graphs, a typed field applies only if the graph exposes a param with that reserved ID; otherwise the UI shows it as "controlled by graph". The one mapping table from each typed field to its reserved ID, param type and binding kind is **spec 007, "Reserved built-in param IDs"**. This spec does not repeat it; if the two ever differ, spec 007 wins and this paragraph is fixed.

**M2 stage functions** (REQ-PIX-035, A1). Each implements one spec 006 catalog node; socket IDs are the catalog's. Added 2026-10-09 (M2-01).

| Stage function | Catalog node (spec 006) | Extra inputs (not catalog sockets) |
|----------------|-------------------------|------------------------------------|
| `toonRamp` | `toon.ramp@1` | – |
| `toonRim` | `toon.rim@1` | – *(Amended 2026-10-09 (FX-J, user D2): legacy; no longer part of the default material. May be removed from the M2 stages; the catalog node stays for user graphs.)* |
| `toonCombine` | none: math nodes in M4 (~~`clamp(color + rim)`~~ `clamp(color)`; amended 2026-10-09 (FX-J, user D2)) | – (exempt from the output-key check of AC-PIX-035.3) |
| `alphaCutoff` | `post.alphaCutoff@1` | – |
| `rimEdge` | `post.rimEdge@1` (added 2026-10-09 (FX-J, user D2)) | – |
| `edgeDetect` | `post.edgeDetect@1` (field `sources`) | `outerEnabled`, `innerEnabled` (`bool`; in M4 the graph gates the outputs with `math.select@1`, spec 007 reserved IDs) |
| `outline` | `post.outline@1` (field `mode`) | – |
| `linearToSrgb` | `color.linearToSrgb@1` | – |
| `bayerDither` | `post.bayerDither@1` (field `matrix`) | – |
| `paletteQuantize` | `post.paletteQuantize@1` | – |
| `finalAlpha` | second `post.alphaCutoff@1` | – |

**Defaults**

| Field | `side` | `three-quarter` | `isometric` |
|-------|--------|-----------------|-------------|
| resolution | 64×64 | 64×64 | 64×64 |
| directions | 2 | 8 | 8 |
| singleFacing | `e` | `s` | `s` |
| pivotRowPx | ~~2~~ `outerWidth + 2` (3) | ~~4~~ `round(H·3/16)` (12) | ~~6~~ `round(H·5/32)` (10) |
| framing | `auto` | `auto` | `auto` |

The `custom` preset uses the `three-quarter` column plus `elevationDeg` 35 (REQ-PIX-004 note, added 2026-10-09 (M2-01b)).

*(Amended 2026-10-09 (FX-H), PM-approved.)* `pivotRowPx` defaults are resolution-relative: `H` is `resolution.height`, `outerWidth` is the outer outline width (0 when disabled), `round(x) = floor(x + 0.5)`; values in parentheses are for the default 64×64 cell with the default outline. An explicit `camera.pivotRowPx` overrides. Rules and rationale: REQ-PIX-008 note; values at 32 / 64 / 128 px: AC-PIX-008.5.

~~Shared defaults (the lighting, toon and outline values are provisional until the user approves the look, D2, see Open questions): `mirrorWest` false; lighting azimuth 135°, elevation 45°, ambient 0.15; toon 3 bands, rim enabled, strength 0.35, width 0.25; outer outline on, width 1; inner lines on with `partId` only, `depthThresholdPx` 4, `normalThresholdDeg` 60; colorMode `darken`, darkenAmount 0.6; palette `none`, metric `oklab`, dither `none` strength 0.5; alphaCutoff 0.5.~~ *(Superseded 2026-10-09 (FX-J, user D2) by the table below.)*

*(Amended 2026-10-09 (FX-J, user D2).)* **Shared defaults.** The default look follows the user-approved direction D2 "Brighter + punchier" (2026-10-09): lighter outfit colors (spec 001 default tints), stronger toon band contrast, a clear black outer outline, no stray light pixels. ~~Rows marked **TBD** are placeholders: their values are set by FX-J tuning and SHALL be filled in here before the REQ-PIX-028 goldens are frozen.~~ *(Amended 2026-10-09 (FX-J-spec2): the former TBD rows are filled in with the FX-J values below; the defaults are no longer provisional. Golden freeze: REQ-PIX-011 "Look status" note.)* *(Amended 2026-10-09 (D2 approved): the user approved the final look on 2026-10-09; these defaults are final and the goldens may now be frozen, REQ-PIX-011 "Final look approved" note.)*

| Field | Default |
|-------|---------|
| `mirrorWest` | false |
| `lighting.azimuthDeg` / `lighting.elevationDeg` | 135° / 45° |
| `lighting.ambient` | ~~**TBD by FX-J tuning (filled before golden freeze).**~~ ~~0.15~~ 0.1 (FX-J, amended 2026-10-09 (FX-J-spec2)) |
| `toon.bands` | 3 |
| `toon.thresholds` | ~~**TBD by FX-J tuning (filled before golden freeze).**~~ omitted, i.e. evenly spaced `k / bands`: 1/3 and 2/3 at 3 bands (FX-J, amended 2026-10-09 (FX-J-spec2)) |
| `toon.rim.enabled` | true |
| `toon.rim.strength` | ~~**TBD by FX-J tuning (filled before golden freeze).**~~ ~~0.35~~ 0.5 (FX-J, amended 2026-10-09 (FX-J-spec2)) |
| `toon.rim.width` | ~~0.25~~ deprecated (REQ-PIX-012); optional, no default (validation never fills it in), ignored by the default pipeline when present. *(Amended 2026-10-09 (FX-J-spec2).)* Only a legacy graph using `toon.rim@1` reads it; the engine then binds the saved value, or 0.25 when absent (spec 007 reserved IDs). |
| `outline.outer` | enabled, `widthPx` 1 |
| `outline.inner` | enabled, `partId` only, `depthThresholdPx` 4, `normalThresholdDeg` 60 |
| `outline.colorMode` | ~~`darken`~~ `black` (the clear black outer outline of D2; ~~see Open questions for inner lines~~ outer outline only since 2026-10-09 (FX-J-spec2), REQ-PIX-017 note) |
| `outline.inner.colorMode` | `darken` (NEW, added 2026-10-09 (FX-J-spec2), REQ-PIX-017 note) |
| `outline.darkenAmount` | 0.6 (used only by a mode `darken`, outer or inner) |
| `outline.color` | none; required when either color mode is `custom` |
| `palette` | `none`, metric `oklab`, dither `none`, strength 0.5 |
| `alphaCutoff` | 0.5 |

**Band brightness to the post stages** (added 2026-10-09 (FX-J, user D2)). The scene pass makes the material's band brightness `light_k` (REQ-PIX-011) available to post stages as builtin `scene.light` (`float`, 0..1; spec 007). It is stored in a free channel of an existing MRT target; no additional render target is created (REQ-PIX-014: still one scene render per frame). Materials that do not write it (custom material graphs that leave `output.material.light` unconnected, spec 006) write 1.

*(Informational, added 2026-10-09 (FX-J-spec2); the storage location is an implementation detail, not a contract.)* FX-J stores `scene.light` in the G channel of the part-ID MRT target: the toon material writes `light_k`, non-toon materials (for example unlit test materials) write 1, and background pixels read 0 (the target's clear value). Post graphs read it only through the builtin `scene.light` (spec 007), so the channel may move without a spec change.

**Bayer matrices** (`M2`, `M4`, `M8`) are the standard recursive index matrices, with `M2 = [[0, 2], [3, 1]]` and `M(2n) = [[4M, 4M+2], [4M+3, 4M+1]]`, indexed `[y][x]`.

**PICO-8 palette** (index order): `#000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8 #FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA`. Verified 2026-10-08 against the Lospec `pico-8.hex` download (identical, same order). Data files store hex lowercase (REQ-CMP-016).

**Endesga-32** (Lospec order): `#be4a2f #d77643 #ead4aa #e4a672 #b86f50 #733e39 #3e2731 #a22633 #e43b44 #f77622 #feae34 #fee761 #63c74d #3e8948 #265c42 #193c3e #124e89 #0099db #2ce8f5 #ffffff #c0cbdc #8b9bb4 #5a6988 #3a4466 #262b44 #181425 #ff0044 #68386c #b55088 #f6757a #e8b796 #c28569`. Verified 2026-10-08 against the Lospec `endesga-32.hex` download (all 32 values identical, same order). The data file must stay byte-equal to that source (AC-PIX-020.1).

**Error and warning codes:** `PIX_INVALID_RESOLUTION`, `PIX_INVALID_CAMERA`, `PIX_INVALID_DIRECTIONS`, `PIX_INVALID_TOON`, `PIX_INVALID_SETTINGS` (any other invalid field, with its path; added 2026-10-09 (M2-01b)), `PIX_PALETTE_TOO_LARGE`, `PIX_PALETTE_DUPLICATES` (warning), `PIX_PALETTE_PARSE` (import parse errors, unknown palette ID, empty custom palette, invalid hex color), `PIX_FRAMING_CLIPPED` (warning), `PIX_DEVICE_LOST`, `PIX_BACKEND_UNAVAILABLE` (architecture §4.4; also WebGL2 without `EXT_color_buffer_float`, AC-PIX-026.2), `PIX_PALETTE_LUT_FAILED` (a palette LUT build failed, including a LUT worker that rejects, times out or fires `error`/`messageerror`; the previous settings stay active; REQ-PIX-021 note, AC-PIX-021.6 to .8; added 2026-10-09 (M2-codes)), `PIX_PREVIEW_FAILED` (a preview frame threw, so the loop stops and playback pauses, or restoring the preview after an export threw; REQ-PIX-039; added 2026-10-09 (M2-codes)). The path-to-code mapping is in the REQ-PIX-037 note.

## Non-functional

- Determinism: P-04 per backend (REQ-PIX-027). The three.js pin (ADR-0003) is part of the determinism key; upgrades re-baseline goldens on both backends.
- Stability: P-05 (REQ-PIX-002, 010, 031).
- Performance: P-07 and architecture §4.3 (REQ-PIX-032, 033, 034). Note that architecture §4.3 lists "5 clips × 8 directions × 8 frames < 5 s" while P-07 says "4 clips × 8 × 8 ≤ 10 s". The constitution wins. REQ-PIX-033 targets the GPU share of P-07.
- Resource hygiene: render targets and the LUT texture are reused across frames and resized only when resolution or palette changes. No allocations per frame in the render loop.
- Framework-agnostic: P-10. All of this lives in `packages/engine/src/pipeline` and `src/sampler`.

## Notes for implementers (non-normative)

Added 2026-10-09 (M2-01b). Informational findings from M2 implementation; they do not add requirements.

- **three r186 `select` on WebGL2.** On the WebGL2 backend, three r186 fails to compile a TSL `select` whose branch contains a texture fetch. The M2 stages use an exact 0/1 blend instead, `pick(a, b, t) = a · (1 − t) + b · t` with `t` exactly 0 or 1, which equals a select for finite `a` and `b` (a NaN or infinite operand on the unpicked side would leak through, so stage inputs must stay finite). The M4 graph compiler (spec 007, e.g. `math.select@1` gating reserved booleans) needs the same workaround or an ADR note until a three upgrade fixes it.
- **Node frame.** The pixel pipeline advances three's node frame itself on each render, with exactly one scene render per frame (AC-PIX-014.2). Callers render only through the pipeline's `render` (task M2-14 contract), not through the renderer directly, so the node frame advances once per output frame.

## Open questions

- ~~Should root motion be stripped (in-place) by default for export, or kept and recorded as per-frame offsets?~~ Resolved 2026-10-08 by spec 004: in-place by default (REQ-ANM-013), with optional per-frame offsets as metadata (`rootMotion: 'metadata'`, REQ-ANM-015).
- [NEEDS CLARIFICATION: Should the default `framing` be `auto`, or a fixed project scale (e.g. 32 px per meter) so that characters across a game share a scale? Owner: product owner. Default `auto` until decided.]
- [NEEDS CLARIFICATION: Is `DITHER_SPREAD = 0.25` the right default? Owner: graphics-engineer with a pixel artist review in M2. Not blocking.]
- [NEEDS CLARIFICATION: Is 35° the desired `three-quarter` elevation? Many 3/4 RPG sprites look closer to 45–60°. Owner: product owner. Custom elevation (REQ-PIX-004) is the workaround.]
- [NEEDS CLARIFICATION: Palette licensing under P-02. Checked 2026-10-08: the Lospec pages for PICO-8 and Endesga-32 state no license; Endesga-32 is credited to ENDESGA, and the PICO-8 colors come from Lexaloffle's commercial PICO-8 console. A palette is a short list of color values. Proposal: record each bundled palette in `ASSETS_LICENSE.md` with author, source URL and the note "color list, no license stated by the source", list it in `CREDITS.txt` (REQ-EXP-020) and do not show a license warning. Owner: maintainers. Not blocking M2.]
- ~~[NEEDS CLARIFICATION: User approval of the default look (PM decision D2, 2026-10-09: provisional). The band/rim formula of REQ-PIX-011/012 (A5) and the shared lighting, toon and outline defaults stay provisional until the user approves sample sprites from the M2 pipeline. Owner: product owner (user). Does not block M2 implementation; blocks committing the REQ-PIX-028 goldens (task M2-18), which freeze the look for REQ-PIX-035. Record the approval date here when given.]~~ ~~*(Update 2026-10-09 (FX-J, user D2): the user chose the direction "Brighter + punchier" on 2026-10-09. The PM replaced the rim with the screen-space rim edge (REQ-PIX-012) and made the outline black by default. Still open: the user confirms the FX-J look, and the TBD defaults are filled in; the goldens stay blocked until then.)*~~ **Resolved 2026-10-09 (FX-J-spec2):** the user approved the direction "Brighter + punchier" (D2) on 2026-10-09, and the FX-J defaults are in the Defaults table. ~~The goldens may be frozen after the user's final look confirmation (REQ-PIX-011 "Look status" note); that is a release step, not an open question.~~ *(Amended 2026-10-09 (D2 approved): the user approved the final look on 2026-10-09; the goldens may now be frozen, REQ-PIX-011 "Final look approved" note.)*
- ~~[NEEDS CLARIFICATION: With the D2 combine `base · min(light_k + strength, 1)` the rim has no visible effect on brightest-band pixels (`light_k = 1`). With the default light (elevation 45°), silhouette pixels reach `λ` of about 0.7 to 0.9, so with the previous evenly spaced top threshold 2/3 the rim would disappear on the part of the silhouette that faces the light most directly. Should FX-J tune the top threshold so that silhouette pixels facing the light stay below the brightest band, or should the ceiling change (for example `clamp(base · (light_k + strength), 0, 1)`, which brightens past `base` and may shift hue where a channel clips)? Owner: PM with graphics-engineer (FX-J). Added 2026-10-09 (FX-J, user D2). Blocks the golden freeze only.]~~ **Resolved 2026-10-09 (FX-J-spec2), PM decision:** the combine is `clamp(base · (light_k + strength), 0, 1)` per channel (REQ-PIX-012), so the rim also shows in the brightest band; small hue shifts where a channel clips are accepted. Thresholds stay evenly spaced.
- ~~[NEEDS CLARIFICATION: `outline.colorMode` applies to outer outlines and inner lines alike, so the new default `black` also makes inner part lines black. D2 asked for a black outer outline. Are black inner lines acceptable, or should a per-outline mode (for example a NEW `outline.outer.colorMode`, with inner lines staying `darken`) be added? Owner: PM, decided at the FX-J look review. Added 2026-10-09 (FX-J, user D2). Blocks the golden freeze only.]~~ **Resolved 2026-10-09 (FX-J-spec2), PM decision:** NEW field `outline.inner.colorMode` (default `darken`); `outline.colorMode` (default `black`) now colors the outer outline only (REQ-PIX-017 note, AC-PIX-017.5).
- [NEEDS CLARIFICATION: The engine wraps every failure of the pipeline's settings apply (renderer creation, `setRenderSettings`, the export switch and the preview restore) as `PIX_PALETTE_LUT_FAILED`, so a failure that is not a LUT build (for example a post-chain rebuild that throws) is reported under that code too. Should those failures get their own code, or is `PIX_PALETTE_LUT_FAILED` acceptable as the code for any failed settings apply? Owner: graphics-engineer with PM. Added 2026-10-09 (M2-codes). Does not block M2.]
- See also the REQ-PIX-021 note on recoverable engine errors in the M2 editor preview (controls disabled after any `onError` report). Owner: PM with editor-ux-engineer.
- [NEEDS CLARIFICATION: Spec 002 assumes this spec draws the face decal layer (texel snapping, palette interaction), but no requirement here covers it yet. Owner: spec 003 author with spec 002. Blocks the face decal feature (spec 002) only.]

## References

- ADR-0001 (3D to pixel pipeline), ADR-0003 (WebGPURenderer, TSL, RenderPipeline, r186 pin)
- `docs/architecture.md` §2.1, §3.4, §3.6, §4.1, §4.3, §4.7
- `specs/constitution.md` P-04, P-05, P-07, P-10, P-11
- `.tagconn/work/research.md` §Rendering
- three.js WebGPURenderer / TSL / RenderPipeline docs: https://threejs.org/docs/ (accessed 2026-10-08)
- WebGPU `copyTextureToBuffer` `bytesPerRow` 256-byte alignment: https://www.w3.org/TR/webgpu/#gpuimagecopybuffer (accessed 2026-10-08)
- OKLab color space, B. Ottosson: https://bottosson.github.io/posts/oklab/ (accessed 2026-10-08)
- Ordered dithering / Bayer matrix: https://en.wikipedia.org/wiki/Ordered_dithering (accessed 2026-10-08)
- `.tagconn/work/m2-plan.md` §2 and §5 (amendments A1–A10) and PM decisions D1–D3 of 2026-10-09 in `.tagconn/work/backlog.md`
- M2 follow-up decisions (M2-11, M2-12, M2-14, FX-F, M2-01b) of 2026-10-09 in `.tagconn/work/backlog.md`
- User decision D2 "Brighter + punchier", the PM rim decision and the FX-I finding (2026-10-09) in `.tagconn/work/backlog.md`; FX-I diagnosis test `packages/engine/test/gpu/light-edge-pixels.gpu.ts` (light-pixel metric, CPU mock-up of the screen-space rim)
- FX-K and FX-L entries of 2026-10-09 in `.tagconn/work/backlog.md` (isolated light pixels from authored grey hair and trim; AC-PIX-012.8 rim-on vs rim-off amendment) and the FX-M entry of 2026-10-09 (AC-PIX-012.8 rim-made light pixel amendment); silhouette and isolation counting in `packages/engine/test/gpu/real-character.ts`
- FX-J results and PM decisions of 2026-10-09 (rim clamp combine, `outline.inner.colorMode`, default values) in `.tagconn/work/backlog.md` (FX-J, FX-J-spec, FX-J-spec2 entries); FX-J implementation read for the values: `packages/parts-schema/src/render-settings.ts`, `packages/engine/src/pipeline/stages/outline.ts`, `packages/engine/src/pipeline/settings-binder.ts`
- HSV hue (used by AC-PIX-012.7): https://en.wikipedia.org/wiki/HSL_and_HSV
- Rec. 709 luma coefficients 0.2126 / 0.7152 / 0.0722 (used by AC-PIX-012.8): ITU-R BT.709, https://www.itu.int/rec/R-REC-BT.709
- `EXT_color_buffer_float` (WebGL2 float render targets): https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/ (accessed 2026-10-09)
- glTF 2.0 sampler filters (mipmap filter enums 9984–9987): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#samplers (accessed 2026-10-09)
- Playwright Docker images: https://playwright.dev/docs/docker (accessed 2026-10-09)
- Lospec palettes (accessed and verified 2026-10-08; the pages state no license):
  - PICO-8 (16 colors, from Lexaloffle Games' PICO-8): https://lospec.com/palette-list/pico-8, data https://lospec.com/palette-list/pico-8.hex
  - Endesga-32 (32 colors, by ENDESGA): https://lospec.com/palette-list/endesga-32, data https://lospec.com/palette-list/endesga-32.hex
- GIMP palette (`.gpl`) format: https://developer.gimp.org/core/standards/gpl/ (accessed 2026-10-08)
- Isometric 2:1 pixel art projection (30° elevation): https://en.wikipedia.org/wiki/Isometric_video_game_graphics (accessed 2026-10-08)
