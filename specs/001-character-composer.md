---
id: CMP
title: Character composer
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 002-anatomy, 004-animation, 011-asset-pipeline]
last_updated: 2026-10-09
---

# 001 – Character composer

## Rules for IDs

`REQ-CMP-NNN` and `AC-CMP-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused. Tests cite AC IDs (constitution P-09).

## Context

The composer is where a user builds a character. They pick a body, fill slots with parts (hair, outfit pieces, props), mix and match across packs, recolor through tint slots, randomize, and save or share the result as a `CharacterSpec`. Every downstream feature (anatomy 002, pixel pipeline 003, animation 004, export 005) reads the `CharacterSpec` this spec defines.

Relevant decisions: ADR-0001 (rigged 3D parts rendered to pixels), ADR-0005 (user uploads appear as `user:<uuid>` refs), `docs/architecture.md` §3.2–3.3 (draft contracts refined here). Bundled sources are the CC0 Quaternius packs (research brief). **Dependency:** skinned parts are rebound by bone name on the assumption that every bundled pack shares one skeleton. That assumption is unverified until the M1 asset spike (`tools/verify-rig.ts`, spec 011) reports. Requirements marked *(M1-gated)* may change after the spike. *(Amended 2026-10-09 (M1-33): the spike reported `mapped` (spec 011 REQ-AST-007, ADR-0008): one shared rig with several skeleton groups; REQ-CMP-008 and REQ-CMP-037 are final for M1.)*

*(Amended 2026-10-09 (STY), PM decision.)* `CharacterSpec` moves to **version 2**: it gains a body `style` (`realistic`, `chibi`, `stickman`, `voxel`), a `species` (`human`, `animal`, `monster`) and an optional body `composition` (`weight`, `muscle`). The schema accepts every value from M3 on, but M3 renders only `realistic`/`human` and `chibi`/`human`; the other values show "Coming soon" (REQ-CMP-038..049). Rendering of the other styles, species and body composition is specified in spec 013 (milestone M3.5).

## Goals

- G1: Build a complete character from data-driven slots and parts in under a minute, without art skills.
- G2: Never produce an invalid or visibly broken combination silently: incompatible parts are explained, and clipping is reduced by `hides`.
- G3: Reproducible characters: the same `CharacterSpec` (including the randomize seed) always yields the same character (P-04).
- G4: Characters can be shared as a file or a URL with no server (P-03).

## Non-goals

- NG1: Mesh editing, weight painting or per-vertex fitting of outfits to bodies (point users to Blender). *(Note 2026-10-09 (STY): the procedural body-composition inflation of spec 013, which moves body and outfit vertices along their normals in M3.5, is not "per-vertex fitting" in this sense: it is computed, not authored, and needs no per-part data. This non-goal still excludes manual fitting tools.)*
- NG2: Layering several parts in one slot (one part per slot; use another slot or a combined part).
- NG3: The global undo stack, panel layout and shortcut registry. These belong to spec 009 (UX); this spec only defines what one composer command is.
- NG4: Uploading parts (spec 008). This spec only treats user parts as `user:` refs in the registry.
- NG5: Proportion controls (spec 002) and clip selection (spec 004).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to pick a body and click parts into slots | I get a game character fast |
| US-2 | P1 | indie game dev | to recolor skin, hair and outfit | my characters match my game's palette |
| US-3 | P1 | indie game dev | to save and reload a character as a file | I can regenerate sprites later |
| US-4 | P2 | indie game dev | to randomize with some slots locked | I can generate NPC variations quickly |
| US-5 | P2 | pixel artist | to share a character by URL | collaborators open exactly the same character |
| US-6 | P2 | modder | to add parts and slots as data | I contribute without engine code (P-11) |
| US-7 | P2 | any user | to search and filter a large part list | I find the part I want among hundreds |

## Requirements

### Slots

**REQ-CMP-001 [P1]** THE SYSTEM SHALL define slots in a data file (the slot registry, `SlotDefinition[]`, see Data & contracts) validated by `@csg/parts-schema`, and the v1 registry SHALL contain exactly these slots in this display order: `body`, `hair`, `eyebrows`, `beard`, `face`, `headwear`, `torso`, `arms`, `hands`, `legs`, `feet`, `back`, `accessory`, `prop-main-hand`, `prop-off-hand`.

- **AC-CMP-001.1** Given the v1 slot registry, When it is validated, Then it parses and lists the 15 slot IDs above in that order.
- **AC-CMP-001.2** Given a slot registry with a duplicate slot ID or an ID outside `[a-z0-9-]{1,32}`, When it is validated, Then validation fails naming the offending ID.
- **AC-CMP-001.3** Given a registry that adds a 16th slot `wings` (data only, no code change), When the composer loads, Then a `wings` slot appears in the slot list and accepts parts whose `slot` is `wings`.

*(Note 2026-10-09 (STY).)* The 15-slot list above is the M3 registry and AC-CMP-001.1 checks it. In M3.5 spec 013 REQ-STY-030 appends the slots `species-head`, `ears`, `horns` and `tail` as data, after `prop-off-hand`, and adds the part kind `procedural` (REQ-STY-031) to `hands` and `back`. That change amends this requirement's list at M3.5 and AC-CMP-001.1 then expects 19 IDs.

**REQ-CMP-002 [P1]** THE SYSTEM SHALL require the `body` slot to always hold exactly one part, and SHALL allow every other slot to be empty.

- **AC-CMP-002.1** Given any composer state, When the user tries to clear the `body` slot, Then the clear control is disabled and the body stays equipped.
- **AC-CMP-002.2** Given a `CharacterSpec` with no `body`, When it is loaded, Then loading fails with error `CMP_BODY_MISSING` and the current character is unchanged.

**REQ-CMP-003 [P1]** THE SYSTEM SHALL accept a part in a slot only if the part's `slot` equals that slot ID and its `kind` is in the slot's `kinds`.

- **AC-CMP-003.1** Given a `torso` part, When it is assigned to `feet` through the API, Then the API returns `CMP_SLOT_MISMATCH` and the spec is unchanged.
- **AC-CMP-003.2** Given slot `prop-main-hand` with `kinds: ['static']`, When a skinned part declares that slot, Then manifest validation fails naming the part ID.

### Selecting, clearing, mix & match

**REQ-CMP-004 [P1]** WHEN the user selects a part for a slot THE SYSTEM SHALL equip it, replacing any part already in that slot, and update the preview.

- **AC-CMP-004.1** Given cached parts, When the user swaps the `hair` part, Then the preview shows the new hair within 150 ms and the old hair is gone (architecture §4.3).
- **AC-CMP-004.2** Given an uncached part, When it is selected, Then a loading indicator shows on the slot and the previous part stays visible until the new part is ready.

**REQ-CMP-005 [P1]** WHEN the user clears a non-body slot THE SYSTEM SHALL remove its part and remove that slot key from `CharacterSpec.parts`.

- **AC-CMP-005.1** Given `headwear` is equipped, When the user activates "Clear" on that slot (pointer or keyboard), Then the hat disappears from the preview and the serialized spec has no `headwear` key.

**REQ-CMP-006 [P1]** THE SYSTEM SHALL allow parts from different packs, and user parts (`user:` refs), to be combined freely in one character, subject only to REQ-CMP-007 and REQ-CMP-008.

- **AC-CMP-006.1** Given a body from pack A and a torso from pack B on the same rig, When both are equipped, Then both render, skinned to the body's skeleton, and play the selected clip together.

**REQ-CMP-007 [P1]** IF a part's `alsoOccupies` lists other slots THEN THE SYSTEM SHALL clear those slots when the part is equipped, and SHALL show those slots as "occupied by <part name>" until the part is removed.

- **AC-CMP-007.1** Given a robe with `slot: 'torso'` and `alsoOccupies: ['legs']` and trousers in `legs`, When the robe is equipped, Then the trousers are removed, the `legs` slot shows "occupied by Robe", and one undo step restores both the previous torso and the trousers.
- **AC-CMP-007.2** Given the robe is equipped, When the user picks trousers for `legs`, Then the robe is unequipped and the trousers are equipped (the latest choice wins).

### Compatibility

**REQ-CMP-008 [P1]** THE SYSTEM SHALL treat a part as compatible with the current body only if all of these hold: (a) for skinned parts, `part.rig` equals the body's rig; (b) `part.bodies` is absent/empty or contains the body's part ID; (c) `part.bodyTypes` is absent/empty or contains the body's `bodyType`. *(M1-gated: (a) assumes one shared rig ID for all bundled packs. M1 result 2026-10-08: names and hierarchy match across all bundled files, so one rig ID holds; bind-pose differences do not affect compatibility and are handled by REQ-CMP-037.)*

- **AC-CMP-008.1** Given body `regular-f` with `bodyType: 'regular'` and an outfit with `bodyTypes: ['superhero']`, When compatibility is computed, Then the outfit is incompatible with reason `body-type`.
- **AC-CMP-008.2** Given a skinned part with `rig: 'other-rig'`, When compatibility is computed against a `quaternius-ue5-65` body, Then it is incompatible with reason `rig`.
- **AC-CMP-008.3** Given a static prop with no `bodies`/`bodyTypes`, When compatibility is computed against any body, Then it is compatible.

*(Clarified 2026-10-09 (M1-33), confirming the M1 implementation and the PM decision of M1-20.)* The three rules are checked in the order (a), (b), (c), and the first failing rule gives the reason: `rig`, `body` or `body-type`. Compatibility does **not** consider skeleton groups (`skeletonGroup`, `characterSkeletonGroup`): a part from another skeleton group of the same rig is compatible, because rebinding (REQ-CMP-037) and retargeting (spec 004 REQ-ANM-023) absorb rest-pose differences. Gender pairing of the bundled outfits (male parts on `superhero-m`, female parts on `superhero-f`) is expressed only through `bodies` (rule b).

- **AC-CMP-008.4** Given body `superhero-m` and the part `male-ranger-torso` restricted with `bodies: ['superhero-m']`, When compatibility is computed against body `superhero-f`, Then it is incompatible with reason `body`; against `superhero-m`, Then it is compatible. *(Added 2026-10-09 (M1-33).)*
- **AC-CMP-008.5** Given a body and a skinned part on the same rig whose `skeletonGroup` values differ (e.g. body `superhero-m` in group `superhero-m` and a part in group `female`), and no `bodies`/`bodyTypes` restriction, When compatibility is computed, Then it is compatible. *(Added 2026-10-09 (M1-33).)*
- **AC-CMP-008.6** Given a skinned part with `rig: 'other-rig'` and `bodies` not containing the body's ID, When compatibility is computed, Then the reason is `rig` (rule (a) is reported first). *(Added 2026-10-09 (M1-33).)*

*(Note 2026-10-09 (STY).)* REQ-CMP-048 adds two more rules, (d) style and (e) species, checked after (a)–(c). Parts that declare neither `styles` nor `species` (every M3 bundled part) are unaffected.

**REQ-CMP-009 [P1]** WHILE "Show incompatible" is off (default) THE SYSTEM SHALL hide incompatible parts in the part picker; WHILE it is on THE SYSTEM SHALL show them disabled with a text reason.

- **AC-CMP-009.1** Given 3 incompatible torsos, When the picker opens with the toggle off, Then they are not listed; When toggled on, Then they are listed, not selectable, and each has an accessible description such as "Fits Superhero bodies only".

**REQ-CMP-010 [P1]** WHEN the user changes the body and some equipped parts become incompatible THE SYSTEM SHALL unequip those parts in the same undoable command and show a non-blocking notice listing them.

- **AC-CMP-010.1** Given a superhero-only chestplate equipped, When the body changes to `teen-m`, Then the chestplate is removed, a notice says "Removed 1 part that does not fit this body: Chestplate", and one undo restores the previous body and the chestplate.

### Hides

**REQ-CMP-011 [P1]** THE SYSTEM SHALL hide every body region listed in the union of the `hides` arrays of all equipped parts, and show every other region.

- **AC-CMP-011.1** Given a torso with `hides: ['torso', 'upper-arms']`, When it is equipped, Then the body's torso and upper-arm regions are not drawn in color or in the part-ID MRT output, and the rest of the body is drawn.
- **AC-CMP-011.2** Given that torso is unequipped, When the preview updates, Then the torso and upper-arm regions are drawn again.

**REQ-CMP-012 [P1]** WHERE a part's `hides` contains `hair` THE SYSTEM SHALL not draw the part equipped in the `hair` slot, while keeping it in the `CharacterSpec`.

- **AC-CMP-012.1** Given hair equipped and a helmet with `hides: ['hair']`, When the helmet is equipped, Then the hair is not drawn and `parts.hair` is still present; When the helmet is removed, Then the hair is drawn again.

### Tints

**REQ-CMP-013 [P1]** THE SYSTEM SHALL keep one color per tint slot (`skin`, `hair`, `eyes`, `primary`, `secondary`, `metal`, `leather`) in `CharacterSpec.tints`, and apply it to every equipped part material mapped to that tint slot.

- **AC-CMP-013.1** Given two equipped parts whose materials map to `primary`, When `primary` is set to `#3a5fcd`, Then both parts update on the next rendered frame without reloading any part.
- **AC-CMP-013.2** Given a material with no tint mapping, When any tint changes, Then that material's pixels are unchanged.

**REQ-CMP-014 [P1]** THE SYSTEM SHALL apply a tint according to the mapping's `mode`: `multiply` (default: ~~texture luminance × tint, preserving texture detail~~ texel RGB × tint per channel, keeping the texel alpha; amended 2026-10-09 (FX-J-spec2)) or `replace` (flat tint color, keeping the texel alpha).

*(Amended 2026-10-09 (FX-J-spec2), PM decision after FX-J.)* **Multiply.** The tinted base color is `texel.rgb × tint.rgb`, per channel in linear RGB, and its alpha is the texel alpha. A white tint (`#ffffff`) therefore gives the authored texture colors unchanged. *(Default tints, amended 2026-10-09 (FX-L): the default `CharacterSpec` uses `#ffffff` (authored colors) for every slot EXCEPT `hair`, which defaults to `#7a4a26`, because the UBC hair texture is neutral grey and authored to be tinted; the eyebrows share the `hair` slot. Values in Data & contracts, REQ-CMP-036.)* Reason: the bundled Ranger outfit textures have a luminance of only about 0.01–0.12, so the previous rule `luminance(texel) × tint` could not produce the bright outfit colors that the user asked for in D2 ("Brighter + punchier", spec 003), while the authored colors already are the requested greens and browns. **Replace** is unchanged: the base RGB is the tint, the alpha is the texel alpha (spec 003 REQ-PIX-023 note). A luminance-based recolor mode (the previous multiply rule, useful for recoloring textures to any hue) is deferred to M3 as a separate mode, `recolor` (Open questions).

- **AC-CMP-014.1** Given a material with a white texel and `mode: 'multiply'`, When the tint is `#808080`, Then the unlit base color of that texel is `#808080` (± 1 per channel before lighting). *(Still valid under the 2026-10-09 (FX-J-spec2) rule: white × tint = tint.)*
- **AC-CMP-014.2** Given `mode: 'replace'`, When the tint is `#ff0000`, Then every texel of that material has unlit base color `#ff0000`. *(Clarified 2026-10-09 (FX-J-spec2): RGB only; the texel alpha is kept, spec 003 AC-PIX-023.4.)*
- **AC-CMP-014.3** Given a material with `mode: 'multiply'` and a texel `#ff8000` with alpha 0.4, When the tint is `#ffffff`, Then the unlit base color of that texel is `#ff8000` with alpha 0.4; When the tint is `#00ff00`, Then it is `#008000` (linear (1, 0.216, 0) × (0, 1, 0), re-encoded to sRGB) with alpha 0.4; When the tint is `#808080`, Then it is `#803d00` (± 1 per channel before lighting; linear product (0.216, 0.0466, 0); not the sRGB-space product `#804000`). *(Added 2026-10-09 (FX-J-spec2).)* *(Clarified 2026-10-09 (QA-E): "unlit base color" is the material's base value before lighting, the `vec4(texel.rgb × tint.rgb, texel.a)` that the toon material shades. The tint multiplies RGB only, per channel in linear RGB; the alpha 0.4 is the material alpha that the `alphaCutoff` test reads (spec 003 REQ-PIX-023 note "Material alpha"), and it is never written to the scene color target or the output. Alpha in the pixel pipeline is binary: with cutoff 0.5 the texel is discarded (output RGBA 0, 0, 0, 0); with cutoff 0.3 it is covered, its scene color alpha is exactly 1.0 and its output alpha is 255 (AC-PIX-023.6). This AC is therefore checked on the base value (a unit test of the base-color node, or a readback of an unlit, uncut base), not on the exported alpha.)*

**REQ-CMP-015 [P2]** WHERE a `PartSelection.tints` override exists for a tint slot THE SYSTEM SHALL use it for that part instead of the character-wide tint.

- **AC-CMP-015.1** Given character `primary = #ff0000` and a cape with override `primary = #0000ff`, When rendered, Then the cape uses blue and other `primary` parts use red.

**REQ-CMP-016 [P1]** THE SYSTEM SHALL provide a color picker per tint slot with a hex text field, a hue/saturation/value control, and swatches: the colors of the active palette (spec 003) when one is selected, plus data-driven swatch sets (`skin-tones`, `hair-colors`, `general`).

- **AC-CMP-016.1** Given palette PICO-8 is active, When the `primary` picker opens, Then its 16 colors appear as swatches and choosing one sets `primary` to that exact hex.
- **AC-CMP-016.2** Given the hex field, When the user types `#12G` or `123456`, Then the value is rejected with "Use a 6-digit hex color like #a0c4ff" and the tint is unchanged; `#ABCDEF` is accepted and stored lowercase.
- **AC-CMP-016.3** Given keyboard-only use, When the picker is opened with Enter, Then every swatch is reachable with arrow keys, has an accessible name including its hex value, and Escape closes the picker returning focus to its trigger (P-06).

**REQ-CMP-017 [P2]** WHILE the user drags inside the color picker THE SYSTEM SHALL update the preview live and record a single undo step when the drag ends.

- **AC-CMP-017.1** Given a 2 s hue drag, When the user then presses undo once, Then the tint returns to the value before the drag.

### Randomize

**REQ-CMP-018 [P2]** WHEN the user triggers randomize THE SYSTEM SHALL produce a new `CharacterSpec` from a seeded PRNG (`mulberry32`, 32-bit unsigned seed), store that seed in `CharacterSpec.seed`, and choose only compatible parts.

- **AC-CMP-018.1** Given seed `12345`, the same manifests, the same locks and the same starting spec, When randomize runs twice, Then the two resulting specs are deep-equal.
- **AC-CMP-018.2** Given 1,000 randomize runs with seeds 0–999, When each result is checked, Then every equipped part is compatible with the chosen body (REQ-CMP-008) and every `alsoOccupies` rule holds.
- **AC-CMP-018.3** Given the randomize code path, When it is statically checked, Then it does not call `Math.random`, `Date.now` or `performance.now`; a fresh seed for "reroll" comes from `crypto.getRandomValues`.

**REQ-CMP-019 [P2]** WHILE a slot, the tints group or the anatomy group is locked THE SYSTEM SHALL leave it unchanged during randomize.

- **AC-CMP-019.1** Given `hair` and `tints` locked, When randomize runs with any seed, Then `parts.hair` and `tints` are identical to the values before.
- **AC-CMP-019.2** Given the `body` slot is locked and a locked `torso` is incompatible with every other body, When randomize runs, Then the body and torso are kept and no error is raised.

*(Note 2026-10-09 (STY).)* A fourth lock group, style/species, is added by REQ-CMP-046 and is locked by default; REQ-CMP-047 covers randomize when it is unlocked.

**REQ-CMP-020 [P2]** THE SYSTEM SHALL leave an unlocked optional slot empty during randomize with the probability given by its `randomize.emptyChance` (0–1) in the slot registry, and pick tints from data-driven harmonious tint sets.

- **AC-CMP-020.1** Given `headwear.emptyChance = 0.5`, When randomize runs for seeds 0–9,999, Then `headwear` is empty in 45–55 % of results.
- **AC-CMP-020.2** Given the tint-set data file, When randomize picks tints, Then the resulting `tints` equal one tint set exactly, or a deterministic per-slot pick from the swatch sets listed in that tint set.

**REQ-CMP-021 [P3]** WHERE spec 002 defines randomize ranges for anatomy THE SYSTEM SHALL randomize unlocked anatomy values within those ranges.

- **AC-CMP-021.1** Given anatomy unlocked, When randomize runs, Then every anatomy value is within its randomize range from spec 002 and quantized to 0.01.

### Presets: save, load, share

**REQ-CMP-022 [P1]** WHEN the user saves a character THE SYSTEM SHALL download the `CharacterSpec` as UTF-8 JSON named `<sanitized-name>.character.json`, with keys in canonical order and 2-space indentation.

- **AC-CMP-022.1** Given character name `Hero #1`, When saved, Then the file is `hero-1.character.json` and validates against the `CharacterSpec` JSON Schema.
- **AC-CMP-022.2** Given the same spec saved twice, When the files are compared, Then they are byte-identical.

**REQ-CMP-023 [P1]** WHEN the user loads a character file THE SYSTEM SHALL run migrations to the latest `version`, validate it, and replace the current character as one undoable command.

- **AC-CMP-023.1** Given a valid file, When loaded, Then the preview shows the character and one undo restores the previous one.
- **AC-CMP-023.2** Given a file with `format` other than `sprite-character`, malformed JSON, or a file over 1 MB, When loaded, Then a message names the problem (`CMP_SPEC_INVALID` with the first failing path), and the current character is unchanged.
- **AC-CMP-023.3** Given a file whose `version` is higher than the app supports, When loaded, Then the message says "Made with a newer version of the app" and nothing changes.

**REQ-CMP-024 [P1]** IF a loaded spec references a `builtin:` part that is not registered THEN THE SYSTEM SHALL load the rest of the character, leave that slot empty, and list the missing refs in a non-blocking notice. This requirement covers `builtin:` refs only. Missing `user:` refs follow spec 008 REQ-UPL-048 (ref kept, "Missing asset", export blocked) and are never dropped by this requirement. *(Amended 2026-10-08, PM decision.)*

- **AC-CMP-024.1** Given a spec with `parts.back.ref = 'builtin:quaternius-outfits/cape-99'` that does not exist, When loaded, Then all other parts are equipped, `back` is empty, and the notice names `cape-99`.
- **AC-CMP-024.2** Given the missing ref is a `builtin:` `body`, When loaded, Then loading fails with `CMP_BODY_MISSING` (REQ-CMP-002).
- **AC-CMP-024.3** Given a missing `user:` ref, When loaded, Then spec 008 REQ-UPL-048 applies instead: the ref is kept, the slot shows "Missing asset", and export is blocked until it is resolved.

**REQ-CMP-025 [P2]** WHEN the user copies a share link THE SYSTEM SHALL encode the `CharacterSpec` in the URL fragment as `#c=<base64url(deflate-raw(canonical JSON))>`, without contacting any server.

- **AC-CMP-025.1** Given a character of built-in parts, When the link is opened in a new tab, Then the loaded spec is deep-equal to the original.
- **AC-CMP-025.2** Given a typical character (15 slots filled, all tints), When encoded, Then the fragment is ≤ 2,000 characters.
- **AC-CMP-025.3** Given the share action, When network requests are recorded, Then no request is made (P-03).

**REQ-CMP-026 [P2]** IF a character to be shared contains `user:` refs THEN THE SYSTEM SHALL warn that those parts are not included and, on confirmation, share the spec with those slots removed.

- **AC-CMP-026.1** Given a user-uploaded hat, When the user copies a link, Then a dialog lists the hat; on "Share without it" the URL contains no `user:` substring.

**REQ-CMP-027 [P2]** THE SYSTEM SHALL offer built-in character presets defined as data files (~~`CharacterSpec` JSON in the presets folder of a pack~~ `CharacterPreset` JSON files, `presets/characters/<id>.json` in a pack, each wrapping a `CharacterSpec` in its `character` member) and a local preset list stored in IndexedDB.

*(Amended 2026-10-09, PM decision, resolves the spec 014 Open question on preset files.)* A pack preset file is a `CharacterPreset` (spec 014 Data & contracts; `characterPresetSchema` and `parseCharacterPreset` in `packages/parts-schema/src/presets.ts`), not a bare `CharacterSpec`: `format: 'sprite-character-preset'`, `version: 1`, `id` (`[a-z0-9-]{1,32}`), `name` (1 to 64 characters, the display name), `character` (a `CharacterSpec`, migrated by its own `version`, REQ-CMP-049) and an optional `camera` (`side`, `three-quarter` or `isometric`; absent means `side`; spec 014 REQ-UX-078). Applying a preset applies its `character`; `camera` applies only when a project is started from the preset (spec 014), never when a preset is applied to an open character. The file path `presets/characters/<id>.json` and the listing through the generated `presets/index.json` (kind `character`) follow `presets.ts` as implemented in M3-01; spec 011 does not yet name either, so that spec should record them. Local presets in IndexedDB (AC-CMP-027.2) use the same `CharacterPreset` record with a locally generated `id` and no `camera` *(resolved 2026-10-09, PM)*.

- **AC-CMP-027.1** Given a new preset JSON added to a pack's presets folder (no code change), When the app builds, Then the preset appears in the preset gallery with its thumbnail.
- **AC-CMP-027.2** Given the user saves "Knight" to local presets, When the page reloads, Then "Knight" is listed and loads the same spec; no network request is made.

### Undo/redo of composer edits

**REQ-CMP-028 [P1]** THE SYSTEM SHALL express each composer edit (equip, clear, body change with its removals, tint commit, randomize, load, preset apply) as exactly one command on the single shared editor history defined by spec 009 (REQ-UX-022). The composer keeps no undo stack of its own.

- **AC-CMP-028.1** Given the sequence equip hair → set tint → randomize, When undo is pressed 3 times, Then the spec equals the initial spec; When redo is pressed 3 times, Then it equals the post-randomize spec.
- **AC-CMP-028.2** Given any composer command, When it is undone and redone, Then the serialized spec is byte-identical to the state before the undo.

### Thumbnails, search and filter

**REQ-CMP-029 [P1]** THE SYSTEM SHALL show each part in the picker with its thumbnail (from the manifest, spec 011), its name and an accessible label, and SHALL show a slot-specific placeholder icon if the thumbnail is missing or fails to load.

- **AC-CMP-029.1** Given a part whose thumbnail URL returns 404, When the picker renders, Then the placeholder icon is shown and no broken-image icon appears.
- **AC-CMP-029.2** Given a screen reader, When focus enters a part tile, Then it announces the part name, slot, and "equipped" or "not equipped".

**REQ-CMP-030 [P2]** WHEN the user types in the part search field THE SYSTEM SHALL filter the current slot's parts by case-insensitive match on name and tags within 100 ms for 1,000 parts.

- **AC-CMP-030.1** Given 1,000 registered parts, When the user types "helm", Then only parts whose name or tags contain "helm" are listed, updated within 100 ms of the last keystroke (debounce ≤ 50 ms).
- **AC-CMP-030.2** Given no match, When filtering, Then a "No parts match" message with a "Clear search" action is shown.

**REQ-CMP-031 [P2]** THE SYSTEM SHALL provide filters for source (built-in / my uploads), pack, tag and license (`CC0-1.0`, attribution required, unknown or non-commercial), combinable with search.

- **AC-CMP-031.1** Given filter "My uploads" and search "sword", When applied, Then only `user:` parts matching "sword" are listed.
- **AC-CMP-031.2** Given a part with license `other` and `commercialUse: 'unknown'`, When listed, Then its tile shows a license warning badge with text, not color alone (P-02, P-06).

**REQ-CMP-032 [P1]** THE SYSTEM SHALL make the slot list and part picker fully operable by keyboard: arrow keys move within the part grid, Enter equips, Delete clears the focused slot.

- **AC-CMP-032.1** Given keyboard-only use, When the user tabs to the `hair` slot, opens the picker, arrows to the third hair and presses Enter, Then that hair is equipped and focus stays on the tile with a visible focus ring.

### Engine contract

**REQ-CMP-033 [P1]** WHEN `setCharacter(spec)` is called THE SYSTEM SHALL apply only the differences from the previous spec (tint → uniform update; part change → load/rebind that part only; body change → full rebuild).

- **AC-CMP-033.1** Given a rendered character, When only `tints.hair` changes, Then no part is loaded or rebound (registry `resolve` call count unchanged) and the update completes in < 16 ms.
- **AC-CMP-033.2** Given a failed part load (`CMP_PART_LOAD_FAILED`), When `setCharacter` resolves, Then the result is `ok: false`, the previous character is still rendered, and a toast shows the code.

### Opening share links

**REQ-CMP-034 [P1]** WHEN the app opens a URL with a `#c=` fragment THE SYSTEM SHALL reject a fragment longer than 65,536 characters before decoding, SHALL decompress incrementally and abort with `CMP_SPEC_INVALID` as soon as the decompressed output exceeds 1 MB (without allocating a buffer for the full output), and SHALL then apply the same Zod validation, size limits and migrations as a loaded character file (REQ-CMP-023), plus the spec 000 GEN rules for untrusted input. (security review 2026-10-08)

- **AC-CMP-034.1** Given a `#c=` fragment of 70,000 characters, When the app opens, Then `CMP_SPEC_INVALID` is shown naming the 65,536-character limit, no decompression is started, and the current work is unchanged.
- **AC-CMP-034.2** Given a 60 KB `#c=` fragment that inflates to 1 GB, When decoded, Then decoding aborts with `CMP_SPEC_INVALID` once the output exceeds 1 MB, and the tab's JS heap grows by < 50 MB during decoding.
- **AC-CMP-034.3** Given a `#c=` fragment holding a spec at an older `version` (migration fixture), When opened, Then migrations run and the result validates; Given one with an unknown `format`, Then `CMP_SPEC_INVALID` names the first failing path.
- **AC-CMP-034.4** Given a `#c=` fragment that is valid base64url but not valid deflate-raw data, When opened, Then `CMP_SPEC_INVALID` is shown and no exception reaches the region error boundary.

**REQ-CMP-035 [P1]** WHEN a `#c=` fragment decodes to a valid `CharacterSpec` THE SYSTEM SHALL ask the user to confirm before opening it, SHALL open it as a new unsaved project (never replacing or modifying the currently open project), and SHALL remove the fragment from the address bar with `history.replaceState` after the load completes or is declined, so a reload does not re-trigger it. (security review 2026-10-08)

- **AC-CMP-035.1** Given an open project with unsaved changes and a `#c=` link opened in the same tab, When the confirmation dialog appears and the user chooses "Open as new project", Then a new unsaved project holds the shared character and the previous project is still listed with its changes autosaved (spec 009, REQ-UX-026).
- **AC-CMP-035.2** Given the confirmation dialog, When the user chooses "Cancel", Then no project is created and the current project is unchanged.
- **AC-CMP-035.3** Given a `#c=` link that was opened or declined, When the page reloads, Then `location.hash` is empty, no confirmation dialog appears, and `history.length` did not increase from the removal.

### M1 amendments (2026-10-08)

**REQ-CMP-036 [P1]** THE SYSTEM SHALL ship a default `CharacterSpec` as data whose body is `builtin:quaternius-ubc/superhero-m`, and every part it references SHALL be registered in the bundled packs and compatible with that body (REQ-CMP-008). *(Added 2026-10-08, M1 D4: M1 bundles only the free Superhero bodies; outfits fit them through `bodies` and tuned `hides`; Regular bodies are deferred.)*

- **AC-CMP-036.1** Given the built bundled packs, When the default `CharacterSpec` is validated and every ref is looked up in the registry, Then every ref is registered and every part is compatible with `superhero-m`.
- **AC-CMP-036.2** Given the default `CharacterSpec`, When `setCharacter` is called on the engine, Then the result is `ok: true` on both WebGPU and WebGL2 (`forceWebGL`).
- **AC-CMP-036.3** Given the default `CharacterSpec`, When it is serialized, Then its body, `parts` refs (6 slots: `hair`, `eyebrows`, `torso`, `arms`, `legs`, `feet`) and 7 tint values equal the table in Data & contracts exactly. *(Added 2026-10-09 (M1-33).)*

*(Note 2026-10-09 (M1-33): in the M1 code the default is not yet one data file. `createDefaultCharacterSpec()` in `@csg/parts-schema` returns the body, anatomy and tints with empty `parts`; the six part refs are added in `apps/web/src/app/default-character.ts`; `tools/lib/check/default-set.ts` repeats the list for the size check. This requirement is unchanged: the follow-up is one shipped data file that all three read.)*

**REQ-CMP-037 [P1]** WHEN a body is equipped THE SYSTEM SHALL build the character skeleton from the rest pose of the body's `characterSkeletonGroup` (or, if absent, its own `skeletonGroup`; if both are absent, the group `RigDefinition.defaultSkeletonGroup`, spec 002 REQ-ANA-021), and SHALL rebind every skinned part, including the body, to that skeleton by joint name while keeping each mesh's own inverse bind matrices. *(Added 2026-10-08, M1 PM rig update a: bind poses form skeleton groups (spec 011 REQ-AST-026); the male outfit group drives male characters and the Superhero body is shown head-only under outfits, per the vendor readme. Amended 2026-10-08 (M1-01c): the last fallback was "the rest pose stored in the body file"; PM decision: it is now `RigDefinition.defaultSkeletonGroup`.)*

- **AC-CMP-037.1** Given a fixture body in group `g-a` with `characterSkeletonGroup: 'g-b'`, When it is equipped, Then every joint's local rest transform equals `RigDefinition.skeletonGroups['g-b'].restPose` (± 1e-6).
- **AC-CMP-037.2** Given a shirt from group `g-b` equipped on that body, When it is rebound, Then its skeleton's inverse bind matrices are bit-identical to the matrices in the shirt file, and with no clip and default anatomy each shirt vertex is at its source bind-pose position (± 1e-5 m).
- **AC-CMP-037.3** Given a part manifest whose body entry has `characterSkeletonGroup` naming a group not in the embedded rig's `skeletonGroups`, When the manifest is validated, Then validation fails naming the part ID and `characterSkeletonGroup`.
- **AC-CMP-037.4** Given the fixture rig with `defaultSkeletonGroup: 'g-a'` and a fixture body whose manifest entry has neither `characterSkeletonGroup` nor `skeletonGroup`, When it is equipped, Then every joint's local rest transform equals the `restPose` of the `skeletonGroups` entry with `id: 'g-a'` (± 1e-6). *(Added 2026-10-08 (M1-01c).)*

### Style and species: `CharacterSpec` v2 (added 2026-10-09 (STY), PM decision)

Persisted-format rules apply (AGENTS.md "Data and formats", architecture §4.5): the version bump ships a pure migration and a fixture test from version 1. Rendering of `stickman`, `voxel`, `animal`, `monster` and of `composition` is spec 013 (M3.5). Labels used in UI text: Realistic, Chibi, Stickman, Voxel (described "Blocky, built from cubes", spec 013 REQ-STY-009, spec 014 REQ-UX-090; was spec 009 before the 2026-10-09 split), Human, Animal, Monster.

**REQ-CMP-038 [P1]** THE SYSTEM SHALL store the character's body style and species in `CharacterSpec` version 2 as two required fields: `style`, one of `realistic`, `chibi`, `stickman` or `voxel`, and `species`, one of `human`, `animal` or `monster`.

- **AC-CMP-038.1** Given 12 version-2 specs, one per (`style`, `species`) pair, When each is validated with the `CharacterSpec` schema and saved twice (REQ-CMP-022), Then all 12 parse and each pair of saved files is byte-identical.
- **AC-CMP-038.2** Given a version-2 spec without `style`, or without `species`, When it is loaded, Then loading fails with `CMP_SPEC_INVALID` and the first failing path is `style` or `species` respectively, and the current character is unchanged.
- **AC-CMP-038.3** Given the default `CharacterSpec` (REQ-CMP-036), When it is serialized, Then `version` is `2`, `style` is `"realistic"`, `species` is `"human"`, and the top-level keys appear in the canonical order `format, version, name, seed, style, species, body, parts, anatomy, morphs, tints` (then `composition` and `face` when present).

**REQ-CMP-039 [P1]** WHEN a `CharacterSpec` with `version: 1` is loaded THE SYSTEM SHALL, before validation, migrate it to version 2 with a pure function registered as `CHARACTER_MIGRATIONS[1]` that sets `style: 'realistic'` and `species: 'human'` and changes no other field.

- **AC-CMP-039.1** Given the version-1 fixture `packages/parts-schema/test/fixtures/character-v1.json` (the M2 default character, `version: 1`, committed with the bump), When `parseCharacterSpec` runs on it, Then the result is `ok: true`, `version` is 2, `style` is `realistic`, `species` is `human`, there is no `composition` key, and every other field is deep-equal to the fixture. *(Amended 2026-10-09 (M3 PM decision): the path was `packages/parts-schema/fixtures/character-v1.json`; fixtures live under `packages/*/test/fixtures/` (REQ-AST-021), where the M3 build committed it.)*
- **AC-CMP-039.2** Given a version-1 input object, When `CHARACTER_MIGRATIONS[1]` runs on it twice, Then the input is deep-equal to a clone taken before the first call (not mutated) and the two outputs are deep-equal.
- **AC-CMP-039.3** Given a hand-edited version-1 document that already contains `style: 'chibi'` and `species: 'monster'` (keys that version 1 never defined), When it is migrated, Then the result has `style: 'realistic'` and `species: 'human'` (version-1 documents always migrate to the defaults).
- **AC-CMP-039.4** Given a document with `version: 3`, When it is loaded by a version-2 app, Then the message says "Made with a newer version of the app" and nothing changes (AC-CMP-023.3 still holds).

**REQ-CMP-040 [P1]** IF `style` or `species` holds a value outside its version-2 set (an unknown word, a value only a newer app knows, a different case such as `Chibi`, or a non-string) THEN THE SYSTEM SHALL reject the whole document with `CMP_SPEC_INVALID` naming that field's path, and SHALL NOT coerce the value to a default.

- **AC-CMP-040.1** Given version-2 specs with `style: 'pixel'`, `style: 'Chibi'`, `style: 42` and `species: 'robot'`, When each is loaded (file, `#c=` fragment and local preset), Then each fails with `CMP_SPEC_INVALID`, the first failing path is `style` or `species`, and the current character is unchanged.

Unknown top-level keys keep the existing rule: the `CharacterSpec` schema drops them on load and they are not saved back. This requirement does not change that. A future app that adds a style or species value bumps `version` (persisted-format rules), so an older app reports "newer version" (AC-CMP-023.3) for such files, not this error.

**REQ-CMP-041 [P1]** THE SYSTEM SHALL accept an optional `composition` object in `CharacterSpec` version 2 with the fields `weight` and `muscle`, each a number from −1.00 to 1.00 quantized to 0.01; it SHALL treat an absent `composition` as `{ weight: 0, muscle: 0 }`, omit it from canonical JSON when both values are 0, and, until spec 013 REQ-STY-011..017 are implemented (M3.5), keep it on round trip without using it for rendering.

- **AC-CMP-041.1** Given `composition: { weight: 1.01, muscle: 0 }` or a `composition` missing `muscle`, When loaded, Then loading fails with `CMP_SPEC_INVALID` naming `composition.weight` or `composition.muscle`.
- **AC-CMP-041.2** Given a value of 0.333 written through the API, When stored, Then the spec holds `0.33`.
- **AC-CMP-041.3** Given a spec with `composition: { weight: 0, muscle: 0 }`, When saved, Then the file has no `composition` key; Given a spec with `composition: { weight: 0.5, muscle: 0 }` in an M3 build, When it is rendered and saved, Then the pixels equal the same spec without `composition` exactly (golden) and the saved file still holds `{ "weight": 0.5, "muscle": 0 }`.

**REQ-CMP-042 [P1]** WHEN the user changes `style` THE SYSTEM SHALL set the new `style` and, where the style data file (spec 002 REQ-ANA-024) names an anatomy preset for that style, apply that preset to all nine anatomy values in the same undoable command (M3 data: `realistic` → preset `realistic`, `chibi` → preset `chibi`).

- **AC-CMP-042.1** Given style `realistic` and `head = 1.20`, When the user selects Chibi, Then `style` is `chibi`, the nine anatomy values equal the `chibi` row of spec 002 REQ-ANA-013, and one undo restores `style: 'realistic'` and `head = 1.20`.
- **AC-CMP-042.2** Given style `chibi` with `head = 1.60` (edited after the preset), When the user selects Realistic, Then the nine anatomy values equal the `realistic` row (all 1.00).
- **AC-CMP-042.3** Given a style data file that names no anatomy preset, When the user selects that style, Then only `style` changes and the anatomy values are unchanged.

**REQ-CMP-043 [P1]** IF the current character's (`style`, `species`) pair is not in the engine's supported list `SUPPORTED_STYLE_COMBOS` (M3: `realistic`/`human` and `chibi`/`human`) THEN THE SYSTEM SHALL keep the stored values unchanged, render the preview with the fallback pair (an unsupported `style` becomes `realistic`, an unsupported `species` becomes `human`; if the resulting pair is still unsupported, `realistic`/`human`), and show a persistent non-blocking notice with code `CMP_STYLE_UNSUPPORTED` reading "<label> is coming soon. Showing <fallback label> for now.", without raising an uncaught error. *(Note 2026-10-09 (PM): "supported" here means available per the single gating rule of REQ-CMP-045 — in `SUPPORTED_STYLE_COMBOS` **and** content present in the loaded packs (`availableStyleCombos`). REQ-CMP-044 uses the same test.)*

- **AC-CMP-043.1** Given an M3 build and a version-2 spec with `style: 'stickman'`, `species: 'human'`, When it is loaded, Then loading succeeds, the preview pixels equal those of the same spec with `style: 'realistic'` (golden, per backend), the notice shows code `CMP_STYLE_UNSUPPORTED` with "Stickman is coming soon. Showing Realistic for now.", the serialized spec still has `style: 'stickman'`, and no region error boundary or console error fires.
- **AC-CMP-043.2** Given an M3 build and `style: 'chibi'`, `species: 'monster'`, When loaded, Then the preview uses `chibi`/`human` and the notice names Monster.
- **AC-CMP-043.3** Given the notice is shown, When the user selects a supported pair, Then the notice disappears within one rendered frame.

**REQ-CMP-044 [P1]** WHILE the current (`style`, `species`) pair is unsupported (REQ-CMP-043) THE SYSTEM SHALL block export and show the reason `CMP_STYLE_UNSUPPORTED` with the text "<label> is coming soon. Choose a supported style to export."

- **AC-CMP-044.1** Given an M3 build and a character with `style: 'voxel'`, When the user opens export, Then the export action is disabled with that reason as visible text and accessible description; When export is invoked through the engine API, Then it returns `ok: false` with code `CMP_STYLE_UNSUPPORTED` and no file is produced.

**REQ-CMP-045 [P1]** THE SYSTEM SHALL list every `style` and every `species` value in the composer's style and species pickers, enable exactly the values that form ~~a pair in `SUPPORTED_STYLE_COMBOS`~~ an **available** pair with the other current value, and show every other value as disabled with the visible text "Coming soon" (text, not color alone, P-06). A pair is available when BOTH (1) the engine supports it, i.e. it is in `SUPPORTED_STYLE_COMBOS` (spec 013 REQ-STY-029), AND (2) the loaded packs provide its required content: (a) the style data file `presets/styles/<style>.json` (spec 002 REQ-ANA-024), and (b) for a species other than `human`, at least one loaded `species-head` part (spec 013 REQ-STY-018) whose `species` contains that species and that is compatible with the style by REQ-CMP-048 rule (d). This one rule gates the composer pickers here and the new-character wizard (spec 014 REQ-UX-092). *(Amended 2026-10-09, PM gating decision: was "a pair in `SUPPORTED_STYLE_COMBOS`" only. Condition (2) is the spec writer's concrete reading of "the required content is present in the loaded packs"; PM to confirm at M3 review.)*

- **AC-CMP-045.1** Given an M3 build and species `human`, When the style picker renders, Then it lists Realistic, Chibi, Stickman and Voxel in that order; Realistic and Chibi are enabled; Stickman and Voxel have `aria-disabled="true"` and the text "Coming soon"; and the species picker lists Human (enabled), Animal and Monster ("Coming soon").
- **AC-CMP-045.2** Given keyboard-only use, When the user arrows onto Stickman, Then it receives focus, a screen reader announces "Stickman" with the description "Coming soon. Available in a later update." (the wording of spec 014 REQ-UX-092; spec 009 before the 2026-10-09 split), and pressing Enter changes nothing (spec unchanged, no undo entry).
- **AC-CMP-045.3** Given a test build whose `SUPPORTED_STYLE_COMBOS` also contains `stickman`/`human` *(amended 2026-10-09: and a loaded fixture pack that provides `presets/styles/stickman.json`)*, When the picker renders, Then Stickman is enabled with no other code change.
- **AC-CMP-045.4** Given a test build whose `SUPPORTED_STYLE_COMBOS` contains `stickman`/`human` but no loaded pack provides `presets/styles/stickman.json`, When the style picker renders for species `human`, Then Stickman has `aria-disabled="true"` and the text "Coming soon"; Given that file loaded but the pair absent from `SUPPORTED_STYLE_COMBOS`, Then Stickman is disabled too. *(Added 2026-10-09, PM gating decision.)*
- **AC-CMP-045.5** Given a test build whose `SUPPORTED_STYLE_COMBOS` contains `realistic`/`animal` and style `realistic`, When no loaded part has slot `species-head` and `species` containing `animal`, Then Animal is disabled with "Coming soon"; When a fixture pack with one such part (no `styles` field) is loaded, Then Animal is enabled. *(Added 2026-10-09, PM gating decision.)*

**REQ-CMP-046 [P2]** WHILE the style/species lock group is locked (the default in every new session) THE SYSTEM SHALL keep `style` and `species` unchanged during randomize and SHALL consume no PRNG draw for them.

- **AC-CMP-046.1** Given default locks and a `chibi`/`human` character, When randomize runs for seeds 0–999, Then every result has `style: 'chibi'` and `species: 'human'`.
- **AC-CMP-046.2** Given default locks and seed `12345`, When randomize runs, Then the result, ignoring `style`, `species` and `version`, is deep-equal to the version-1 randomize result for the same seed, manifests, locks and starting spec (the new fields do not shift the PRNG sequence).

**REQ-CMP-047 [P2]** WHEN randomize runs with the style/species lock group unlocked THE SYSTEM SHALL pick one pair from `SUPPORTED_STYLE_COMBOS` uniformly with the randomize PRNG, before parts are picked, and SHALL apply the picked style's anatomy preset (REQ-CMP-042) as the base for anatomy randomize (spec 002 REQ-ANA-026) unless the anatomy group is locked.

- **AC-CMP-047.1** Given the M3 combos and the group unlocked, When randomize runs for seeds 0–9,999, Then every result is a supported pair and each of the 2 pairs occurs in 45–55 % of results.
- **AC-CMP-047.2** Given the group unlocked and the anatomy group locked, When randomize picks `chibi`, Then `style` is `chibi` and the nine anatomy values are unchanged.
- **AC-CMP-047.3** Given the group unlocked, When randomize runs twice with the same seed, manifests, locks and starting spec, Then the results are deep-equal (REQ-CMP-018).

**REQ-CMP-048 [P1]** THE SYSTEM SHALL extend the compatibility rule of REQ-CMP-008 with (d) `part.styles` is absent or empty or contains the character's `style`, and (e) `part.species` is absent or empty or contains the character's `species`, checked in that order after (a)–(c), with the reasons `style` and `species`; WHEN `style` or `species` changes, THE SYSTEM SHALL handle newly incompatible parts as REQ-CMP-010 does for a body change.

- **AC-CMP-048.1** Given a part with `species: ['animal']`, When compatibility is computed for a `human` character, Then it is incompatible with reason `species`; for an `animal` character (any style that is otherwise compatible), Then it is compatible.
- **AC-CMP-048.2** Given an equipped part with `styles: ['realistic']`, When the user selects Chibi, Then the part is removed in the same undoable command, the notice lists it, and one undo restores the style, the anatomy values and the part.
- **AC-CMP-048.3** Given a part with `bodies` excluding the body and `species: ['animal']` on a human character, When compatibility is computed, Then the reason is `body` (rule (b) before (e)).

**REQ-CMP-049 [P1]** WHEN a `CharacterSpec` is read from any container (character file, `#c=` fragment, pack preset file, local preset in IndexedDB, the shipped default-character data file, or the `character` member of a `ProjectDocument`) THE SYSTEM SHALL run the `CHARACTER_MIGRATIONS` chain on it according to its own `version`, before validation and independently of the container's version.

- **AC-CMP-049.1** Given a stored `ProjectDocument` fixture (spec 009 REQ-UX-025) whose `character` is a version-1 `CharacterSpec`, When the project opens, Then it loads and its character is version 2 with `realistic`/`human`.
- **AC-CMP-049.2** Given a pack preset file (a `CharacterPreset`, REQ-CMP-027) whose `character` is a version-1 `CharacterSpec` *(amended 2026-10-09, PM: was "holding a version-1 `CharacterSpec`"; the preset wrapper stays `version: 1` and is not migrated)*, When the preset gallery loads and the preset is applied, Then it applies as a version-2 spec with `realistic`/`human` and no error.
- **AC-CMP-049.3** Given a `#c=` fragment holding a version-1 spec, When opened, Then the confirmation of REQ-CMP-035 shows and the opened character is version 2 (AC-CMP-034.3).

## Edge cases

- Empty character (body only) → valid; REQ-CMP-002, REQ-CMP-005.
- Body and parts from different skeleton groups → one character skeleton from the body's `characterSkeletonGroup`; each mesh keeps its own inverse bind matrices (REQ-CMP-037). Small seams at neck, wrists or ankles are covered by `hides` tuning (M1 D4).
- Body swap makes parts incompatible → REQ-CMP-010.
- Full-body outfit vs separate legs → REQ-CMP-007.
- Helmet over hair → REQ-CMP-012. Overlapping `hides` from several parts → union (REQ-CMP-011).
- Missing part refs, unknown slots in a file → REQ-CMP-024; unknown slot keys are dropped with the same notice.
- Tint override for a tint slot the part does not use → ignored, kept on round trip (REQ-CMP-015).
- Locked slots that conflict with the randomized body → locked body wins; if the body is unlocked, randomize only picks bodies compatible with all locked parts. If no such body exists, the body is kept (REQ-CMP-019).
- User part deleted from OPFS while referenced → spec 008 REQ-UPL-048 (ref kept, export blocked), not REQ-CMP-024.
- Share URL with user parts → REQ-CMP-026. Fragment tampered or truncated → REQ-CMP-023 error path via REQ-CMP-034.
- Oversized or decompression-bomb `#c=` fragment → rejected before or during decoding (REQ-CMP-034).
- `#c=` link opened while editing → confirmation, new unsaved project, fragment cleared (REQ-CMP-035).
- Offline and part never cached → REQ-GEN-004.
- Version-1 file, fragment, preset or project → migrated to version 2 with `realistic`/`human` (REQ-CMP-039, REQ-CMP-049). *(Added 2026-10-09 (STY).)*
- Unknown or miscased `style`/`species` value → `CMP_SPEC_INVALID`, never coerced (REQ-CMP-040). *(Added 2026-10-09 (STY).)*
- Valid but not-yet-rendered pair (e.g. `stickman`, `animal` in M3) → fallback preview, "Coming soon" notice, export blocked, values kept (REQ-CMP-043, REQ-CMP-044). *(Added 2026-10-09 (STY).)*
- `composition` in an M3 build → kept, not rendered (REQ-CMP-041). *(Added 2026-10-09 (STY).)*
- Style change makes equipped parts incompatible → removed in the same command with a notice (REQ-CMP-048). *(Added 2026-10-09 (STY).)*
- Shared skeleton turns out false → compatibility rule (a) excludes cross-rig skinned parts until a retarget/bone-map path exists (spec 011 fallback). *(M1-gated. M1 result 2026-10-09 (M1-33): all bundled files share rig `quaternius-ue5-65`; only bind poses differ (skeleton groups), which never affect compatibility, AC-CMP-008.5.)*

## Data & contracts

These refine `docs/architecture.md` §3.2–3.3. Canonical definitions are Zod schemas in `@csg/parts-schema`. The architecture doc must be updated to match in the PR that implements them.

```ts
/** Slot ID. Validated against the slot registry, not a closed union (P-11). */
export type SlotId = string; // v1 registry: see REQ-CMP-001

export interface SlotDefinition {
  id: SlotId;                       // [a-z0-9-]{1,32}
  label: string;                    // i18n message key
  order: number;
  kinds: Array<'skinned' | 'static'>;
  required: boolean;                // true only for 'body'
  /** Default socket for static parts in this slot. A semantic socket ID, resolved to a joint
   *  through RigDefinition.socketBones (spec 002 REQ-ANA-019; amended 2026-10-08, M1 D1). */
  defaultSocket?: SocketId;       // spec 002; was `SocketBone` (deprecated alias), renamed 2026-10-09 (M1-33) to the schema name
  randomize: { emptyChance: number }; // 0..1; body = 0
}

/** v1 registry (abridged). */
// body      skinned          required
// hair      skinned|static   socket head        emptyChance 0.1
// eyebrows  skinned|static   socket head        0.2
// beard     skinned|static   socket head        0.7
// face      skinned|static   socket head        0.8   (masks, glasses)
// headwear  skinned|static   socket head        0.5
// torso     skinned                             0
// arms      skinned                             0.6   (sleeves, bracers)
// hands     skinned                             0.6   (gloves)
// legs      skinned                             0
// feet      skinned                             0.1
// back      skinned|static   socket spine_03    0.7   (capes, packs)
// accessory skinned|static   socket pelvis      0.7   (belts, pouches)
// prop-main-hand  static     socket hand_r      0.3
// prop-off-hand   static     socket hand_l      0.6

export interface PartEntry {
  id: string;                      // stable, never reused (spec 011 retired-ids)
  name: string;
  slot: SlotId;
  kind: 'skinned' | 'static';
  file: string;
  node?: string;
  rig?: RigId;                     // required for 'skinned'
  /** Only for parts in slot 'body': the fit group outfits target. */
  bodyType?: string;               // e.g. 'regular' | 'superhero' | 'teen'
  hides: BodyRegion[];
  /** Slots this part also fills (e.g. robe: torso + legs). */
  alsoOccupies?: SlotId[];
  tintSlots: Array<{ material: string; slot: TintSlot; mode?: 'multiply' | 'replace' }>;
  socket?: { bone: SocketId; offset: TransformOffset; inheritScale?: boolean }; // spec 002; `bone` is a socket ID, not a joint name (M1 D1); type renamed from `SocketBone` 2026-10-09 (M1-33)
  bodies?: string[];               // body part IDs; empty/absent = all
  bodyTypes?: string[];            // body fit groups; empty/absent = all
  /** Added 2026-10-09 (STY). Styles this part fits; empty/absent = all (REQ-CMP-048 rule d). */
  styles?: CharacterStyle[];
  /** Added 2026-10-09 (STY). Species this part fits; empty/absent = all (REQ-CMP-048 rule e). */
  species?: CharacterSpecies[];
  /** Added 2026-10-08 (M1). Computed by build-parts: the skeleton group of this file (spec 011 REQ-AST-026). Skinned parts only. */
  skeletonGroup?: string;
  /** Added 2026-10-08 (M1). Body parts only, authored: skeleton group whose rest pose drives characters using this body (REQ-CMP-037). */
  characterSkeletonGroup?: string;
  thumbnail?: string;              // path relative to pack base URL (spec 011)
  sha256: string;                  // of `file`, written by build-parts (spec 011)
  stats: { triangles: number; textures: number };
  tags: string[];
  license?: AssetLicense;
}

/** Added 2026-10-09 (STY), REQ-CMP-038. Closed set; unknown values are rejected (REQ-CMP-040). */
export type CharacterStyle = 'realistic' | 'chibi' | 'stickman' | 'voxel';
/** Added 2026-10-09 (STY), REQ-CMP-038. */
export type CharacterSpecies = 'human' | 'animal' | 'monster';

/** Added 2026-10-09 (STY), REQ-CMP-041. Rendering in spec 013 (M3.5). */
export interface BodyComposition {
  weight: number;                  // -1.00..1.00, quantized to 0.01
  muscle: number;                  // -1.00..1.00, quantized to 0.01
}

export interface CharacterSpec {
  format: 'sprite-character';
  version: 2;                      // was 1 until 2026-10-09 (STY), REQ-CMP-038/039
  name: string;                    // 1..64 chars
  seed: number;                    // uint32, 0..4294967295
  style: CharacterStyle;           // added in v2
  species: CharacterSpecies;       // added in v2
  body: PartSelection;
  /** Keys are non-body SlotIds; absent key = empty slot. */
  parts: Record<SlotId, PartSelection>;
  anatomy: AnatomyParams;          // ranges in spec 002
  morphs: Record<string, number>;  // spec 002
  tints: Record<TintSlot, HexColor>; // all 7 required, lowercase '#rrggbb'
  composition?: BodyComposition;   // added in v2; absent = {0, 0}; omitted when both 0
  face?: { decal: AssetRef | null; offsetPx: [number, number] }; // spec 002
}

/** Current format version (`@csg/parts-schema` CHARACTER_FORMAT_VERSION). */
export const CHARACTER_FORMAT_VERSION = 2;

/** Pure vN -> vN+1 steps, keyed by the version they upgrade from (REQ-CMP-039). */
export const CHARACTER_MIGRATIONS = {
  1: (doc: Record<string, unknown>) => ({ ...doc, style: 'realistic', species: 'human' }),
};

/**
 * Exported by `@csg/engine` (REQ-CMP-043/045). The (style, species) pairs this build renders.
 * M3: [['realistic', 'human'], ['chibi', 'human']]. Spec 013 REQ-STY-029 says when a pair is added.
 */
export const SUPPORTED_STYLE_COMBOS: ReadonlyArray<readonly [CharacterStyle, CharacterSpecies]>;

/**
 * Added 2026-10-09 (PM gating decision, REQ-CMP-045). Pure. Returns the pairs of `supported` whose
 * required content is in the loaded packs: the style's `presets/styles/<style>.json`, and for a
 * non-human species at least one `species-head` part listing that species and compatible with the
 * style (REQ-CMP-048 rule d). Used by the composer pickers and the spec 014 wizard.
 */
export function availableStyleCombos(
  supported: ReadonlyArray<readonly [CharacterStyle, CharacterSpecies]>,
  loaded: { readonly styles: ReadonlySet<CharacterStyle>; readonly parts: readonly PartEntry[] },
): ReadonlyArray<readonly [CharacterStyle, CharacterSpecies]>;
```

*(Added 2026-10-09 (STY).)* **`ProjectDocument`.** The persisted project wrapper (`format: 'sprite-project'`, `version`, `character`, `render`, `export`, `graphs`) is drafted in `docs/architecture.md` §3.3 and owned by spec 009 (projects and autosave, REQ-UX-025). This spec defines only its `character` member, which is a `CharacterSpec` that carries its own `version` and is migrated by REQ-CMP-049 independently of the wrapper's version. So the move to `CharacterSpec` version 2 does not by itself require a `ProjectDocument` version bump. The schema in `@csg/parts-schema` follows spec 009 for the wrapper and this section for `character`.

Refinements versus architecture §3:

1. `SlotId` becomes a registry-validated string (P-11). The 15 v1 IDs equal the architecture's union, with `eyebrows` ordered before `beard` for display.
2. New `PartEntry` fields: `bodyType`, `bodyTypes`, `alsoOccupies`, `tintSlots[].mode`, `socket.inheritScale`, `thumbnail`, `sha256`.
3. `HexColor` is normalized to lowercase 6-digit form; `seed` is a uint32.
4. Clip selection is **not** part of `CharacterSpec`. It lives in `RenderSettings.animations` (spec 004). The 000 glossary was corrected on 2026-10-08.
5. Canonical JSON: keys in schema order, `parts` keys in slot-registry order, no `undefined`, numbers as shortest round-trip form. Used for save (REQ-CMP-022) and share (REQ-CMP-025).

Default `CharacterSpec` (shipped data): body `builtin:quaternius-ubc/superhero-m`, hair and basic outfit (proposed: `hair-simple-parted`, `eyebrows-regular`, Ranger torso, arms, legs and boots; final part IDs come from the M1-14 pack configs), all anatomy values 1, `seed: 0`. *(Amended 2026-10-08 (M1 D4): was `regular-m`; see REQ-CMP-036.)*

*(Amended 2026-10-09 (M1-33): final values, fixed by the M1-14 pack configs and the M1-04 schema defaults.)* The default `CharacterSpec` is exactly:

| Field | Value |
|-------|-------|
| `name` | `New character` |
| `version` | `2` *(added 2026-10-09 (STY))* |
| `seed` | `0` |
| `style` | `realistic` *(added 2026-10-09 (STY))* |
| `species` | `human` *(added 2026-10-09 (STY))* |
| `body.ref` | `builtin:quaternius-ubc/superhero-m` |
| `parts.hair.ref` | `builtin:quaternius-ubc/hair-simple-parted` |
| `parts.eyebrows.ref` | `builtin:quaternius-ubc/eyebrows-regular` |
| `parts.torso.ref` | `builtin:quaternius-outfits/male-ranger-torso` |
| `parts.arms.ref` | `builtin:quaternius-outfits/male-ranger-arms` |
| `parts.legs.ref` | `builtin:quaternius-outfits/male-ranger-legs` |
| `parts.feet.ref` | `builtin:quaternius-outfits/male-ranger-boots` |
| `anatomy` | every value `1` |
| `morphs` | `{}` |
| `tints` | ~~`skin #e0ac8a`, `hair #4a3222`, `eyes #3b5b8c`, `primary #5b7fa6`, `secondary #a65b5b`, `metal #a8afb5`, `leather #7a5230`~~ ~~all 7 slots `#ffffff`: `skin`, `hair`, `eyes`, `primary`, `secondary`, `metal`, `leather` (amended 2026-10-09 (FX-J-spec2))~~ `skin #ffffff`, `hair #7a4a26`, `eyes #ffffff`, `primary #ffffff`, `secondary #ffffff`, `metal #ffffff`, `leather #ffffff` (amended 2026-10-09 (FX-L): all slots authored colors except `hair`) |
| `face` | absent |
| `composition` | absent *(added 2026-10-09 (STY))* |

The default clips are not part of the `CharacterSpec` (refinement 4). The default `RenderSettings.animations` selection is `builtin:quaternius-ual/idle` then `builtin:quaternius-ual/walk` (spec 004), and the default-set size budget (spec 011 AC-AST-016.2) covers these 7 files plus the 2 clips. The tint values were chosen by the developer in M1-04 and confirmed by this amendment; they are initial values, adjustable in data with a spec amendment.

*(Amended 2026-10-09 (FX-J-spec2), PM decision.)* The default tints are all `#ffffff`, so with the `multiply` rule of REQ-CMP-014 the default character shows the authored Quaternius texture colors (the Ranger greens and browns the user asked for in D2, spec 003). The M1-04 values are struck in the table above. AC-CMP-036.3 checks the new values.

*(Amended 2026-10-09 (FX-L), PM decision after FX-K.)* ~~The default tints are all `#ffffff`~~ The default tints are `#ffffff` for every slot except `hair`, which is `#7a4a26` (brown). Reason: the UBC hair texture (`T_Hair_1_BaseColor`) is neutral grey, authored to be tinted, so a white hair tint rendered silver-grey hair in FX-K. The eyebrows map to the same `hair` slot and so get the same brown. All other slots keep the authored Quaternius colors. AC-CMP-036.3 checks these values.

Refinement 6 (2026-10-08, M1): `PartEntry.skeletonGroup` and `characterSkeletonGroup` added (REQ-CMP-037); `socket.bone` / `defaultSocket` hold semantic socket IDs resolved through `RigDefinition.socketBones` (spec 002). Architecture §3.2 is synced in M1-32.

Refinement 7 (2026-10-09, STY): `CharacterSpec` version 2 adds `style`, `species` and optional `composition`; `PartEntry` adds optional `styles` and `species`; `CHARACTER_MIGRATIONS[1]` and `SUPPORTED_STYLE_COMBOS` are new contracts. The implementing PR updates the shipped `data/default-character.json` to version 2 and adds the version-1 fixture `packages/parts-schema/test/fixtures/character-v1.json` (path corrected 2026-10-09, M3 PM decision; see AC-CMP-039.1), a copy of the version-1 default character taken before the bump (under the 200 KB fixture limit). Architecture §3.3 must be synced in that PR. Spec 013 adds `PartEntry.kind: 'procedural'` and the M3.5 slots (REQ-STY-030, REQ-STY-031).

## Non-functional

- NFR-1 (P-07): tint/anatomy change < 16 ms; cached part swap < 150 ms; picker search < 100 ms for 1,000 parts.
- NFR-2 (P-04): randomize and serialization are deterministic; no wall clock or unseeded randomness.
- NFR-3 (P-03): save, load, share and local presets make zero network requests.
- NFR-4 (P-06): all composer controls are keyboard-operable with visible focus; license badges and incompatibility reasons use text, not color alone.

## Open questions

- ~~[NEEDS CLARIFICATION: Final body/part IDs and `bodyType` groups depend on which Quaternius tiers are bundled (spec 011 open question). Blocks the default `CharacterSpec` only.]~~ Resolved 2026-10-09 (M1-33): free tiers only (spec 011); bodies `superhero-m` and `superhero-f` (`bodyType: 'superhero'`); the default `CharacterSpec` is fixed in Data & contracts.
- [NEEDS CLARIFICATION: Can Quaternius outfits fit all three body proportions (Superhero/Regular/Teen), or only some? Decides how `bodyTypes` is filled in pack configs. Answered by the M1 spike. Partly answered 2026-10-08 (M1 D4): M1 ships Superhero bodies only, with outfits restricted by `bodies` (male parts → `superhero-m`, female → `superhero-f`) and tuned `hides`. Extracting Regular bodies is reopened only if the M1 visual review finds seams `hides` cannot cover.]
- [NEEDS CLARIFICATION: Should a user be able to mirror handedness (props in the left hand by default)? Proposal: P3, a `handedness` field later.]
- [NEEDS CLARIFICATION: Deferred to M3 (added 2026-10-09 (FX-J-spec2)): a luminance-based `recolor` tint mode (`luminance(texel) × tint`, the multiply rule before FX-J-spec2) to recolor dark or detailed textures to any hue. Open: whether it becomes a third `tintSlots[].mode` value, whether it needs a brightness/contrast remap so dark textures (Ranger luminance about 0.01–0.12) can still reach light colors, and whether the UI offers it per slot. Owner: PM with graphics-engineer, M3 planning. Not blocking M2.]

- ~~[NEEDS CLARIFICATION: (added 2026-10-09 (STY)) Unsupported pairs render a fallback preview and block export (REQ-CMP-043/044). Alternative: block the preview too, or allow export of the fallback. This spec chose "preview fallback, export blocked" so no sheet is produced that does not match the stored style. Owner: PM. Not blocking M3; confirm at M3 review.]~~ Resolved 2026-10-09 (PM): accepted as written. The preview falls back (REQ-CMP-043: an unsupported `style` becomes `realistic`, an unsupported `species` becomes `human`, last resort `realistic`/`human`), the notice shows `CMP_STYLE_UNSUPPORTED`, the stored values are kept, and export is blocked (REQ-CMP-044).
- ~~[NEEDS CLARIFICATION: (added 2026-10-09 (STY)) REQ-CMP-045 enables options from `SUPPORTED_STYLE_COMBOS` (engine capability); spec 009 REQ-UX-092 enables wizard options when "a pack provides the content". See spec 013 Open questions for the proposed combined rule. Owner: spec 009 owner with the PM. Not blocking M3.]~~ Resolved 2026-10-09 (PM): one rule. An option is enabled only when its pair is in `SUPPORTED_STYLE_COMBOS` AND the loaded packs provide the pair's required content (REQ-CMP-045 amended, `availableStyleCombos`); spec 014 REQ-UX-092 and spec 013 REQ-STY-029 refer to it.
- ~~[NEEDS CLARIFICATION: (added 2026-10-09 (STY)) Switching from Chibi to Realistic resets anatomy to the `realistic` preset (REQ-CMP-042), discarding manual slider edits; they come back only through undo. Owner: PM. Not blocking.]~~ Resolved 2026-10-09 (PM): accepted. Selecting Realistic from Chibi resets the nine anatomy values to the `realistic` preset in the same single undo step (REQ-CMP-042, AC-CMP-042.1, AC-CMP-042.2).
- Note 2026-10-09: REQ-CMP-043 (fallback rendering) still keys on `SUPPORTED_STYLE_COMBOS` only, while the pickers use the available pairs of REQ-CMP-045. So a stored pair the engine supports but whose content pack is not loaded (for example `realistic`/`animal` with no animal heads) renders as stored, with no fallback notice, and exports. Resolved 2026-10-09 (PM): REQ-CMP-043/044 also use the available pairs (see the note on REQ-CMP-043).

## References

- PM decision 2026-10-09 (STY): `CharacterSpec` v2 with `style`, `species` and `composition`; spec 013 (M3.5)
- PM decisions 2026-10-09 (gating rule, fallback accepted, Chibi to Realistic reset accepted), relayed by the coordinator; spec 014 (wizard, split from spec 009)
- `packages/parts-schema/src/character-spec.ts` (`CHARACTER_MIGRATIONS`, `migrateCharacterSpec`, read 2026-10-09)
- `packages/parts-schema/src/presets.ts` (`characterPresetSchema`, `parseCharacterPreset`, read 2026-10-09) and spec 014 `CharacterPreset` contract, for the REQ-CMP-027 amendment (PM decision 2026-10-09)
- ADR-0001, ADR-0005, ADR-0008 (M1 rig outcome, `docs/adr/0008-shared-rig-skeleton-groups-runtime-retarget.md`); `docs/architecture.md` §2.1, §3.2–3.3, §4.1–4.3
- M1 implementation read for the 2026-10-09 (M1-33) amendments: `packages/engine/src/registry/compatibility.ts`, `packages/parts-schema/src/character-spec.ts`, `apps/web/src/app/default-character.ts`, `assets/packs/quaternius-{ubc,outfits}/manifest.json`
- `.tagconn/work/research.md` (2026-10-08)
- Quaternius Modular Character Outfits – Fantasy: https://quaternius.itch.io/modular-character-outfits-fantasy (accessed 2026-10-08)
- Quaternius Universal Base Characters: https://quaternius.itch.io/universal-base-characters (accessed 2026-10-08)
- mulberry32 PRNG (Tommy Ettinger, public domain). The reference implementation and test vectors get pinned in `@csg/parts-schema` tests, so the algorithm cannot drift.
- `.tagconn/work/m1-plan.md` §4, §5 (D1, D4) and the M1 verify-rig PM update (2026-10-08)
- MDN CompressionStream (`deflate-raw`): https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream (accessed 2026-10-08)
