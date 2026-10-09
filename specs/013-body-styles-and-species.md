---
id: STY
title: Body styles and species
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 003-pixel-render-pipeline, 004-animation, 005-export, 009-editor-shell-ux, 011-asset-pipeline]
last_updated: 2026-10-09
---

# 013 – Body styles and species

## Rules for IDs

`REQ-STY-NNN` and `AC-STY-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused. Tests cite AC IDs (constitution P-09).

## Context

The PM decided on 2026-10-09 that a character has a body **style** (`realistic`, `chibi`, `stickman`, `voxel`) and a **species** (`human`, `animal`, `monster`), stored in `CharacterSpec` version 2 (spec 001 REQ-CMP-038..049). M3 ships `realistic` and `chibi` for humans: chibi is an anatomy preset (spec 002 REQ-ANA-013, REQ-ANA-024). This spec covers the rest, in milestone **M3.5 "Styles & species"**:

- **Stickman** and **voxel** (labelled "Voxel", described "Blocky, built from cubes") are procedural styles. They draw generated geometry pinned rigidly to the shared skeleton, with no skinning, so every clip and every anatomy slider keeps working.
- **Body composition** (`weight`, `muscle`) is a CPU-baked bind-space normal inflation of the body and its outfits. It amends spec 002 NG2 (dated note there).
- **Animal** species are anthropomorphic: human body and posture, an animal head on the `head` socket, a tail on a new `tail` socket, ears and paws. **Monster** species keep the humanoid body and add horns, spikes, a tail and a monster head.

The engine reports the pairs it can render in `SUPPORTED_STYLE_COMBOS` (spec 001 Data & contracts). The composer and the spec 014 new-character wizard enable only pairs that are in that list AND whose required content is in the loaded packs, and show "Coming soon" for the rest (spec 001 REQ-CMP-043..045; one gating rule, PM 2026-10-09). This spec says which requirements must pass before a pair joins the list (REQ-STY-029).

Relevant decisions: ADR-0001 (3D to pixel), ADR-0003 (TSL, both backends), ADR-0008 (shared rig, skeleton groups), ADR-0009 (golden images). The voxel proportions take a well-known block-character game as a visual reference only; that game's name does not appear in UI text (REQ-STY-009).

## Goals

- G1: Four body styles that all play every bundled clip, follow every anatomy slider, and export through the unchanged pixel pipeline.
- G2: Weight and muscle variation without authored morph targets or per-part data (P-11).
- G3: Animal and monster characters built from CC0 assets and data-driven procedural parts.
- G4: Every new path is deterministic (P-04), stays within the P-07 budgets, and has golden images on both backends.

## Non-goals

- NG1: Quadrupeds or other non-humanoid skeletons. Animals keep the human skeleton and posture.
- NG2: Physics or simulation (tail, ear or fur dynamics, cloth). Motion is a function of clip time only.
- NG3: Fur rendering (shells, cards, strands). Fur is a tint plus the toon ramp.
- NG4: Compatibility with third-party block-character skin files. The voxel atlas layout is our own (Data & contracts).
- NG5: Assets under the Quaternius Asset License, including "Bestiary" (REQ-STY-028).
- NG6: Body composition for `stickman` and `voxel` (ignored, REQ-STY-010), and composition morph targets or sculpting (spec 002 NG2).
- NG7: The wizard and workspace layout. These belong to spec 014 (spec 009 before the 2026-10-09 split); this spec only gates which options are enabled.

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | a stickman or blocky style | I can prototype or match a minimalist game look |
| US-2 | P1 | indie game dev | to make characters heavier, thinner or more muscular | NPCs do not look cloned |
| US-3 | P1 | indie game dev | animal-headed and monster characters with tails | I can fill a fantasy cast from one tool |
| US-4 | P2 | pixel artist | blocky characters with flat colors from my tints | I get clean, palette-friendly sprites |
| US-5 | P2 | modder | to add ears, horns, tails and heads as data | I contribute without engine code (P-11) |

## Requirements

### Support matrix

**REQ-STY-001 [P1]** THE SYSTEM SHALL render the style- and species-specific geometry of this spec only for (`style`, `species`) pairs in `SUPPORTED_STYLE_COMBOS`, and the M3.5 target list SHALL be, in this order: `realistic`/`human`, `chibi`/`human`, `realistic`/`animal`, `chibi`/`animal`, `realistic`/`monster`, `chibi`/`monster`, `stickman`/`human`, `voxel`/`human`.

- **AC-STY-001.1** Given an M3.5 build in which every pair passed REQ-STY-029, When `SUPPORTED_STYLE_COMBOS` is read, Then it equals the 8 pairs above in that order.
- **AC-STY-001.2** Given an M3.5 build and a character `stickman`/`animal`, When it is loaded, Then the spec 001 REQ-CMP-043 fallback renders `stickman`/`human` and the notice names Animal.

### Stickman

**REQ-STY-002 [P1]** WHERE `style` is `stickman` THE SYSTEM SHALL draw the character as one capsule per segment of the style's segment list (`StyleDefinition.stickman.segments`, data; each segment a joint and one of its descendants; no finger joints and no `*_leaf_*` joints) plus one sphere for the head centred at the head joint (`socketBones.head`) plus the data offset `headCenter`.

- **AC-STY-002.1** Given the shipped `stickman.json` and the committed rig, When validated, Then every segment names two joints in `bones`, the second is a descendant of the first, and no segment names a joint listed in `regionBones.hands` other than `hand_l` and `hand_r` or a joint whose name contains `_leaf_`.
- **AC-STY-002.2** Given the shipped data (19 segments) and default anatomy, When the stickman is built in the rest pose, Then it has exactly 19 capsules and 1 sphere, and each capsule's two end centres equal the world positions of its two joints (± 1e-5 m).

**REQ-STY-003 [P1]** WHILE `style` is `stickman` THE SYSTEM SHALL, for every sampled frame after anatomy and grounding (spec 002 application order steps 3–4), place each capsule rigidly between the current world positions of its two joints, with no skinning, so every clip of spec 004 plays.

- **AC-STY-003.1** Given the `walk` clip at frame 3 of 8, When the stickman pose is evaluated, Then every capsule's end centres equal its joints' world positions (± 1e-5 m).
- **AC-STY-003.2** Given each of the 43 bundled clips, When frames 0 and ⌊N/2⌋ are rendered at 64 px on WebGL2 (`forceWebGL`), Then no error is raised and every frame has at least 1 opaque pixel.
- **AC-STY-003.3** Given the same frame sampled twice, When the capsule transforms are compared, Then they are bit-identical (P-04).

**REQ-STY-004 [P1]** THE SYSTEM SHALL draw every stickman capsule with a projected diameter of at least 1 output pixel at the current output resolution, by using the radius `r = max(r_data · limbThickness, 0.5 · s)`, where `r_data` is the segment radius from data and `s` is the world size of one output pixel under the current framing (spec 003).

- **AC-STY-004.1** Given 32 px output, the side camera, default anatomy and `idle` frame 0, When each of the 8 directions is rendered, Then the opaque mask is one 8-connected component, and every row (for a capsule whose projected axis is closer to vertical) or every column (otherwise) between its projected end centres contains at least 1 opaque pixel.
- **AC-STY-004.2** Given output resolutions 32 px and 128 px, When `r` is computed for each capsule, Then `r ≥ 0.5 · s` at both resolutions, and at 128 px `r = r_data` for every capsule of the shipped data.

**REQ-STY-005 [P1]** WHILE `style` is `stickman` THE SYSTEM SHALL apply the anatomy parameters through the skeleton (spec 002), so the length parameters stretch the capsules between their moved joints, `limbThickness` scales the `r_data` of the arm and leg capsules, and `head` scales the head sphere radius.

- **AC-STY-005.1** Given `armLength = 1.25`, When the rest pose is built, Then the `upperarm_l` → `lowerarm_l` capsule is 1.25× its length at `armLength = 1` (± 1e-4 m).
- **AC-STY-005.2** Given `head = 2.00`, When built, Then the head sphere radius is 2× its default (± 1e-4 m); Given `limbThickness = 1.5` at 128 px, Then every arm and leg capsule radius is 1.5× `r_data` and the spine capsules are unchanged.

### Voxel

**REQ-STY-006 [P1]** WHERE `style` is `voxel` THE SYSTEM SHALL draw the character as 10 boxes with these nominal sizes in skin pixels (width × height × depth): head 8×8×8, body 8×12×4, and for each arm and each leg an upper and a lower box of 4×6×4 (one 4×12×4 limb split at the elbow or knee). The world unit is `u` = rest distance between the joints `socketBones.pelvis` and `socketBones.head` ÷ 12. The head is a cube of 8u whose bottom face is centred on the head joint; the body is 8u wide and 4u deep and spans from the pelvis joint to the head joint; limb boxes have a 4u × 4u cross-section and span their joints as listed in `StyleDefinition.voxel.boxes` (data), with each lower-leg box extended so that its lower face is at y = 0 in the rest pose.

- **AC-STY-006.1** Given the committed rig and default anatomy, When the voxel character is built in the rest pose, Then the head is a cube of edge 8u, the body measures 8u × 12u × 4u, and every limb box cross-section is 4u × 4u (± 1e-5 m).
- **AC-STY-006.2** Given the same build, When the lower-leg boxes are measured, Then their lower faces are at y = 0 (± 1e-3 m), and the end face of each upper box coincides with the start face of its lower box (centre distance ≤ 1e-5 m).

**REQ-STY-007 [P1]** WHILE `style` is `voxel` THE SYSTEM SHALL pin each box rigidly to its bone (upper arms to `upperarm_*`, lower arms to `lowerarm_*`, thighs to `thigh_*`, lower legs to `calf_*`, body to `spine_02`, head to the head joint), with no skinning, so that elbows and knees bend under every clip and the boxes inherit their bone's anatomy scale.

- **AC-STY-007.1** Given a fixture clip that rotates `lowerarm_l` by 90° at frame 4, When frame 4 is evaluated, Then the left lower-arm box is rotated 90° relative to the left upper-arm box (± 0.01°) and the upper-arm box's world transform equals that of frame 0.
- **AC-STY-007.2** Given `armLength = 1.2`, When the rest pose is built, Then each upper-arm box is 1.2× its default length (± 1e-4 m).
- **AC-STY-007.3** Given each of the 43 bundled clips, When frames 0 and ⌊N/2⌋ are rendered at 64 px on WebGL2, Then no error is raised.

**REQ-STY-008 [P1]** WHILE `style` is `voxel` THE SYSTEM SHALL texture all boxes from one 64×64 RGBA8 atlas, generated deterministically by writing, for each cell of the data template (`StyleDefinition.voxel.template`), the current `CharacterSpec.tints` color of the cell's tint slot (or transparent), sampled with nearest filtering and no mipmaps, and mapping box faces by the box-UV layout in Data & contracts.

The template legend maps the PM's color roles to tint slots: skin → `skin`, hair → `hair`, eyes → `eyes`, shirt → `primary`, pants → `secondary`, shoes → `leather`.

- **AC-STY-008.1** Given the same tints, When the atlas is generated twice, in Node and in Chromium, Then the four RGBA buffers have the same SHA-256.
- **AC-STY-008.2** Given a change of `primary` only, When the atlas is regenerated, Then exactly the cells whose legend slot is `primary` change, no box geometry is rebuilt, and the update takes < 16 ms (spec 001 AC-CMP-033.1).
- **AC-STY-008.3** Given the voxel material, When inspected, Then the atlas texture has `magFilter` and `minFilter` nearest and `generateMipmaps` false.

**REQ-STY-009 [P2]** THE SYSTEM SHALL label the `voxel` style "Voxel" with the description "Blocky, built from cubes" (matching spec 014 REQ-UX-090; reference updated 2026-10-09 after the spec 009 split), and no locale message, file name, export metadata field or website page of the project SHALL name a third-party game as a style reference.

- **AC-STY-009.1** Given the `en` message catalog, When the label and description of style `voxel` are read, Then they are "Voxel" and "Blocky, built from cubes".
- **AC-STY-009.2** Given every locale catalog of `apps/web`, the built export metadata of a voxel export and `docs/guide/**`, When searched case-insensitively for "minecraft", Then there are 0 matches.

**REQ-STY-010 [P1]** WHILE `style` is `stickman` or `voxel` THE SYSTEM SHALL not draw any skinned part (the body included) while keeping it in the `CharacterSpec`, SHALL draw equipped static props on their sockets (spec 002 REQ-ANA-007), and SHALL ignore `composition`.

- **AC-STY-010.1** Given the default character plus a sword in `prop-main-hand`, When the style changes to `stickman`, Then the part-ID output contains only the stickman ID and the sword's ID, and `parts` is unchanged; When it changes back to `realistic`, Then the outfit is drawn again and the registry `resolve` call count is unchanged.
- **AC-STY-010.2** Given `style: 'voxel'` and `composition: { weight: 1, muscle: 1 }`, When rendered, Then the pixels equal the same spec without `composition` exactly.

### Body composition

**REQ-STY-011 [P1]** WHERE `style` is `realistic` or `chibi` THE SYSTEM SHALL apply `CharacterSpec.composition` (spec 001 REQ-CMP-041) to the body and to every equipped skinned part, and SHALL offer two labelled sliders, Weight and Muscle (−1.00 to 1.00, step 0.25), in the anatomy panel, each recording one undo step per completed drag or keyboard burst (spec 009 coalescing).

- **AC-STY-011.1** Given `composition` absent and given `{ weight: 0, muscle: 0 }`, When the default character is rendered, Then both outputs equal the M3 golden image exactly.
- **AC-STY-011.2** Given keyboard focus on Weight, When the user presses Right Arrow twice, Then `weight` is 0.50 and one undo restores 0.

**REQ-STY-012 [P1]** THE SYSTEM SHALL displace each vertex in bind space as `p' = p + n · d`, with `d = Σ_i w_i · g(b_i)` and `g(b) = R(b) · (fat[b] · W + muscle[b] · M)`, where `n` is the unit bind-space normal averaged over all vertices of the mesh that share the vertex's bind position, `w_i` and `b_i` are its skin weights and bones, `W` and `M` are the quantized inputs (REQ-STY-017), `R(b)` is the bone radius (REQ-STY-013), and `fat` and `muscle` come from the girth table (`CompositionTable.girth`, data). The table maps belly to `spine_01` and `spine_02`, chest to `spine_03`, hips to `pelvis`, upper arm to `upperarm_*`, thigh to `thigh_*` and calf to `calf_*`; every other bone has coefficients 0.

- **AC-STY-012.1** Given a fixture cylinder of radius 0.1 m skinned 100 % to `spine_01` with `fat = 0.35`, `muscle = 0.05`, When `W = 1`, `M = 0`, Then every side vertex moves 0.035 m outward along its normal (± 1e-6 m); When `W = −1`, Then it moves 0.035 m inward.
- **AC-STY-012.2** Given a fixture mesh with split normals (vertices sharing a position with different normals), When baked at `W = 1`, Then all vertices that shared a bind position still share one position (bit-identical).
- **AC-STY-012.3** Given a vertex skinned only to `hand_l` (coefficients 0), When baked at any `W`, `M`, Then its position is bit-identical to the input.

**REQ-STY-013 [P1]** THE SYSTEM SHALL clamp each vertex displacement to `|d| ≤ c · Σ_i w_i · R(b_i)` with `c = CompositionTable.clampRatio` (0.40), where `R(b)` is estimated once per body from the body mesh in its bind pose as the median distance, to the segment from joint `b` to its first child in `bones`, of the body vertices whose largest skin weight is `b`.

- **AC-STY-013.1** Given the fixture cylinder of radius 0.1 m, When `R(spine_01)` is estimated, Then it is 0.1 m (± 1e-4 m).
- **AC-STY-013.2** Given the fixture with coefficients that give an unclamped `d` of 0.06 m, When baked, Then `d` is 0.04 m (± 1e-6 m).

**REQ-STY-014 [P1]** WHEN `composition`, the body, an equipped skinned part or `style` changes THE SYSTEM SHALL bake the displaced bind-space positions on the CPU once for the affected meshes, deterministically, and SHALL add no per-frame work: no displacement is computed in shaders, during frame sampling, or on anatomy changes.

- **AC-STY-014.1** Given the same inputs, When baked twice (and once in Node), Then the position buffers are bit-identical.
- **AC-STY-014.2** Given the default character plus 2 props (8 parts), When `weight` changes, Then the bake completes in ≤ 50 ms (p95 of 20 runs) on the reference machine (CI: Chromium with 4× CPU throttling, spec 000 open question).
- **AC-STY-014.3** Given a 10 s preview playback and a `head` slider drag, When the bake function is spied, Then it is called 0 times.

**REQ-STY-015 [P1]** THE SYSTEM SHALL displace every equipped skinned part other than the body by the REQ-STY-012 rule using the body's `R(b)`, scaled by `(1 + μ)` where `d > 0` and by `(1 − μ)` where `d < 0`, with the margin `μ = CompositionTable.outfitMargin` (0.10), so clothing that sits outside the body at rest stays outside it.

- **AC-STY-015.1** Given a fixture body cylinder of radius 0.100 m and a shirt cylinder of radius 0.105 m with the same skin weights, When baked for every `W`, `M` in {−1, −0.5, 0, 0.5, 1}, Then every shirt vertex is at least 0.005 m (− 1e-6 m) farther from the axis than the body vertex at the same height and angle.

**REQ-STY-016 [P2]** THE SYSTEM SHALL enforce the coupled proportion limits listed as data (`CompositionTable.limits`) on the composition-driven delta only: each limit is an inequality whose sides are a constant plus terms `coef · max(x…)`, where every `x` is `weight`, `muscle`, the constant `0` or a delta `Δp` of an anatomy parameter `p`, and `Δp = max over the joints b in CompositionTable.deltaRegions[p] of (fat[b] · W + muscle[b] · M)` with the quantized `W`, `M` of REQ-STY-017 and the girth table of REQ-STY-012; no limit reads an absolute anatomy value or a style or anatomy preset value. WHEN an edit of `weight` or `muscle` would violate a limit THE SYSTEM SHALL clamp the edited value to the nearest value on the control's step grid (0.25, REQ-STY-011) that satisfies every limit and announce the limit in a polite live region; edits of the nine anatomy values and applied presets are never clamped by these limits, and values loaded from a file are not changed. *(Amended 2026-10-09, PM decision: was "inequalities … over the nine anatomy values, `weight` and `muscle`; WHEN an edit would violate a limit THE SYSTEM SHALL clamp the edited value to the nearest value (0.01 grid)". Limiting only the delta removes the conflict with the REQ-ANA-001 range and the shipped `chibi` preset.)*

PM examples (2026-10-09), restated on the delta: `Δ limbThickness ≤ 0.4 · max(weight, muscle, 0)` and `Δ torsoWidth ≥ 0.9 · Δ limbThickness`. Initial `deltaRegions` (data, tuning target): `limbThickness` → `upperarm_l`, `upperarm_r`, `thigh_l`, `thigh_r`, `calf_l`, `calf_r`; `torsoWidth` → `spine_01`, `spine_02`, `spine_03`, `pelvis`. [NEEDS CLARIFICATION: the exact limit constants stay open for M3.5 tuning. With the initial girth table, the second example fails for every `muscle` > 0 at `weight` 0 (Δ torsoWidth 0.25·M < 0.9 × 0.30·M) and for every `weight` < 0, so it would block those values; the constants, the regions or the example must change. Owner: PM with graphics-engineer. Blocks the shipped limit constants only, not the mechanism (AC-STY-016.3..5 use fixture limits).]

- **~~AC-STY-016.1~~** ~~Given the fixture limit `limbThickness ≤ 1 + 0.4 · max(weight, muscle)` with `weight = 0.5`, `muscle = 0`, `limbThickness = 1.20`, When the user sets `limbThickness` to 1.30, Then it is stored as 1.20 and the live region names the limit.~~ (deprecated 2026-10-09: limits no longer clamp anatomy values, PM decision; replaced by AC-STY-016.4 and AC-STY-016.5)
- **~~AC-STY-016.2~~** ~~Given the same state, When the user lowers `weight` to 0, Then `weight` is stored as 0.50.~~ (deprecated 2026-10-09: depended on the absolute-value limit of AC-STY-016.1; replaced by AC-STY-016.4)
- **AC-STY-016.3** Given a loaded file that violates a limit, When it opens, Then its values are unchanged and a non-blocking hint names the limit.
- **AC-STY-016.4** Given a fixture `CompositionTable` whose only non-zero girth entries are `upperarm_l` and `upperarm_r` (`fat` 0.15, `muscle` 0.30), `deltaRegions.limbThickness = ['upperarm_l', 'upperarm_r']`, the fixture limit `Δ limbThickness ≤ 0.20`, and `weight = 0`, `muscle = 0`, When the user sets Muscle to 1.00, Then `muscle` is stored as 0.50 (Δ 0.15; 0.75 would give 0.225) and the live region names the limit. *(Added 2026-10-09.)*
- **AC-STY-016.5** Given the fixture limit `Δ limbThickness ≤ 0.4 · max(weight, muscle, 0)`, `style: 'chibi'` and `weight = muscle = 0`, When the `chibi` anatomy preset is applied (`limbThickness` 1.40, `torsoWidth` 1.10) and the user then sets `limbThickness` to 1.75, Then both values are stored as set and no limit is announced. *(Added 2026-10-09.)*

**REQ-STY-017 [P2]** THE SYSTEM SHALL quantize `weight` and `muscle` for the bake to multiples of `CompositionTable.step` (0.25, i.e. 9 steps from −1 to 1), rounding half away from zero, and with the shipped table every step SHALL change the rendered silhouette.

- **AC-STY-017.1** Given `weight = 0.37`, When the bake input is computed, Then `W = 0.25`; Given `0.38`, Then `W = 0.50`; Given `−0.38`, Then `W = −0.50`.
- **AC-STY-017.2** Given the default character at 64 px, the three-quarter camera, direction `s`, `idle` frame 0 and `muscle = 0`, When each pair of adjacent `weight` steps is rendered, Then the two alpha masks differ in at least 1 pixel; the same holds for `muscle` steps with `weight = 0`. (Initial tuning target, checked at the M3.5 golden review.)

### Animal species

**REQ-STY-018 [P1]** WHERE `species` is `animal` or `monster` THE SYSTEM SHALL let the user equip a species head part in slot `species-head` (static, socket `head`), and every such part's manifest entry SHALL list the body regions `head` and `hair` in `hides` and the slots `eyebrows`, `beard` and `face` in `alsoOccupies`; manifest validation SHALL fail for a `species-head` part that does not.

- **AC-STY-018.1** Given an `animal` character with hair and eyebrows, When a fox head is equipped, Then no body pixel of region `head` is drawn, the hair is not drawn but `parts.hair` is kept (spec 001 REQ-CMP-012), the `eyebrows` slot shows "occupied by Fox head", and the head part's world position is the head joint's plus the authored offset (± 1e-6 m).
- **AC-STY-018.2** Given `head = 1.5`, When rendered, Then the fox head's world scale is 1.5 (spec 002 AC-ANA-007.2).
- **AC-STY-018.3** Given a pack config whose `species-head` part lacks `hides: ['head', …]`, When validated, Then validation fails naming the part ID and `hides`.

**REQ-STY-019 [P1]** THE SYSTEM SHALL add the socket ID `tail`, resolved through `RigDefinition.socketBones.tail` (joint `pelvis` in the Quaternius rig), and the slot `tail`, which holds one static or procedural part attached to socket `tail`.

- **AC-STY-019.1** Given the committed rig with `socketBones.tail = 'pelvis'`, When validated, Then it passes; Given the rig without `tail`, Then validation fails naming `socketBones.tail` (spec 002 REQ-ANA-019).
- **AC-STY-019.2** Given a rigid tail part with an authored offset, When equipped, Then its root's world position equals the `pelvis` joint's plus the offset (± 1e-6 m) in every sampled frame of `walk`.

**REQ-STY-020 [P1]** WHERE a tail part is a chain of 3 to 5 segments THE SYSTEM SHALL rotate segment k (k = 0 at the root) about its data sway axis by `θ_k(t) = A · a_k · sin(2π · f' · t − k · φ)`, where `t` is the clip time of the sampled frame (`frame / fps`, spec 004 REQ-ANM-007), `A`, `f`, `φ` and the gains `a_k` are part data, and `f' = max(1, round(f · D)) / D` for a looping clip of duration `D` (else `f' = f`); THE SYSTEM SHALL NOT use physics, wall-clock time or randomness for tails. A 1-segment (rigid) tail does not sway.

- **AC-STY-020.1** Given a 4-segment tail and the same frame sampled twice, When the segment rotations are compared, Then they are bit-identical.
- **AC-STY-020.2** Given a looping clip with `D = 1.0 s` and `f = 1.3 Hz`, When `θ_k` is evaluated at `t = 0` and `t = D`, Then `f' = 1 Hz` and the two values are equal (± 1e-9 rad) for every k.
- **AC-STY-020.3** Given the tail module sources, When statically checked, Then they contain no `Math.random`, `Date.now` or `performance.now`.

**REQ-STY-021 [P2]** WHERE `species` is `animal` THE SYSTEM SHALL offer procedural ear parts in slot `ears` (socket `head`), generated from data parameters (`shape`: `pointed`, `round` or `floppy`; `length`, `width`, `tiltDeg`), rigid on the socket and deterministic for the same parameters.

- **AC-STY-021.1** Given the same ear parameters, When generated twice, Then the vertex buffers have the same SHA-256.
- **AC-STY-021.2** Given a new ear part entry added to a pack config (no code change), When the app builds, Then it is listed in the `ears` slot.

**REQ-STY-022 [P2]** WHERE `species` is `animal` THE SYSTEM SHALL offer procedural paw (mitten) parts in slot `hands`: one rigid rounded box per hand pinned to `hand_l` and `hand_r`, with `hides: ['hands']`, so finger joints are not drawn.

- **AC-STY-022.1** Given a mitten part equipped and `walk` frame 3, When rendered, Then no body pixel of region `hands` is drawn and each mitten's world transform equals its hand joint's times the authored offset (± 1e-6 m).
- **AC-STY-022.2** Given `hands = 1.5`, When rendered, Then each mitten's world scale is 1.5 (± 1e-4).

**REQ-STY-023 [P2]** WHERE `species` is `animal` THE SYSTEM SHALL color fur only through tint slots and the toon ramp (spec 003): every bundled animal head, ear, tail and paw part maps its fur material to tint slot `skin` (markings may use `secondary`), so one `skin` color recolors body skin and fur together.

- **AC-STY-023.1** Given an animal character with head, ears, tail and paws, When `skin` is set to `#aa5500`, Then the unlit base color of every fur material and of the body skin is the texel × `#aa5500` rule of spec 001 REQ-CMP-014.
- **AC-STY-023.2** Given the built manifests, When `assets:check` runs, Then every part with `species: ['animal']` has at least one `tintSlots` entry with `slot: 'skin'`, else it fails naming the part.

**REQ-STY-024 [P1]** THE SYSTEM SHALL build animal head parts at asset-build time (spec 011 `assets:build`) by cutting the head of a CC0 Quaternius animal model at a cut plane given in `pack.config.json`, producing a static glTF part for slot `species-head` with `species: ['animal']`, at most 3,000 triangles (initial budget, adjustable in spec 011 budgets), and the license `CC0-1.0`, author `Quaternius` and source URL recorded in the pack config (spec 000 REQ-GEN-008, spec 011).

~~Sources: Quaternius "LowPoly Animated Animals" (CC0; FBX, OBJ and Blend only, so converted with Blender per spec 011 REQ-AST-002) and, if the PM agrees, Quaternius "Ultimate Animated Animals" (CC0, glTF included). See Open questions.~~ Source (PM decision 2026-10-09): Quaternius "Ultimate Animated Animals" (CC0, glTF included) is the preferred source of animal heads. "LowPoly Animated Animals" (CC0; FBX, OBJ and Blend only, Blender conversion per spec 011 REQ-AST-002) is not used unless a needed animal is missing from the preferred pack, which needs a new PM decision.

- **AC-STY-024.1** Given a fixture animal glTF and a cut-plane config, When `assets:build` runs, Then the output mesh has no vertex on the body side of the plane (± 1e-5 m), at most 3,000 triangles, and a byte-identical result on a second run.
- **AC-STY-024.2** Given an animal-head entry without `license`, `author` or `sourceUrl`, When validated, Then validation fails naming the entry and the field (AC-GEN-008.1).

### Monster species

**REQ-STY-025 [P1]** WHERE `species` is `monster` THE SYSTEM SHALL keep the humanoid body and offer procedural horns (slot `horns`, socket `head`), procedural spikes (slot `back`, socket `spine_03`) and tails (slot `tail`, REQ-STY-019/020), each generated from data parameters, deterministically and without randomness.

- **AC-STY-025.1** Given the same horn or spike parameters, When generated twice, Then the vertex buffers have the same SHA-256.
- **AC-STY-025.2** Given `head = 1.5` and horns equipped, When rendered, Then the horns' world scale is 1.5 (± 1e-4).

**REQ-STY-026 [P2]** WHERE `species` is `monster` THE SYSTEM SHALL offer a data-driven swatch set `monster-skin` of at least 8 colors in the `skin` tint picker, next to the sets of spec 001 REQ-CMP-016, and randomize with tints unlocked SHALL pick `skin` from it.

- **AC-STY-026.1** Given a `monster` character, When the `skin` picker opens, Then the `monster-skin` set shows at least 8 swatches with accessible names that include their hex value.
- **AC-STY-026.2** Given a `monster` character with tints unlocked, When randomize runs for seeds 0–999, Then every `skin` value is in `monster-skin`.

**REQ-STY-027 [P1]** THE SYSTEM SHALL build monster head parts at asset-build time from Quaternius "Ultimate Monsters" (CC0 1.0, <https://quaternius.com/packs/ultimatemonsters.html>) by the REQ-STY-024 method, with `species: ['monster']`.

- **AC-STY-027.1** Given the built monster pack, When `assets:check` runs, Then every head entry has license `CC0-1.0`, author `Quaternius`, the source URL above and `species: ['monster']`, and `pnpm assets:licenses` lists the pack.

**REQ-STY-028 [P1]** THE SYSTEM SHALL NOT bundle assets from packs under the Quaternius Asset License (QAL v1.0, which forbids redistributing the raw assets), including Quaternius "Bestiary"; the pack validation of spec 011 SHALL fail with `STY_LICENSE_EXCLUDED` for a pack config whose source URL or title matches an entry of the excluded-sources list (`tools/packs/excluded-sources.json`, data), unless an accepted ADR lifts the exclusion for that pack. This adds to, and does not replace, the bundled-license allowlist of REQ-GEN-008 and spec 011.

- **AC-STY-028.1** Given a fixture pack config with title "Bestiary" (or a source URL on the excluded list) and license recorded as `CC0-1.0`, When `assets:build` or `assets:check` runs, Then it fails with `STY_LICENSE_EXCLUDED` naming the pack and the matched entry.
- **AC-STY-028.2** Given the shipped excluded-sources list, When read, Then it contains an entry for Quaternius "Bestiary" with the reason "Quaternius Asset License v1.0: raw asset redistribution not allowed".

### Gating, slots and procedural parts

**REQ-STY-029 [P1]** THE SYSTEM SHALL add a (`style`, `species`) pair to `SUPPORTED_STYLE_COMBOS` only when every P1 AC of the pair's governing requirements (table below) has a passing test, and ~~until then the pair SHALL show "Coming soon"~~ a style or species option SHALL show "Coming soon" (disabled) in the composer (spec 001 REQ-CMP-045) and in the style and species steps of the spec 014 new-character wizard (REQ-UX-092) until BOTH its pair is in `SUPPORTED_STYLE_COMBOS` AND the loaded packs provide the pair's required content (the one gating rule of spec 001 REQ-CMP-045); the Weight and Muscle sliders likewise show "Coming soon" (disabled) until REQ-STY-011..015 pass. *(Amended 2026-10-09, PM gating decision: the enable condition adds the content check; wizard reference moved from spec 009 to spec 014.)*

| Pair | Governing requirements |
|------|------------------------|
| `stickman`/`human` | REQ-STY-002..005, 010, 032, 033 |
| `voxel`/`human` | REQ-STY-006..008, 010, 032, 033 |
| `realistic`/`animal`, `chibi`/`animal` | REQ-STY-018..020, 024, 030, 031, 032, 033 |
| `realistic`/`monster`, `chibi`/`monster` | REQ-STY-018..020, 025, 027, 028, 030, 031, 032, 033 |

- **AC-STY-029.1** Given the generated traceability matrix (`pnpm spec:trace`) and the gating table as data, When the gating unit test runs, Then every pair in `SUPPORTED_STYLE_COMBOS` other than `realistic`/`human` and `chibi`/`human` has a passing test for each P1 AC of its governing requirements, and the test fails otherwise.
- **AC-STY-029.2** Given a build where `stickman`/`human` is not yet in the list, When the wizard's style step renders, Then Stickman shows "Coming soon" and cannot be chosen (spec 001 AC-CMP-045.1 behavior).

**REQ-STY-030 [P1]** THE SYSTEM SHALL append the slots `species-head`, `ears`, `horns` and `tail` to the slot registry, after `prop-off-hand` and in that order, and SHALL add `procedural` to the kinds of the existing slots `hands` (paws, REQ-STY-022) and `back` (spikes, REQ-STY-025), as data (spec 001 REQ-CMP-001, P-11).

| Slot | Kinds | Socket | `emptyChance` |
|------|-------|--------|---------------|
| `species-head` | static | `head` | 0.3 |
| `ears` | static, procedural | `head` | 0.5 |
| `horns` | static, procedural | `head` | 0.5 |
| `tail` | static, procedural | `tail` | 0.5 |

- **AC-STY-030.1** Given the M3.5 slot registry, When validated, Then it lists 19 slot IDs ending in `prop-off-hand`, `species-head`, `ears`, `horns`, `tail`.
- **AC-STY-030.2** Given a `human` character and the bundled packs (whose parts for these slots all declare `species` without `human`), When randomize runs for seeds 0–999, Then these four slots are always empty.
- **AC-STY-030.3** Given the M3.5 slot registry, When the `hands` and `back` entries are read, Then their `kinds` include `procedural` and their other fields are unchanged from M3.

**REQ-STY-031 [P1]** THE SYSTEM SHALL accept parts of `kind: 'procedural'` in part manifests, each with a `generator` (`type` as `<name>@<version>`, e.g. `horns@1`, and `params`) instead of `file` and `sha256`, and IF a manifest names a generator type the engine does not know THEN THE SYSTEM SHALL list that part as unavailable with `STY_GENERATOR_UNKNOWN` and keep the rest of the manifest usable.

- **AC-STY-031.1** Given a manifest with a `horns@1` part, When validated and equipped, Then it renders with no file request.
- **AC-STY-031.2** Given a part with generator `horns@9`, When the manifest loads, Then the part is shown disabled with `STY_GENERATOR_UNKNOWN`, and the other parts load.
- **AC-STY-031.3** Given a procedural part without `license`, `author` or `sourceUrl`, When validated, Then validation fails (REQ-GEN-008).
- **AC-STY-031.4** Given the bundled procedural parts, When `assets:check` runs, Then every one records license `CC0-1.0`, author "Character Sprite Generator contributors" and the project repository URL as `sourceUrl`, and `pnpm assets:licenses` lists them. *(Added 2026-10-09, PM decision.)*

Licence record (PM decision 2026-10-09): procedural parts made by this project (generators and their parameter data) are recorded as `CC0-1.0`, authored by the project contributors ("Character Sprite Generator contributors"), with the project repository as the source URL. This is within the bundled-licence allowlist of spec 011.

### Quality gates

**REQ-STY-032 [P1]** THE SYSTEM SHALL keep golden images, per backend (WebGPU and WebGL2) and at tolerance 0 (ADR-0009), for at least: `stickman`/`human`, `voxel`/`human`, `realistic`/`animal` (head, ears, tail, paws), `realistic`/`monster` (head, horns, spikes, tail), `chibi`/`animal`, and `realistic`/`human` with `composition` `{ weight: 1, muscle: 0 }` and `{ weight: −1, muscle: 1 }`, each at 64 px, three-quarter camera, directions `s` and `e`, `idle` frame 0 and `walk` frame 3.

- **AC-STY-032.1** Given each listed case, When rendered on each backend, Then the output equals its golden with 0 differing pixels.
- **AC-STY-032.2** Given the golden directory, When listed, Then every listed case has one image per backend, direction and frame (8 cases × 2 × 2 × 2 = 64 images).

**REQ-STY-033 [P1]** WHILE any pair of `SUPPORTED_STYLE_COMBOS` is active THE SYSTEM SHALL keep the live preview at p95 frame time ≤ 16.7 ms at 64 px with 8 equipped parts (props and procedural parts count) and the default pipeline (P-07), and the 64 px, 8-direction, 4-clip, 8-frame export at ≤ 10 s.

- **AC-STY-033.1** Given each supported pair with 8 equipped parts, When the preview runs for 10 s under the REQ-GEN-007 setup, Then p95 frame time ≤ 16.7 ms.
- **AC-STY-033.2** Given `stickman`/`human` and `voxel`/`human`, When the P-07 export runs, Then it completes in ≤ 10 s.

**REQ-STY-034 [P1]** THE SYSTEM SHALL render stickman, voxel and procedural part geometry through the same pipeline as other parts (spec 003): toon material, part-ID output for outlines, palette and dither, texel snapping, and `hides`; and SHALL list in `CREDITS.txt` (spec 005) every bundled animal or monster head used in the export.

- **AC-STY-034.1** Given `voxel`/`human` with an outline enabled, When rendered, Then outline pixels appear along the silhouette as for a skinned part, and the voxel geometry writes a non-zero part ID in the part-ID output.
- **AC-STY-034.2** Given an export of a `realistic`/`monster` character with a monster head, When `CREDITS.txt` is read, Then it lists "Ultimate Monsters" by Quaternius, CC0-1.0, with the source URL.

## Edge cases

- Unsupported pair (e.g. `stickman`/`animal`) → spec 001 fallback and "Coming soon" (REQ-STY-001, AC-STY-001.2; spec 001 REQ-CMP-043).
- Stickman or voxel at 32 px → capsule floor of 1 px (REQ-STY-004); voxel cross-sections of 4u may still be under 2 px; the spec 002 readability hint applies.
- Clips with translation tracks on non-root joints → capsules follow joint positions (REQ-STY-003); voxel boxes follow bone transforms (REQ-STY-007).
- Outfit equipped in stickman or voxel → kept, not drawn, back instantly on style change (REQ-STY-010).
- Composition with morph targets → the bake changes base positions; morph deltas apply on top (spec 002 REQ-ANA-012).
- Composition on thin bones or extreme inputs → clamp to 40 % of the radius (REQ-STY-013); no inverted geometry.
- Outfit with different skin weights than the body near a seam → margin μ (REQ-STY-015); residual clipping in hidden regions is covered by `hides`.
- Coupled limits on a loaded file → values kept, hint shown (AC-STY-016.3).
- Hat on an animal head → allowed; it may float or clip (no fitting); `headwear` is not in `alsoOccupies` (REQ-STY-018).
- Spikes and a cape both want the `back` slot → one part per slot (spec 001 NG2); the latest choice wins.
- Tail with a robe → possible clipping; tails are not hidden by robes.
- Non-looping clip → tail frequency is not adjusted (REQ-STY-020).
- Pack with an unknown generator → part unavailable, manifest usable (REQ-STY-031).
- WebGL2 fallback → all goldens per backend (REQ-STY-032).

## Data & contracts

Canonical schemas live in `@csg/parts-schema` (Zod). Extensions of spec 001 `PartEntry` and spec 002 `StyleDefinition` are optional fields within the same format versions.

```ts
/** Extends spec 002 StyleDefinition (presets/styles/<style>.json). */
export interface StickmanStyleData {
  /** Joint pairs [from, to]; `to` is a descendant of `from`. Initial list: 19 segments below. */
  segments: Array<[JointName, JointName]>;
  /** Radius in metres per segment index; arm and leg segments scale with limbThickness. */
  radius: number[];
  headCenter: [number, number, number]; // offset from the head joint, metres
  headRadius: number;                    // metres, scaled by `head`
  tintSlot: TintSlot;                    // default 'skin'
}

export interface VoxelBox {
  id: 'head' | 'body' | `${'upper' | 'lower'}-${'arm' | 'leg'}-${'l' | 'r'}`;
  bone: JointName;                       // pinned joint (REQ-STY-007)
  from: JointName;                       // span start
  /** Span end; 'ground' = lower face at y = 0 at rest; null for the head cube (REQ-STY-006). */
  to: JointName | 'ground' | null;
  size: [number, number, number];        // nominal skin pixels w, h, d
  uv: [number, number];                  // atlas origin (u0, v0), pixels
}

export interface VoxelStyleData {
  boxes: VoxelBox[];                     // exactly 10
  template: { legend: Record<string, TintSlot | 'transparent'>; rows: string[] }; // 64 rows × 64 chars
}

/** presets/composition.json */
export interface CompositionTable {
  format: 'sprite-composition';
  version: 1;
  step: number;                          // 0.25
  clampRatio: number;                    // 0.40
  outfitMargin: number;                  // 0.10
  girth: Record<JointName, { fat: number; muscle: number }>;
  /** Added 2026-10-09 (REQ-STY-016 amendment). Joints whose girth defines Δp for each limited parameter. */
  deltaRegions: Partial<Record<keyof AnatomyParams, JointName[]>>;
  /** Amended 2026-10-09: operands are composition deltas, weight, muscle or 0, never absolute anatomy values. */
  limits: Array<{
    param: LimitOperand;
    op: '<=' | '>=';
    constant: number;
    terms: Array<{ coef: number; max: Array<LimitOperand | 0> }>;
  }>;
}

/** `delta:<param>` is Δp of REQ-STY-016. */
export type LimitOperand = `delta:${keyof AnatomyParams}` | 'weight' | 'muscle';

/** Spec 001 PartEntry additions (M3.5). */
export interface ProceduralPartFields {
  kind: 'procedural';
  generator: { type: `${string}@${number}`; params: Record<string, number | string | boolean> };
  tail?: { axis: [number, number, number]; amplitudeDeg: number; frequencyHz: number;
           phaseStepRad: number; gains: number[] }; // gains.length = segment count, 1 or 3..5
}

export type StyleErrorCode = 'STY_LICENSE_EXCLUDED' | 'STY_GENERATOR_UNKNOWN';
```

Initial stickman segments (Quaternius rig): `pelvis→spine_01`, `spine_01→spine_02`, `spine_02→spine_03`, `spine_03→neck_01`, `neck_01→Head`, and per side `clavicle→upperarm`, `upperarm→lowerarm`, `lowerarm→hand`, `pelvis→thigh`, `thigh→calf`, `calf→foot`, `foot→ball` (5 + 2 × 7 = 19).

Voxel box-UV layout. A box of nominal size w × h × d at origin (u0, v0) uses a (2d + 2w) × (d + h) region: top (u0 + d, v0, w × d), bottom (u0 + d + w, v0, w × d), right (u0, v0 + d, d × h), front (u0 + d, v0 + d, w × h), left (u0 + d + w, v0 + d, d × h), back (u0 + 2d + w, v0 + d, w × h). Origins: head (0, 0); body (32, 0); upper-arm-r (0, 16), lower-arm-r (16, 16), upper-arm-l (32, 16), lower-arm-l (48, 16); upper-leg-r (0, 26), lower-leg-r (16, 26), upper-leg-l (32, 26), lower-leg-l (48, 26). Rows 36–63 are reserved and transparent. Limb boxes stretch their 6-pixel face along the actual box length.

Initial girth table (tuning targets, data):

| Region | Joints | fat | muscle |
|--------|--------|-----|--------|
| belly | `spine_01`, `spine_02` | 0.35 | 0.05 |
| chest | `spine_03` | 0.15 | 0.25 |
| hips | `pelvis` | 0.30 | 0.05 |
| upper arm | `upperarm_l`, `upperarm_r` | 0.15 | 0.30 |
| thigh | `thigh_l`, `thigh_r` | 0.30 | 0.15 |
| calf | `calf_l`, `calf_r` | 0.10 | 0.25 |

Error codes: `STY_LICENSE_EXCLUDED` (REQ-STY-028), `STY_GENERATOR_UNKNOWN` (REQ-STY-031). Spec 001 owns `CMP_STYLE_UNSUPPORTED`.

## Non-functional

- NFR-1 (P-04): bakes, atlases, procedural meshes and tail sway are pure functions of the `CharacterSpec`, data files and clip time; no wall clock or unseeded randomness.
- NFR-2 (P-07): REQ-STY-014 (bake ≤ 50 ms) and REQ-STY-033 (≥ 60 fps, export ≤ 10 s).
- NFR-3 (P-05): voxel atlas nearest-filtered with no mipmaps; stickman lines ≥ 1 px; the texel snapping of spec 003 applies unchanged.
- NFR-4 (P-02): every bundled head is CC0 with author and source; QAL packs are excluded (REQ-STY-028).
- NFR-5 (P-06): Weight and Muscle sliders follow spec 002 REQ-ANA-017 keyboard rules; "Coming soon" is text, not color alone.
- NFR-6 (P-10): stickman, voxel, composition and tail math live in DOM-free engine modules, unit-testable in Node.

## Open questions

- [NEEDS CLARIFICATION: coupled-limit constants (REQ-STY-016). ~~They conflict with REQ-ANA-001 and the `chibi` preset as written.~~ Updated 2026-10-09 (PM): the limits now apply only to the composition-driven delta, so they no longer conflict with REQ-ANA-001 or the `chibi` preset; the exact constants (and the second PM example, which the initial girth table violates) stay open for M3.5 tuning. Owner: PM with graphics-engineer. Blocks the shipped limit data only.]
- ~~[NEEDS CLARIFICATION: animal source pack. "LowPoly Animated Animals" lists farm animals (cow, horse, llama, pig, pug) and ships FBX/OBJ/Blend only (Blender conversion, REQ-AST-002); "Ultimate Animated Animals" (12 animals, CC0) includes glTF. Use one or both? Owner: PM with asset-pipeline-engineer, before M3.5 asset work.]~~ Resolved 2026-10-09 (PM): prefer Quaternius "Ultimate Animated Animals" (CC0, glTF) over "LowPoly Animated Animals" (REQ-STY-024).
- ~~[NEEDS CLARIFICATION: license record for procedural parts (REQ-STY-031). Bundled licenses must be `CC0-1.0` or `CC-BY-4.0` (spec 011). Proposal: `CC0-1.0`, author "Character Sprite Generator contributors", source URL the repository. Owner: maintainers.]~~ Resolved 2026-10-09 (PM): `CC0-1.0`, authored by the project contributors ("Character Sprite Generator contributors"), source URL the repository (REQ-STY-031, AC-STY-031.4).
- [NEEDS CLARIFICATION: should `stickman` and `voxel` support `animal`/`monster` later (e.g. a box head, a line tail)? M3.5 renders them as `human` with the fallback notice (AC-STY-001.2). Owner: PM. Not blocking.]
- Resolved 2026-10-09 (PM): one gating rule. A wizard or editor style/species option is enabled only when its pair is in `SUPPORTED_STYLE_COMBOS` AND the required content is in the loaded packs (spec 001 REQ-CMP-045 amended; spec 014 REQ-UX-092 and REQ-STY-029 refer to it). Original question: ~~[NEEDS CLARIFICATION: gating source. Spec 009 REQ-UX-092 enables a wizard option "without code changes once a pack provides the content". This spec and spec 001 REQ-CMP-045 gate on the engine's `SUPPORTED_STYLE_COMBOS`, because stickman, voxel, tails and composition need engine code, not only pack data. Proposal: an option is enabled when its pair is in `SUPPORTED_STYLE_COMBOS` and, for species heads, at least one compatible part is loaded. Owner: spec 009 owner with the PM, to align before M3 ends. Not blocking M3: both rules disable Stickman, Voxel, Animal and Monster in M3.]~~
- The voxel tint legend (shirt → `primary`, pants → `secondary`, shoes → `leather`) maps the PM's color roles to the existing 7 tint slots; no new tint slot is added. Confirm at the M3.5 review.
- The Quaternius Asset License terms for "Bestiary" are recorded from the PM decision of 2026-10-09; the license page could not be retrieved on that date (404). Add its URL to the excluded-sources entry once confirmed.

## References

- PM decision 2026-10-09 (STY): styles, species, composition, M3.5
- PM decisions 2026-10-09 (gating rule, procedural-part licence, animal source pack, delta-only coupled limits), relayed by the coordinator
- Specs 001 (REQ-CMP-038..049), 002 (REQ-ANA-013, 022..027, NG2), 003, 004 (REQ-ANM-007), 005, 009, 011 (REQ-AST-002, AST-017); spec 000 REQ-GEN-007, REQ-GEN-008
- ADR-0001, ADR-0003, ADR-0008, ADR-0009
- Quaternius, LowPoly Animated Animals (CC0): https://quaternius.itch.io/lowpoly-animated-animals (accessed 2026-10-09)
- Quaternius, Ultimate Animated Animals (CC0, glTF): https://quaternius.com/packs/ultimateanimatedanimals.html (accessed 2026-10-09)
- Quaternius, Ultimate Monsters (CC0, 50 models, glTF): https://quaternius.com/packs/ultimatemonsters.html (accessed 2026-10-09)
- Creative Commons Zero 1.0: https://creativecommons.org/publicdomain/zero/1.0/
- Box-UV unwrap convention for block characters (community skin-layout documentation; style reference only)
