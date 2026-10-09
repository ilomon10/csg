---
id: AST
title: Asset pipeline (ingestion, rig verification, manifests, licensing)
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 004-animation]
last_updated: 2026-10-09
---

# 011 – Asset pipeline

## Rules for IDs

`REQ-AST-NNN` and `AC-AST-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused. PM decision 2026-10-08: the AST area gets this dedicated spec.

## Context

Bundled characters come from CC0 Quaternius packs: Universal Base Characters (UBC), Modular Character Outfits – Fantasy and the Universal Animation Library (UAL), plus CC0 Quaternius/KayKit props. Raw packs are large (UBC Source ≈ 600 MB, Outfits Standard ≈ 280 MB), come in several formats and are not in the shape the engine needs: one optimized file per part, a manifest, thumbnails and license records. The pipeline turns local source packs into committed, optimized, licensed, data-driven packs that the composer (001), anatomy (002) and animation (004) consume.

The pipeline is also how the riskiest assumption gets tested. The research brief cites a third-party claim that all packs share one 65-joint UE5-style skeleton with identical bind poses. **That claim is unverified.** `tools/verify-rig.ts` is the **M1 spike** that confirms or refutes it, and its result gates the final contracts of 001/002/004 (ADR-0001 risk, architecture §7). *(Amended 2026-10-09 (M1-33): the spike answered **mapped** (REQ-AST-007, ADR-0008): names and hierarchy are shared, bind poses form 4 skeleton groups.)*

## Goals

- G1: Reproducible builds: same sources + same tool versions → byte-identical built packs.
- G2: A clear, machine-readable answer to "do these packs share one skeleton?".
- G3: Every bundled file has a license record and appears in credits (P-02).
- G4: Contributors add parts, clips, presets and packs with data and GLB files only (P-11).
- G5: CI checks built packs without needing the gitignored source packs.

## Non-goals

- NG1: Downloading packs automatically from itch.io (no public download API; vendor terms). Contributors download manually.
- NG2: Weight transfer, re-rigging or retopology of foreign meshes.
- NG3: Runtime (in-browser) processing of user uploads. That is spec 008.
- NG4: A hosted asset marketplace (000 NG3).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | maintainer | one command that verifies the rig across packs | M1 can decide go / fallback with evidence |
| US-2 | P1 | maintainer | one command that builds optimized packs and manifests | the editor loads fast and assets stay consistent |
| US-3 | P1 | modder | to add a part by dropping a GLB and editing JSON | I contribute without writing engine code |
| US-4 | P1 | developer | small synthetic fixtures | tests run in CI without the Quaternius downloads |
| US-5 | P2 | maintainer | CI to block unlicensed or oversized assets | releases stay license-clean and within budget |

## Requirements

Script names (consistency review 2026-10-08): `pnpm assets:build`, `assets:check`, `assets:verify-rig`, `assets:licenses`, `assets:thumbnails` and `fixtures:build` are root package scripts (repository root `package.json`) and are the canonical names; a script whose milestone has not landed prints "not implemented (Mx)" and exits non-zero.

### Source packs

**REQ-AST-001 [P1]** THE SYSTEM SHALL read raw source packs only from folders under `assets-src/` (listed in `.gitignore`), one folder per pack at `assets-src/<dir>/`, and SHALL describe each expected source in a committed `tools/asset-sources.json` (pack ID, `dir`, name, vendor URL, version, tier, license, author, the folder tree hash `treeSha256` defined in REQ-AST-024, and optionally the original archive file name and its SHA-256). `dir` is the folder name relative to `assets-src/` (one path segment, no `..`, no `/` or `\`) and defaults to the pack ID. *(Amended 2026-10-08 (M1 D3): integrity is checked on the unzipped folder, not the archive; archive fields are informational. Amended 2026-10-08 (M1 PM rig update c): unzipped folders keep their vendor names and are mapped to pack IDs by `dir`, instead of being renamed to `assets-src/<packId>/`.)*

- **AC-AST-001.1** Given the repository, When `git check-ignore assets-src/x` runs, Then the path is ignored.
- **AC-AST-001.2** Given an unzipped source pack folder `assets-src/<dir>/` whose tree hash (REQ-AST-024) differs from `treeSha256` in `asset-sources.json`, When any asset tool that reads sources runs, Then it stops with `AST_SOURCE_HASH_MISMATCH` and exit code 2, naming the pack, the expected hash and the actual hash. *(Amended 2026-10-08 (M1 D3): was the archive SHA-256.)*
- **AC-AST-001.3** Given `assets-src/` is missing a listed pack, When a tool runs without `--pack`, Then it prints download instructions (vendor URL, tier, target folder) for that pack and exits with code 2. *(Amended 2026-10-09 (M1-33): the error code is `AST_SOURCE_MISSING`.)*

**REQ-AST-002 [P1]** THE SYSTEM SHALL accept glTF 2.0 (`.gltf`/`.glb`) sources only. Other source formats (FBX, BLEND) SHALL be converted by the contributor with Blender, following a documented recipe in `docs/contributing/assets.md`.

- **AC-AST-002.1** Given an `.fbx` file in a pack folder, When `build-parts` runs, Then it fails with `AST_SOURCE_FORMAT` naming the file and linking the conversion recipe.

### Rig verification (M1 spike)

**REQ-AST-003 [P1]** THE SYSTEM SHALL provide `pnpm assets:verify-rig` (`tools/verify-rig.ts`) that compares every skinned mesh and every animation in the selected packs against a canonical `RigDefinition` and checks: (a) bone name set; (b) parent of each bone; (c) inverse bind matrices per bone; (d) rest-pose local transforms; (e) armature root transform, unit scale and up axis; (f) joint count; (g) bone length axis (spec 002 `lengthAxis`); (h) for animations, that every track targets a canonical bone.

- **AC-AST-003.1** Given the fixture rig and a fixture part skinned to it, When verify-rig runs, Then the part's status is `pass`.
- **AC-AST-003.2** Given a fixture part with one renamed bone (`hand_r` → `Hand_R`), When verify-rig runs, Then status is `fail`, `missingBones` contains `hand_r` and `extraBones` contains `Hand_R`.
- **AC-AST-003.3** Given a fixture part whose `lowerarm_l` inverse bind translation differs by 2 mm, When verify-rig runs with default tolerances, Then status is `fail` with a `bindPose` issue for `lowerarm_l` showing `maxPosDelta ≈ 0.002`.

**REQ-AST-004 [P1]** THE SYSTEM SHALL use these default tolerances, overridable per run with flags and recorded in the report: position 1e-4 m, rotation 1e-3 rad (quaternion angle), scale 1e-4.

- **AC-AST-004.1** Given a 5e-5 m bind-pose difference, When verify-rig runs, Then status is `pass` and the delta is reported as a `info` item.

**REQ-AST-005 [P1]** WHEN verify-rig runs with `--write-canonical <file>` THE SYSTEM SHALL derive the canonical `RigDefinition` (bones in hierarchy order, root bone, `lengthAxis`) from that reference file and write it to `packages/parts-schema/rigs/<rigId>.json`. `anatomyBones` and `regionBones` SHALL come from a committed hand-edited overlay, `tools/rigs/<rigId>.overlay.json`. *(Amended 2026-10-08 (M1 D1, PM rig update a): `socketBones` also comes from the overlay; `skeletonGroups` rest poses are derived from the representative file of each group the overlay names, see REQ-AST-026.)*

- **AC-AST-005.1** Given the fixture body, When run with `--write-canonical`, Then the written rig JSON validates against the `RigDefinition` schema and lists bones parent-before-child.

*(Amended 2026-10-08 (M1-01c): the written rig JSON also holds `parents` (derived from the reference file: every joint's parent, `null` only for `rootBone`) and `defaultSkeletonGroup` (copied from the overlay; it SHALL name the overlay group whose representative file is the reference file), and it holds no `hipBone` and no top-level `joints` field. Validation rules are spec 002 REQ-ANA-021.)*

- **AC-AST-005.2** Given the fixture body as reference and an overlay with `defaultSkeletonGroup: 'g-a'` whose representative is that body, When run with `--write-canonical`, Then the written JSON has `parents` with one key per joint in `bones` equal to the reference file's glTF hierarchy, exactly one `null` (for `rootBone`), `defaultSkeletonGroup: 'g-a'`, and neither a `hipBone` nor a `joints` key. *(Added 2026-10-08 (M1-01c).)*
- **AC-AST-005.3** Given an overlay whose `defaultSkeletonGroup` is not one of its `skeletonGroups` keys, or names a group whose representative file is not the reference file, When run with `--write-canonical`, Then nothing is written and the command exits 2 naming `defaultSkeletonGroup`. *(Added 2026-10-08 (M1-01c).)*

**REQ-AST-006 [P1]** THE SYSTEM SHALL write the verification report as JSON (`assets/reports/rig-report.json`, schema below) and as Markdown (`assets/reports/rig-report.md`), and exit with code 0 when all items pass, 1 when any fails, and 2 on usage/source errors.

- **AC-AST-006.1** Given one failing file, When verify-rig runs, Then the exit code is 1, the JSON `summary.fail` is 1, and the Markdown has a table row for that file with status `fail` and its first 5 issues.
- **AC-AST-006.2** Given the same inputs run twice, When the reports are compared, Then they are byte-identical (no timestamps in the body; the run date comes from the `--date` flag or is omitted).

**REQ-AST-007 [P1]** WHEN the M1 spike completes THE SYSTEM SHALL have a committed report (`assets/reports/rig-report.json` and `.md`) and a decision record stating one outcome: **shared** (all packs pass: one `RigId` for all bundled assets), **mapped** (names or bind poses differ: a per-pack bone map for name differences; for bind-pose-only differences, skeleton groups (REQ-AST-026) with meshes rebound by bone name using their own inverse bind matrices and clips rest-pose corrected by the engine retargeter of spec 004 REQ-ANM-023), or **fallback** (switch the bundled set to KayKit Adventurers, CC0). *(Amended 2026-10-08 (M1 PM rig update a, b, d): the M1 spike reported **mapped**: bone names, hierarchy and `lengthAxis` are identical across 36 files, bind poses form 4 groups (max delta 0.107 m / 13.4°, scale identical). Rest-pose correction moves from spec 008 into M1 as the DOM-free `packages/engine/src/retarget/` module, which spec 008 reuses later.)*

- **AC-AST-007.1** Given the M1 milestone exit review, When `docs/adr/` is checked, Then an ADR records the outcome and links `assets/reports/rig-report.md`, and specs 001/002/004 have their *(M1-gated)* open questions resolved or re-scoped in the same PR.

*(Amended 2026-10-09 (M1-33): outcome final.)* The M1 outcome is **mapped**, final for the bundled packs `quaternius-ubc`, `quaternius-outfits` and `quaternius-ual`: one rig `quaternius-ue5-65`; skeleton groups `superhero-m`, `male`, `female` and `ual` (the rig's `defaultSkeletonGroup` is `superhero-m`); no bone map is needed (names match); the fallback to KayKit is not taken. The decision record is [ADR-0008](../docs/adr/0008-shared-rig-skeleton-groups-runtime-retarget.md), and the *(M1-gated)* open questions of specs 000, 001, 002 and 004 were resolved on 2026-10-09 (M1-33), which satisfies AC-AST-007.1 once ADR-0008 is merged. A later change of outcome (for example adding a pack that needs a bone map) needs a new ADR that supersedes ADR-0008 and a new report.

**REQ-AST-008 [P2]** WHERE verify-rig finds name mismatches THE SYSTEM SHALL suggest a bone map per failing file using the DOM-free auto-map heuristic of spec 008, written to the report as `suggestedBoneMap`.

- **AC-AST-008.1** Given the fixture with `Hand_R`, When verify-rig runs, Then `suggestedBoneMap` maps `Hand_R` → `hand_r`.

### Build: optimize, split, manifest

**REQ-AST-009 [P1]** THE SYSTEM SHALL provide `pnpm assets:build [--pack <id>]` (`tools/build-parts.ts`) that, driven by each pack's committed `tools/packs/<packId>/pack.config.json`, splits sources into one GLB per part and one GLB per clip (or per clip group) under `assets/packs/<packId>/`.

- **AC-AST-009.1** Given a fixture source GLB holding 3 outfit meshes and a config mapping node-name patterns to slots, When the build runs, Then 3 part GLBs are written, each containing one mesh, the skeleton it is skinned to, and its materials and textures only.
- **AC-AST-009.2** Given a config pattern matching no node, When the build runs, Then it fails with `AST_CONFIG_UNMATCHED` naming the pattern.

**REQ-AST-010 [P1]** THE SYSTEM SHALL optimize every output with `@gltf-transform` in this fixed order: `dedup` → `prune` → `weld` → `resample` (tolerance 1e-4) → texture resize (max 512² for parts and props, 1024² for bodies) → texture encoding as PNG → Meshopt compression (`EXT_meshopt_compression`). It SHALL NOT apply `join`, `flatten`, `instance`, `simplify`, Draco or KTX2/Basis (`KHR_texture_basisu`): the first five rename or merge nodes, change skinning or conflict with Meshopt; KTX2 is deferred (see below). *(Amended 2026-10-08 (M1 D2): the KTX2 step (ETC1S color, UASTC normals) is replaced by resized PNG for M1. Reason: the KTX2 encoder (`toktx`, KTX-Software) is not installable from npm, which breaks P-11 tooling, and three's `KTX2Loader` starts its transcoder in `blob:` workers, which the CSP `worker-src 'self'` (REQ-GEN-010) blocks. KTX2 may return only through a later amendment once a same-origin transcoder worker exists. Draco stays banned.)*

- **AC-AST-010.1** Given a built part, When inspected, Then it uses `EXT_meshopt_compression`, declares neither `KHR_texture_basisu` nor `KHR_draco_mesh_compression`, every `images[].mimeType` is `image/png` with width and height ≤ the REQ-AST-010 limit for its kind, and all node and bone names equal the source names (case-sensitive, e.g. `Head` stays `Head`). *(Amended 2026-10-08 (M1 D1, D2): was "uses `KHR_texture_basisu`".)*
- **AC-AST-010.2** Given a fixture clip, When resampled, Then every sampled bone transform at 30 Hz differs from the source by ≤ 1e-4 (position m, quaternion components).

*(Amended 2026-10-09 (M1-33), PM-accepted in M1-16.)* The sizes above are maxima. The bundled Quaternius packs are built with smaller limits: **512² for bodies and 256² for every other part and prop**, set in `tools/build-parts.ts`. Reason: the repository budget (built packs ≤ 30 MB in git, M1 R1; the M1 build is 18 MB in 80 files, the default set 3.74 MB). These sizes are enough for 32–128 px sprites, where a texel of a 256² texture is already below one output pixel. A community pack may use the maxima. Texture budget handling: a file with more than 4 textures (REQ-AST-016) drops secondary maps by kind, first normal maps, then occlusion, then metallic-roughness (each kind in material order), stopping as soon as 4 remain, and the build warns `AST_TEXTURES_DROPPED` with the counts before and after and the dropped maps; base color and emissive maps are never dropped, so a file still over 4 fails `assets:check` with `AST_BUDGET_TEXTURES`. An image referenced by a source glTF but missing from the source folder is dropped with warning `AST_SOURCE_IMAGE_MISSING`, and the build continues.

- **AC-AST-010.3** Given the bundled packs built by `pnpm assets:build`, When every built GLB is inspected, Then every image of a body part is ≤ 512 px on its longer side and every image of any other part or prop is ≤ 256 px. *(Added 2026-10-09 (M1-33).)*
- **AC-AST-010.4** Given a fixture source mesh whose material uses 5 textures (base color, normal, occlusion, metallic-roughness, emissive), When built, Then the output has 4 textures, the normal map is the one removed, base color and emissive are kept, and the build prints `AST_TEXTURES_DROPPED` naming the part with `before: 5, after: 4`. *(Added 2026-10-09 (M1-33).)*
- **AC-AST-010.5** Given a fixture `.gltf` source whose `images[0].uri` names a file that does not exist, When built, Then the build exits 0, prints `AST_SOURCE_IMAGE_MISSING` naming the URI, and the output contains no reference to that image. *(Added 2026-10-09 (M1-33).)*

**REQ-AST-011 [P1]** THE SYSTEM SHALL normalize outputs to meters, +Y up and the character facing +Z, and SHALL bake any armature-root transform so that `RigDefinition` bind poses hold. *(M1-gated: the source orientation is confirmed by verify-rig.)*

- **AC-AST-011.1** Given a fixture exported at 100× scale facing −Z, When built, Then the body's bounding box height is within 1 % of the reference and its forward vector is +Z.
- **AC-AST-011.2** Given a fixture whose armature root has scale `[1, 1, 1.01]` (non-uniform by more than 1e-4 relative), When built, Then the build bakes the uniform mean scale (cube root of the product, ≈ 1.00332), exits 0 and prints `AST_NORMALIZE_NONUNIFORM` naming the armature. *(Added 2026-10-09 (M1-33): the M1 build's handling of non-uniform armature scale; non-uniform scale cannot be baked into a skeleton without shear.)*

**REQ-AST-012 [P1]** THE SYSTEM SHALL write a per-vertex body-region attribute `_REGION` (unsigned byte, `BodyRegion` index as fixed by REQ-AST-025) on body parts, assigning each vertex to the region of its highest-weight joint via `RigDefinition.regionBones`, so the engine can hide regions (spec 001 REQ-CMP-011) without separate meshes.

- **AC-AST-012.1** Given the fixture body, When built, Then every vertex has a `_REGION` value, and vertices weighted ≥ 0.5 to `hand_l` carry the `hands` index.
- **AC-AST-012.2** Given a joint not listed in any `regionBones` entry, When built, Then the build fails with `AST_REGION_UNMAPPED` naming the joint.
- **AC-AST-012.3** Given a fixture body with a primitive that has no `JOINTS_0`/`WEIGHTS_0`, or a vertex whose 4 weights are all 0, When built, Then the build fails with `AST_REGION_UNWEIGHTED` naming the body (and the vertex index in the second case). *(Added 2026-10-09 (M1-33): the error code the M1 build uses when no highest-weight joint exists.)*

*(Amended 2026-10-09 (M1-33), PM decision H1 from the M1 review: region per triangle.)* The region is assigned per **triangle**, not per vertex, and `_REGION` is constant over each triangle: a triangle's region is the one with the largest summed joint weight over its three vertices (each vertex's weights are summed per region through `regionBones`); ties go to the lower `BODY_REGIONS` index. A vertex shared by triangles of different regions is duplicated, one copy per region, with every other attribute, morph target and skin weight copied; the index buffer is rewritten, so the vertex count can grow but the triangle count does not change. Reason: a per-vertex value is interpolated across a boundary triangle, which made the hide mask cut through triangles and leave slivers or holes. AC-AST-012.1 and AC-AST-025.1 read "triangles whose three vertices are weighted ≥ 0.5 to `hand_l`" instead of "vertices weighted ≥ 0.5 to `hand_l`".

- **AC-AST-012.4** Given the fixture body, When built, Then for every triangle the three `_REGION` values of its corners are equal, the triangle count equals the source's, and every vertex position of the source appears in the output. *(Added 2026-10-09 (M1-33).)*
- **AC-AST-012.5** Given a fixture triangle whose vertices have summed weights 1.2 to `lower-arms` joints and 1.8 to `hands` joints, and a neighbouring triangle sharing two of its vertices whose region is `lower-arms`, When built, Then the first triangle's corners hold 6 (`hands`), the second's hold 5, and each of the two shared vertices exists twice in the output (once per value) with identical position, normal, `JOINTS_0` and `WEIGHTS_0`. *(Added 2026-10-09 (M1-33).)*

**REQ-AST-013 [P1]** THE SYSTEM SHALL generate `assets/packs/<packId>/manifest.json` (`PartManifest`, spec 001) and, for animation packs, `clips.json` (`ClipManifest`, spec 004), filling computed fields (`file`, `rig`, `sha256`, `stats.triangles`, `stats.textures`, `durationSec`, `hasRootMotion`, `thumbnail`, `skeletonGroup`) from the outputs and authored fields (`id`, `name`, `slot`, `hides`, `tintSlots`, `alsoOccupies`, `bodyType(s)`, `bodies`, `characterSkeletonGroup`, `tags`, `socket`, `license`) from `pack.config.json`. The manifest embeds a copy of `packages/parts-schema/rigs/<rigId>.json` in `rigs[]`, and `assets:check` fails with `AST_MANIFEST_STALE` when the copy differs. *(Amended 2026-10-08 (M1 PM rig update a): `skeletonGroup`, `characterSkeletonGroup`, `bodies` and the embedded rig copy added; clip entries also get `sha256`, spec 004.)*

- **AC-AST-013.1** Given a build, When `manifest.json` is validated with `@csg/parts-schema`, Then it passes, and each entry's `sha256` equals the SHA-256 of its file.
- **AC-AST-013.2** Given `manifest.json` is edited by hand, When `pnpm assets:check` runs, Then it fails with `AST_MANIFEST_STALE` and says to edit `pack.config.json` instead.
- **AC-AST-013.3** Given a `pack.config.json` whose `rig` names a rig with no file `packages/parts-schema/rigs/<rigId>.json`, When `pnpm assets:build` runs, Then it exits 2 with `AST_RIG_MISSING` naming the rig ID and the expected path; When `pnpm assets:check` runs, Then it fails with `AST_RIG_MISSING` for that pack. *(Added 2026-10-09 (M1-33).)*

**REQ-AST-014 [P1]** THE SYSTEM SHALL make builds deterministic: running the build twice on the same sources with the same tool versions SHALL produce byte-identical outputs (single-threaded texture encoding, sorted iteration, no timestamps).

- **AC-AST-014.1** Given the fixture sources, When the build runs twice in clean folders, Then every output file's SHA-256 matches.

**REQ-AST-015 [P2]** THE SYSTEM SHALL render a 128×128 px WebP thumbnail per part (part on the pack's reference body, three-quarter camera, toon material, transparent background) and per character preset, with `pnpm assets:thumbnails`, using Playwright Chromium with `forceWebGL`.

- **AC-AST-015.1** Given a built pack, When thumbnails run, Then each part has `thumbnails/<partId>.webp` of exactly 128×128 px and ≤ 12 KB, and the manifest `thumbnail` field points to it.
- **AC-AST-015.2** Given a static prop, When its thumbnail is rendered, Then the prop is shown alone and framed to fill ≥ 60 % of the image height.

*(Amended 2026-10-09 (M3-21), recording the thumbnails as built: `tools/thumbnails.ts`, `tools/lib/thumbnails/*`, `tools/lib/check/thumbnails.ts`.)* The format is settled as lossless WebP, verified pixel-exact against the render (REQ-AST-040, REQ-AST-041). "128×128 px" is a 64 px render cell upscaled ×2 with nearest neighbour; looks and body shapes are 64×64 (REQ-AST-042). "The pack's reference body" means the default character's body when the part fits it, else the first fitting built body by reference, framed per slot (REQ-AST-045). "Toon material" means the full export pixel pipeline under the default look `classic-16bit` (REQ-AST-043). The camera is three-quarter for parts, looks and body shapes; a character preset uses its own `camera` (default `side`), not three-quarter (REQ-AST-043). Files are installed only from a render in the canonical golden container, not from any host with Playwright Chromium (REQ-AST-044). The generated `thumbnails/index.json` (REQ-AST-046), the check codes `AST_THUMBNAIL_STALE` (REQ-AST-047) and `AST_THUMBNAIL_INVALID` (REQ-AST-048), and the removal of unplanned thumbnails (REQ-AST-049) are new. AC-AST-015.2 conflicts with the build for props: see Open questions.

### Budgets, licensing and integrity

**REQ-AST-016 [P1]** THE SYSTEM SHALL enforce per-file budgets on built outputs: bodies ≤ 20,000 triangles, skinned parts ≤ 10,000, static props ≤ 5,000; ≤ 4 textures per file; ≤ 4 joint influences per vertex; and the default character plus its default clips ≤ 15 MB total transfer size.

- **AC-AST-016.1** Given a fixture part with 10,001 triangles, When `assets:check` runs, Then it fails with `AST_BUDGET_TRIANGLES` naming the part and the limit.
- **AC-AST-016.2** Given the default `CharacterSpec` (spec 001) and default clips, When the sizes of their files are summed, Then the total is ≤ 15 MB (architecture §4.3).

*(Amended 2026-10-09 (M1-33), recording the M1 implementation.)* `assets:check` reports a default set over 15 MB as error `AST_BUDGET_SIZE` (the default set is the 7 part files and 2 clip files of spec 001 Data & contracts; 3.74 MB in M1). `assets:build` additionally warns `AST_BUDGET_FILE_SIZE` for any single built file over 3 MiB (3,145,728 bytes), a repository-size guard (M1 R1: built packs ≤ 30 MB in git) that does not fail the build.

- **AC-AST-016.3** Given a built clip of 3,145,729 bytes, When `pnpm assets:build` runs, Then it exits 0 and prints `AST_BUDGET_FILE_SIZE` naming the clip ID, its size and the 3,145,728-byte limit. *(Added 2026-10-09 (M1-33).)*

**REQ-AST-017 [P1]** THE SYSTEM SHALL require a license record (`license`, `author`, `sourceUrl`) for every pack and accept only `CC0-1.0` or `CC-BY-4.0` for bundled assets; any other license SHALL fail the check (P-02, REQ-GEN-008).

- **AC-AST-017.1** Given a pack config with license `CC-BY-SA-4.0`, When `assets:check` runs, Then it fails with `AST_LICENSE_NOT_ALLOWED`.
- **AC-AST-017.2** Given a part with a `license` override lacking `author`, When validated, Then validation fails naming the part ID and `author`.

**REQ-AST-018 [P1]** THE SYSTEM SHALL generate the bundled-assets section of `ASSETS_LICENSE.md` from the manifests (`pnpm assets:licenses`), and CI SHALL fail when the committed file differs from the generated one.

- **AC-AST-018.1** Given a new pack added without regenerating, When CI runs, Then the job fails with a diff showing the missing pack entry.

**REQ-AST-019 [P1]** THE SYSTEM SHALL keep IDs stable: a part or clip ID removed from a manifest SHALL be listed in `assets/packs/<packId>/retired-ids.json`, and a retired ID SHALL never be reused.

- **AC-AST-019.1** Given a part ID removed from `pack.config.json` but not added to `retired-ids.json`, When `assets:check` runs, Then it fails with `AST_ID_REMOVED` naming the ID.
- **AC-AST-019.2** Given a new part whose ID is in `retired-ids.json`, When checked, Then it fails with `AST_ID_REUSED`.
- **AC-AST-019.3** Given a `retired-ids.json` that is not `{"format": "sprite-retired-ids", "version": 1, "ids": [<strings>]}` (e.g. a bare array, or `{"parts": [...]}`), When `pnpm assets:check` runs, Then it fails with `AST_RETIRED_IDS_INVALID` naming the pack. *(Added 2026-10-09 (M1-33): file format fixed in Data & contracts.)*

**REQ-AST-020 [P1]** THE SYSTEM SHALL provide `pnpm assets:check`, which runs without `assets-src/` and validates all built packs: schema validity, files exist and hashes match, no orphan files, budgets (REQ-AST-016), licenses (REQ-AST-017, -018), ID stability (REQ-AST-019), every skinned part and clip against its committed `RigDefinition` (verify-rig in `--built` mode), and thumbnails present (missing = warning).

- **AC-AST-020.1** Given a clean checkout without `assets-src/`, When `pnpm assets:check` runs in CI, Then it completes in ≤ 60 s for the bundled packs and exits 0.
- **AC-AST-020.2** Given an orphan file `assets/packs/x/unused.glb`, When checked, Then it fails with `AST_ORPHAN_FILE`.

### Test fixtures

**REQ-AST-021 [P1]** THE SYSTEM SHALL generate synthetic test fixtures with `pnpm fixtures:build` (`tools/fixtures/make-fixtures.ts`), committed under `packages/*/test/fixtures/`, using the canonical bone names: a box-segment body (one box per body region), a shirt part, a static sword prop, a 1.0 s clip with known keyframes (including root motion), a mismatched-rig part, malformed manifests and character specs, totalling ≤ 300 KB.

- **AC-AST-021.1** Given the fixtures, When the full test suite runs in CI without `assets-src/` or built Quaternius packs, Then all engine, schema and tool tests that do not need real art pass.
- **AC-AST-021.2** Given the fixture clip, When `lowerarm_l` is sampled at t = 0.5 s, Then its rotation equals the documented keyframe value (± 1e-6).

### Community contributions

**REQ-AST-022 [P1]** THE SYSTEM SHALL let a contributor add a part to a pack, or a new community pack, with data and GLB files only: put source GLB(s) in `tools/packs/<packId>/src/` (committed, community packs only) or `assets-src/`, describe parts in `pack.config.json`, then run `pnpm assets:build --pack <id>` and `pnpm assets:check`. No TypeScript change SHALL be needed.

- **AC-AST-022.1** Given a new community pack `community-hats` with one hat GLB skinned to the canonical rig and a valid config, When the two commands run, Then the hat appears in the `headwear` picker after `pnpm dev` with no source-code diff outside `tools/packs/community-hats/` and `assets/packs/community-hats/`.
- **AC-AST-022.2** Given the contributor's GLB is skinned to a different rig, When the build runs, Then it fails with `AST_RIG_MISMATCH` and the verify-rig issue list, and the docs link explains how to re-skin in Blender. *(Amended 2026-10-08 (M1 PM rig update a): "different rig" means a structural difference per REQ-AST-026; a bind-pose-only difference is not a failure.)*

**REQ-AST-023 [P2]** THE SYSTEM SHALL provide a pull-request checklist item and a `docs/contributing/assets.md` guide covering: license requirements, Blender export settings (glTF, +Y up, meters, canonical bone names, ≤ 4 influences), pack config fields, budgets and the commands above.

- **AC-AST-023.1** Given the PR template, When a PR touches `assets/` or `tools/packs/`, Then the asset checklist section is present (verified by a template lint).

### M1 amendments (2026-10-08)

**REQ-AST-024 [P1]** THE SYSTEM SHALL compute a source folder's tree hash as follows (M1 D3): list every regular file under `assets-src/<dir>/` recursively, including hidden files; for each, form the line `<relPath>` + U+0000 + `<sha256>` + U+000A, where `relPath` is the path relative to the folder with `/` separators on every OS and `sha256` is the lowercase hex SHA-256 of the file bytes; sort the lines by `relPath` compared as UTF-8 byte sequences; `treeSha256` is the lowercase hex SHA-256 of the concatenated lines. Empty directories SHALL NOT contribute. IF the folder contains a symbolic link or another non-regular entry THEN THE SYSTEM SHALL not follow it and SHALL stop with `AST_SOURCE_FORMAT` naming the entry.

- **AC-AST-024.1** Given a fixture folder with `a.txt` = `a` and `sub/b.txt` = `b` (no trailing newlines), When the tree hash is computed, Then it equals the SHA-256 of `a.txt\0<sha256("a")>\nsub/b.txt\0<sha256("b")>\n`, and creating the same files in the opposite order gives the same hash.
- **AC-AST-024.2** Given that fixture, When one byte of `sub/b.txt` changes, or the file is renamed to `sub/c.txt`, or an empty directory is added, Then the hash changes in the first two cases and is unchanged in the third.
- **AC-AST-024.3** Given a fixture folder containing a symbolic link, When the tree hash is computed, Then it stops with `AST_SOURCE_FORMAT` naming the link and the link target is not read.

**REQ-AST-025 [P1]** THE SYSTEM SHALL encode `_REGION` (REQ-AST-012) as a non-normalized `SCALAR` accessor of component type `UNSIGNED_BYTE` (5121) whose value is the index of the region in the single `BODY_REGIONS` constant exported by `@csg/parts-schema`: `head` 0, `hair` 1, `neck` 2, `torso` 3, `upper-arms` 4, `lower-arms` 5, `hands` 6, `pelvis` 7, `upper-legs` 8, `lower-legs` 9, `feet` 10. The build tools and the engine (region-hide mask bit `i` = `BODY_REGIONS[i]`) SHALL both import this constant; new regions SHALL only be appended, and reordering requires a spec amendment and a rebuild of every pack.

- **AC-AST-025.1** Given the fixture body, When built, Then the `_REGION` accessor has `componentType` 5121, `type` `SCALAR`, `normalized` absent or false, and vertices weighted ≥ 0.5 to `hand_l` hold value 6.
- **AC-AST-025.2** Given `BODY_REGIONS`, When the engine computes the hide mask for `['hands', 'feet']`, Then the mask is `1088` (bit 6 + bit 10).
*(Amended 2026-10-09 (M1-33).)* The encoding is unchanged; the values are constant per triangle (REQ-AST-012 amendment), so the engine's `regionId` (REQ-AST-028) is the same at all three corners of a triangle and the hide test never sees an interpolated region value.

- **AC-AST-025.3** Given a built body whose `_REGION` holds a value ≥ 11, When `pnpm assets:check` runs, Then it fails with `AST_REGION_INVALID` naming the part and the number of invalid vertices.

**REQ-AST-026 [P1]** THE SYSTEM SHALL classify every skinned mesh and clip whose bone names, parents, joint count, `lengthAxis`, armature root transform, unit scale, up axis and clip targets match the `RigDefinition` (REQ-AST-003 a, b, e–h, "structurally compatible") into the rig's **skeleton groups**: sets of files whose rest poses agree within the REQ-AST-004 tolerances. In `assets:build` and in `assets:check` (verify-rig `--built` mode), a bind-pose difference between a structurally compatible file and the reference SHALL be reported as `warn` naming the file's skeleton group, and SHALL NOT fail the command; a structural difference SHALL fail with `AST_RIG_MISMATCH`. Standalone `pnpm assets:verify-rig` keeps per-item statuses against the reference file (AC-AST-003.3) and reports the groups and the outcome `mapped`. *(Added 2026-10-08, M1 PM rig update a.)*

- **AC-AST-026.1** Given the fixture rig with skeleton groups `g-a` and `g-b` (`g-b` differs only in the `pelvis` rest translation by 0.05 m), a body in `g-a` and a shirt in `g-b`, When `pnpm assets:build` and `pnpm assets:check` run, Then both exit 0, the shirt's manifest entry has `skeletonGroup: 'g-b'`, and the check output has a `warn` line for the shirt naming `g-b` and `pelvis`.
- **AC-AST-026.2** Given the same fixture with one shirt bone renamed (`hand_r` → `Hand_R`), When `pnpm assets:build` runs, Then it fails with `AST_RIG_MISMATCH` (REQ-AST-022 AC-AST-022.2).
- **AC-AST-026.3** Given verify-rig `--write-canonical` on the fixtures, When the rig JSON is written, Then `skeletonGroups` holds one entry per group whose ID comes from the overlay, with a rest-pose local transform (translation, rotation quaternion, scale) for every bone in `bones`.
- **AC-AST-026.4** Given a structurally compatible part whose rest pose matches no declared group, When built, Then the build succeeds with warning `AST_SKELETON_GROUP_UNMATCHED` naming the part, and its manifest entry has no `skeletonGroup`.
- **AC-AST-026.5** Given the committed `assets/reports/rig-report.json`, When validated, Then it has `outcome`, `referenceFile` and `skeletonGroups`, and every `skinned-mesh` item's file appears in exactly one group.

*(Amended 2026-10-09 (M1-33), matching the M1 implementation and spec 004's required `ClipEntry.skeletonGroup`.)* AC-AST-026.4 applies to parts only. A structurally compatible **clip** whose rest pose matches no declared group (or matches more than one, which is treated as no match) is recorded with `skeletonGroup` = `RigDefinition.defaultSkeletonGroup`, and the build warns `AST_CLIP_GROUP_DEFAULTED` naming the clip and the recorded group; the build continues. All 43 bundled UAL clips match group `ual`.

- **AC-AST-026.6** Given a fixture clip whose rest pose matches neither `g-a` nor `g-b`, When built, Then the build exits 0, prints `AST_CLIP_GROUP_DEFAULTED` naming the clip and `g-a` (the fixture rig's `defaultSkeletonGroup`), and the clip's `clips.json` entry has `skeletonGroup: 'g-a'`. *(Added 2026-10-09 (M1-33).)*

**REQ-AST-027 [P1]** WHEN a source mesh has vertices with more than 4 non-zero joint influences THE SYSTEM SHALL keep the 4 largest weights per vertex (ties broken by the lower joint index), renormalize them to sum 1 (± 1e-6 before quantization), write a single `JOINTS_0`/`WEIGHTS_0` set, and emit the warning `AST_INFLUENCES_LIMITED` naming the part and the number of affected vertices; the build SHALL continue. *(Added 2026-10-08, M1 PM rig update e: two Female_Ranger meshes have 5 influences.)*

- **AC-AST-027.1** Given a fixture vertex with weights `[0.4, 0.3, 0.15, 0.1, 0.05]`, When built, Then its weights are `[0.4, 0.3, 0.15, 0.1] / 0.95` (± 1e-6 before quantization), the build exits 0 and prints `AST_INFLUENCES_LIMITED` with count 1.
- **AC-AST-027.2** Given that built part, When `pnpm assets:check` runs, Then no `AST_BUDGET_INFLUENCES` error is reported for it.

**REQ-AST-028 [P1]** WHEN the engine loads a body part THE SYSTEM SHALL convert its `_REGION` attribute (exposed by three's `GLTFLoader` as `_region`, because it lowercases custom attribute names) to a single-component Float32 vertex attribute `regionId` with the same integer values, SHALL drop `_region` from the geometry, and SHALL read only `regionId` in shaders, so region hides work on WebGPU and WebGL2 alike. The file format stays `UNSIGNED_BYTE` (REQ-AST-025). Reason: single-component 8-bit vertex formats (`uint8`) are recent in WebGPU (Chrome 133) and are not assumed. IF a body part has no `_REGION` attribute THEN loading SHALL fail with `CMP_PART_LOAD_FAILED` and `details.reason: 'region-missing'`. *(Added 2026-10-08, M1 plan R3.)*

- **AC-AST-028.1** Given the fixture body loaded through the engine loader in Node, When its geometry is inspected, Then `regionId` is a `Float32Array` attribute with `itemSize` 1 whose values equal the file's `_REGION` values, and no `_region` attribute remains.
- **AC-AST-028.2** Given the fixture body with a torso part that hides `torso`, When rendered unlit on WebGPU and on WebGL2 (`forceWebGL`), Then on both backends no pixel of the body's torso region is drawn.
- **AC-AST-028.3** Given a fixture body without `_REGION`, When loaded, Then the result is `CMP_PART_LOAD_FAILED` with `details.reason` `'region-missing'`.

**REQ-AST-029 [P1]** THE SYSTEM SHALL load bundled pack GLBs with a glTF loader that registers only the Meshopt decoder (no Draco, no KTX2), runs it on the calling thread without starting workers, and loads it from the app's own origin (REQ-GEN-010). IF a bundled GLB declares `KHR_draco_mesh_compression` or `KHR_texture_basisu` THEN THE SYSTEM SHALL refuse it with `CMP_PART_LOAD_FAILED` (parts) or `ANM_CLIP_LOAD_FAILED` (clips, spec 004 REQ-ANM-022) and `details.reason: 'extension-not-allowed'`. *(Added 2026-10-08, M1 D2.)*

- **AC-AST-029.1** Given the production build with the CSP of REQ-GEN-010, When the E2E smoke loads the default character and clips, Then no CSP violation is reported, no `Worker` is constructed by the loader, and no Draco or Basis decoder file is requested.
- **AC-AST-029.2** Given a fixture part GLB declaring `KHR_texture_basisu`, When it is resolved as a bundled part, Then the result is `CMP_PART_LOAD_FAILED` with `details.reason` `'extension-not-allowed'`.

### M3 amendments (2026-10-09): sole offset (GitHub issue #10)

The engine grounds characters on the lowest feet joint plus a per-skeleton-group sole offset (spec 002 REQ-ANA-008, amended M3-00), so that it never reads mesh vertices at runtime. The pipeline measures that offset once, from the built meshes, and stores it in the rig JSON. Definitions used by REQ-AST-030 to REQ-AST-034, for a rig `R` and one of its skeleton groups `G`:

- **Measured bodies `B(G)`**: every built manifest entry in slot `body` on rig `R`, in any pack under `assets/packs/`, whose character skeleton group (spec 001 REQ-CMP-037: `characterSkeletonGroup`, else `skeletonGroup`, else `R.defaultSkeletonGroup`) is `G`.
- **Measured feet parts `F(G)`**: every built skinned entry in slot `feet` on rig `R` that is compatible (spec 001 REQ-CMP-008 rules (a)–(c)) with at least one body in `B(G)`.
- **Rest-pose position** of a vertex: linear blend skinning of its built position with its own `JOINTS_0`/`WEIGHTS_0` and the mesh's own inverse bind matrices onto the world matrices of `G.restPose` (the rebinding of spec 001 REQ-CMP-037), default anatomy, no clip, no morph weights, float64 arithmetic, joints visited in `R.bones` order.
- **`jointMinY(G)`**: the lowest world Y among the joints in `R.anatomyBones.feet` and their descendants in `G.restPose` (spec 002 REQ-ANA-008 joint term at default anatomy).
- **`bodySoleY(G)`**: the lowest rest-pose Y over the corners of every triangle of a body in `B(G)` whose `_REGION` is `feet` (index 10, REQ-AST-025). **`partSoleY(G)`**: the lowest rest-pose Y over all vertices of the parts in `F(G)` (absent when `F(G)` is empty). **`soleMinY(G)`** = the lower of the two.

**REQ-AST-030 [P1]** WHEN `pnpm assets:build` runs THE SYSTEM SHALL, after writing the part GLBs and before writing any manifest, compute for every skeleton group `G` of every rig used by a built pack, with `B(G)` not empty, `soleOffsetM = q(jointMinY(G) − soleMinY(G))`, where `q` rounds to the nearest 0.0001 m with halves away from zero, and SHALL write it to `skeletonGroups[G].soleOffsetM` of `packages/parts-schema/rigs/<rigId>.json`, omitting the field for groups with an empty `B(G)`. The measurement SHALL cover every built pack under `assets/packs/` that uses the rig, also under `--pack`; WHEN a stored value changes THE SYSTEM SHALL rewrite the rig JSON and the embedded rig copy (`rigs[]`, REQ-AST-013) of every manifest that embeds that rig, and nothing else in those manifests.

- **AC-AST-030.1** Given the fixture rig (lowest feet joint of `g-a` at rest y = 0), a fixture body in `g-a` whose lowest `feet`-region vertex rests at y = −0.02 m and a fixture `feet` part fitting it whose lowest vertex rests at y = −0.0251 m, When `pnpm assets:build` runs, Then `g-a.soleOffsetM` is `0.0251`, `g-b` (no measured body) has no `soleOffsetM`, and the build exits 0.
- **AC-AST-030.2** Given the same fixture with the `feet` part removed, When built, Then `g-a.soleOffsetM` is `0.02`; Given a fixture body whose `feet`-region lowest vertex rests at y = −0.01237 m, Then the value is `0.0124`.
- **AC-AST-030.3** Given the fixtures built twice in clean folders, and once with `--pack` for a second fixture pack that holds the `feet` part, When the rig JSON files are compared, Then all three are byte-identical, and the second fixture pack's manifest `rigs[]` copy equals the rig JSON (no `AST_MANIFEST_STALE` in `assets:check`).
- **AC-AST-030.4** Given the bundled packs, When built, Then groups `male` and `female` each have a `soleOffsetM` between 0.010 and 0.040 m (FX-G measured about 0.019 to 0.025 m from the bodies alone), and groups `superhero-m` and `ual`, which drive no bundled body, have none.

**REQ-AST-031 [P2]** IF, during REQ-AST-030, both `bodySoleY(G)` and `partSoleY(G)` exist and differ by more than 0.010 m THEN THE SYSTEM SHALL warn `AST_SOLE_SPREAD` naming the group, the lowest part (or body) and the difference in metres, and continue. Reason: one value per group serves bare feet and every shoe, so the higher of the two hovers by that difference (spec 002 REQ-ANA-008); 0.010 m is below half an output pixel of the default character at 64 px.

- **AC-AST-031.1** Given the fixture of AC-AST-030.1 with the `feet` part's lowest vertex moved to y = −0.0351 m (0.0151 m below the body sole), When built, Then the build exits 0, `g-a.soleOffsetM` is `0.0351`, and `AST_SOLE_SPREAD` names `g-a`, that part and `0.0151`.
- **AC-AST-031.2** Given the fixture of AC-AST-030.1 unchanged (difference 0.0051 m), When built, Then no `AST_SOLE_SPREAD` is printed.

**REQ-AST-032 [P1]** WHEN `pnpm assets:check` runs (verify-rig `--built` mode, REQ-AST-020) THE SYSTEM SHALL recompute `soleOffsetM` per REQ-AST-030 from the built packs and fail with `AST_SOLE_OFFSET_STALE`, naming the rig, the group, the stored and the recomputed value, WHEN a stored value differs from the recomputed one by more than 0.0001 m (compared as integers `round(v × 10000)`, so a difference of exactly one step passes; it absorbs cross-platform float differences at a rounding boundary), a group with a non-empty `B(G)` has no stored value, or a group with an empty `B(G)` has one.

- **AC-AST-032.1** Given the built fixtures with `g-a.soleOffsetM` hand-edited from `0.0251` to `0.0240` in the rig JSON and in the manifest copy, When `pnpm assets:check` runs, Then it fails with `AST_SOLE_OFFSET_STALE` naming `g-a`, `0.024` and `0.0251`; Given the value `0.0252`, Then it passes.
- **AC-AST-032.2** Given the built fixtures with `g-a.soleOffsetM` removed, or with `g-b.soleOffsetM: 0.01` added (in the rig JSON and in the manifest copy), When `pnpm assets:check` runs, Then it fails with `AST_SOLE_OFFSET_STALE` naming `g-a` or `g-b` respectively.

**REQ-AST-033 [P1]** IF, during REQ-AST-030, the computed `soleOffsetM` of a group is outside −0.1…0.1 m (spec 002 REQ-ANA-021 rule f), or cannot be computed because `B(G)` is not empty, no body in it has a `feet`-region triangle and `F(G)` is empty, THEN THE SYSTEM SHALL fail with `AST_SOLE_OFFSET_RANGE` naming the group and the value (or `none`), exit 1, and leave the rig JSON and every manifest unchanged.

- **AC-AST-033.1** Given a fixture body whose lowest `feet`-region vertex rests 0.15 m below the lowest feet joint, When built, Then the build exits 1 with `AST_SOLE_OFFSET_RANGE` naming `g-a` and `0.15`, and the rig JSON is byte-identical to before.
- **AC-AST-033.2** Given a fixture body in `g-a` with no `feet`-region triangle and no fitting `feet` part, When built, Then the build exits 1 with `AST_SOLE_OFFSET_RANGE` naming `g-a` and `none`.

**REQ-AST-034 [P1]** WHEN `pnpm assets:verify-rig --write-canonical` rewrites a rig JSON (REQ-AST-005) THE SYSTEM SHALL keep the existing `soleOffsetM` of every skeleton group whose ID it writes again, and drop it for groups it no longer writes.

- **AC-AST-034.1** Given the built fixtures with `g-a.soleOffsetM: 0.0251`, When `assets:verify-rig --write-canonical` rewrites the fixture rig, Then `g-a.soleOffsetM` is still `0.0251` and `pnpm assets:check` exits 0.

### M3 amendments (2026-10-09): preset and thumbnail layout

*(Added 2026-10-09, M3 PM decision, recording the M3 build: `tools/lib/build/presets.ts`, `tools/lib/check/presets.ts`, `packages/parts-schema/src/presets.ts`.)* Preset data (spec 002 REQ-ANA-013, -022, -024; spec 014 REQ-UX-060, -062, -103; spec 006 REQ-EDT-044 (~~REQ-EXP-044~~ written in error in this draft, 2026-10-09: no such ID exists); spec 001 REQ-CMP-027) is pack data like parts (P-11). It is authored under `tools/packs/<packId>/presets/<folder>/<name>.json` and copied by `assets:build` to `assets/packs/<packId>/presets/<folder>/<name>.json`. Folders and kinds, in index order:

| Kind (`PresetFileKind`) | Folder | Schema (`@csg/parts-schema`) | Identifier field |
|---|---|---|---|
| `anatomy-preset` | `presets/anatomy/` | `anatomyPresetSchema` | `id` |
| `body-shape` | `presets/body-shapes/` | `bodyShapePresetSchema` | `id` |
| `style` | `presets/styles/` | `styleDefinitionSchema` (+ `validateStyleDefinitions`) | `style` |
| `easy-category` | `presets/categories/` | `easyCategoryDefSchema` | `id` |
| `swatch-set` | `presets/swatches/` | `swatchSetDefSchema` | `id` |
| `character` | `presets/characters/` | `parseCharacterPreset` (migrates the embedded `CharacterSpec` first) | `id` |
| `look` | `presets/looks/` | `lookPresetSchema` | `id` |

Because browsers cannot list folders, the build also writes `presets/index.json` (`presetIndexSchema`, Data & contracts), which the editor's catalog reads.

**REQ-AST-035 [P1]** WHEN `pnpm assets:build` runs for a pack that has authored preset files THE SYSTEM SHALL validate every file and fail with `AST_PRESET_INVALID` (exit 1), listing every finding with its pack-relative path, IF any file is not valid JSON, fails the schema of its folder's kind, has an identifier field (table above) that differs from its file name without `.json`, repeats an identifier already used by another file of the same kind, breaks the cross-file style rules of spec 002 REQ-ANA-024 (`validateStyleDefinitions`), or is a look whose `palette.id` is `custom` without a `paletteSource` holding non-empty `name`, `author`, `license` and an `http(s)` `sourceUrl` (P-02). Only `.json` files directly in the seven folders are read; other files are ignored.

- **AC-AST-035.1** Given a fixture pack whose `presets/body-shapes/slim.json` has `"id": "thin"`, When `pnpm assets:build` runs, Then it exits 1 with `AST_PRESET_INVALID` naming `presets/body-shapes/slim.json`, `thin` and `slim`.
- **AC-AST-035.2** Given a fixture pack with two `presets/looks/*.json` files that both validate and a third look that is otherwise valid but has `palette: { "id": "custom", "colors": ["#000000"] }` and no `paletteSource`, When built, Then the build exits 1 with exactly one `AST_PRESET_INVALID` finding, naming the third file and `paletteSource`.
- **AC-AST-035.3** Given a fixture pack with a style file whose `anatomyPreset` names no file in `presets/anatomy/`, When built, Then it exits 1 with `AST_PRESET_INVALID` naming the style, `anatomyPreset` and the unknown preset ID.

**REQ-AST-036 [P1]** WHEN the preset files of a pack are valid THE SYSTEM SHALL replace `assets/packs/<packId>/presets/` with a copy of every authored file at the same pack-relative path (2-space JSON, key order kept, trailing LF) and a `presets/index.json` that lists each file once as `{ kind, path }`, sorted by kind in the table order and then by path (code-unit order), written as canonical JSON; WHEN the pack has no authored preset files THE SYSTEM SHALL remove `presets/` from the output and write no index.

- **AC-AST-036.1** Given a fixture pack with `presets/looks/b.json`, `presets/anatomy/z.json` and `presets/looks/a.json`, When built twice in clean folders, Then `presets/index.json` lists the paths in the order `presets/anatomy/z.json`, `presets/looks/a.json`, `presets/looks/b.json`, validates with `presetIndexSchema`, and every output file is byte-identical between the two runs (REQ-AST-014).
- **AC-AST-036.2** Given a built pack with `presets/`, When its `tools/packs/<packId>/presets/` folder is deleted and the pack is rebuilt, Then `assets/packs/<packId>/presets/` no longer exists.

**REQ-AST-037 [P1]** WHEN `pnpm assets:check` runs THE SYSTEM SHALL, for every built pack that has `presets/index.json`, fail with `AST_PRESET_INVALID` IF the index fails `presetIndexSchema`, an entry's path is not in its kind's folder, a listed file is missing or is not valid JSON, or the listed files fail the REQ-AST-035 rules; SHALL fail with `AST_MANIFEST_STALE` IF the built preset files differ from the authored sources (when `tools/packs/<packId>/presets/` exists); and SHALL count `presets/index.json`, every listed file and every present preset thumbnail (REQ-AST-039) as referenced, so none is an `AST_ORPHAN_FILE`.

- **AC-AST-037.1** Given a built fixture pack whose `presets/index.json` lists `presets/anatomy/x.json` with kind `look`, When `pnpm assets:check` runs, Then it fails with `AST_PRESET_INVALID` naming that path and kind `look`.
- **AC-AST-037.2** Given a built fixture pack, When one built preset file is edited by hand, Then `pnpm assets:check` fails with `AST_MANIFEST_STALE` for the pack and tells the user to edit `tools/packs/<packId>/presets` and run `pnpm assets:build`; When the same pack is checked unedited, Then no `AST_ORPHAN_FILE` is reported for any file under `presets/`.

**REQ-AST-038 [P1]** WHEN `pnpm assets:check` runs THE SYSTEM SHALL fail with `AST_PRESET_REF`, naming the pack, the preset or category ID and the reference, IF a character preset's `character.style` has no style file in any built pack, its `character.body.ref` is not a built part in slot `body`, any `character.parts.<slot>.ref` does not start with `builtin:`, is not a built part, is a part of another slot, or does not fit the body (spec 001 REQ-CMP-008), or an Easy category lists a slot that is not in the slot registry (`SLOT_REGISTRY`). References are resolved across all built packs. This check is the pipeline side of spec 014 REQ-UX-103.

- **AC-AST-038.1** Given a fixture character preset on body `builtin:quaternius-ubc/superhero-m` with a female outfit torso, an unknown `legs` ref and a `feet` ref `user:abc#boots`, When checked, Then exactly 3 `AST_PRESET_REF` errors are reported, one of them containing "does not fit body".
- **AC-AST-038.2** Given a fixture `presets/categories/hair.json` listing slot `not-a-slot`, which is not in the slot registry, When checked, Then `AST_PRESET_REF` names `hair` and `not-a-slot`.

**REQ-AST-039 [P2]** THE SYSTEM SHALL place preset thumbnails at fixed pack-relative paths beside the part thumbnails of REQ-AST-015: `thumbnails/characters/<id>.webp` per character preset, the path in a look preset's `thumbnail` field (shipped looks use `thumbnails/looks/<id>.webp`), and `thumbnails/shapes/<style>/<id>.webp` per body-shape preset and style; WHEN `pnpm assets:check` runs THE SYSTEM SHALL warn `AST_THUMBNAIL_MISSING`, naming the preset ID and the path, for every character or look preset whose thumbnail file is absent, and continue. *(Image format: WebP, or PNG, as chosen by REQ-AST-015's implementation; see the build. The look schema already accepts a PNG or WebP path. The thumbnails task was in progress when this was recorded; if it settles on PNG, the extensions above change by dated amendment.)*

- **AC-AST-039.1** Given a built fixture pack with character preset `knight` and no `thumbnails/characters/knight.webp`, When `pnpm assets:check` runs, Then it exits 0 and prints `AST_THUMBNAIL_MISSING` naming `knight` and `thumbnails/characters/knight.webp`; When the file is added, Then no warning is printed and the file is not an `AST_ORPHAN_FILE`.
- **AC-AST-039.2** Given the bundled `quaternius-ubc` pack, When its look presets are read, Then every `thumbnail` field equals `thumbnails/looks/<id>.webp` for the look's own `id`.
- **AC-AST-039.3** Given a built fixture pack with style `chibi` and body-shape preset `slim` after `pnpm assets:thumbnails`, When `pnpm assets:check` runs, Then `thumbnails/shapes/chibi/slim.webp` exists and is not reported as `AST_ORPHAN_FILE`.

*(Amended 2026-10-09 (M3-21).)* The image format is settled: lossless WebP (REQ-AST-040), so the `.webp` paths above are final and the PNG alternative in the parenthesis is void. Sizes: character presets 128×128, looks and body shapes 64×64 (REQ-AST-042). Besides `AST_THUMBNAIL_MISSING`, a present preset thumbnail can warn `AST_THUMBNAIL_STALE` (REQ-AST-047) or `AST_THUMBNAIL_INVALID` (REQ-AST-048).

~~[NEEDS CLARIFICATION: Body-shape thumbnails (`thumbnails/shapes/<style>/<id>.webp`): are they rendered for every (style file, body-shape preset) pair in the pack or only for styles a pack supports in `SUPPORTED_STYLE_COMBOS`, at what size (REQ-AST-015 parts use 128×128 px; the look schema says 64×64 for looks), and does `assets:check` warn when one is missing? In the M3 build `tools/lib/check/presets.ts` neither references nor checks shape thumbnails, so AC-AST-039.3 fails as an orphan until the check counts them. Owner: asset-pipeline-engineer (thumbnails task), PM to confirm.]~~ *Resolved 2026-10-09 (PM):* rendered for every (style file, body-shape preset) pair whose (style, `human`) is in `SUPPORTED_STYLE_COMBOS` (M3: realistic and chibi × 6 shapes = 12), at 64×64 px like looks; `assets:check` counts them as referenced and warns `AST_THUMBNAIL_MISSING` when one is missing (the thumbnails task updates `tools/lib/check/presets.ts`).

### M3 amendments (2026-10-09): thumbnails as built (M3-21)

*(Added 2026-10-09, recording `tools/thumbnails.ts`, `tools/lib/thumbnails/{jobs,index-file,webp,register,read-packs}.ts`, `tools/lib/check/thumbnails.ts` and the GPU harness `packages/engine/test/gpu/thumbnails/`.)* `pnpm assets:thumbnails` plans one job per thumbnail from the built packs (pure, no GPU), renders the jobs in the golden container, verifies every output, then installs it. Exit codes: 0 ok (also when no pack is built), 1 planning, render or verification failure, 2 usage. Kinds: `part` (REQ-AST-015), `character`, `look`, `shape` (REQ-AST-039).

**REQ-AST-040 [P2]** THE SYSTEM SHALL store every thumbnail as a simple lossless WebP (RFC 9649): a RIFF `WEBP` file holding exactly one `VP8L` chunk and no `VP8X`, `ICCP`, `ALPH`, `VP8 `, `ANIM` or `ANMF` chunk. The sRGB ICC profile that the encoder (Chromium canvas, `image/webp`, quality 1) writes is stripped, so files are untagged and decoders treat them as sRGB; the VP8L bitstream already carries size and alpha, so the pixels do not change.

- **AC-AST-040.1** Given a canonical `pnpm assets:thumbnails` run, When any installed thumbnail is inspected, Then bytes 0–3 are `RIFF`, 8–11 `WEBP`, 12–15 `VP8L`, the RIFF size plus 8 equals the file length, and the file contains no `ICCP` and no `VP8X` chunk.
- **AC-AST-040.2** Given encoder output `VP8X` + `ICCP` + `VP8L`, When it is reduced to the simple form, Then the result is a 12-byte RIFF header plus the same `VP8L` chunk byte for byte; Given encoder output holding a `VP8 ` or `ANIM` chunk, Then the reduction fails and nothing is installed.

**REQ-AST-041 [P2]** WHEN `pnpm assets:thumbnails` has rendered the jobs THE SYSTEM SHALL decode every WebP (libwebp, through sharp) and compare it with the RGBA image the harness rendered; IF any file is not a lossless WebP of the expected size (REQ-AST-042), is over 12,288 bytes, is missing, or decodes to any different RGBA byte THEN THE SYSTEM SHALL list every failing `<packId>/<path>` with its problems, exit 1 and leave `assets/packs/` unchanged.

- **AC-AST-041.1** Given a canonical run, When each installed file is decoded to RGBA, Then it equals the rendered RGBA byte for byte (0 differing bytes).
- **AC-AST-041.2** Given a rendered pair (`--skip-render` reuses the last render) whose WebP differs from its RGBA PNG in one pixel, When `pnpm assets:thumbnails --skip-render` runs, Then it exits 1 naming that file and "decodes to different pixels than were rendered", and no file under `assets/packs/` changes.

**REQ-AST-042 [P2]** THE SYSTEM SHALL render thumbnails at these sizes: part and character-preset thumbnails as a 64 px cell upscaled ×2 with nearest neighbour to 128×128 px; look and body-shape thumbnails as a 64×64 px cell, not upscaled. Every file SHALL be ≤ 12,288 bytes (12 KB).

- **AC-AST-042.1** Given the plan of the bundled packs, When the jobs are read, Then every `part` and `character` job has `cellPx` 64 and `scale` 2, every `look` and `shape` job has `cellPx` 64 and `scale` 1, and every installed file has the side `cellPx × scale` and ≤ 12,288 bytes.
- **AC-AST-042.2** Given an installed 128×128 thumbnail, When it is split into 2×2 blocks aligned to even coordinates, Then the four pixels of every block are identical.

**REQ-AST-043 [P2]** THE SYSTEM SHALL render every thumbnail through the export pixel pipeline (spec 003) on WebGL2 (`forceWebGL: true`), posed at frame 0 of the default character's first default clip (`idle`), facing `se` for the `three-quarter` and `isometric` cameras and `e` for the `side` camera, on a transparent background with binary alpha (REQ-PIX-023), under the default look `classic-16bit` (spec 006 REQ-EDT-044) except look thumbnails, which use their own look. Cameras: `three-quarter` for parts, looks and body shapes; a character preset's own `camera` (default `side`).

- **AC-AST-043.1** Given the plan of the bundled packs, When the jobs are read, Then every job's settings have `directions` 1 and one animation with `frameCount` 1 on clip `idle`, `singleFacing` is `e` exactly when the camera preset is `side` (else `se`), and every non-look job carries the render settings of `classic-16bit`.
- **AC-AST-043.2** Given any installed thumbnail, When decoded, Then every pixel's alpha is 0 or 255, and every pixel with alpha 0 is RGBA (0, 0, 0, 0).
- **AC-AST-043.3** Given the same built packs rendered twice in the canonical container, When the installed files are compared, Then they are byte-identical (P-04).

**REQ-AST-044 [P2]** THE SYSTEM SHALL install thumbnails only from a render in the canonical golden environment of AC-PIX-028.1 (ADR-0009; `scripts/golden-env/run.sh`, pinned Playwright image, WebGL2 on SwiftShader). IF the render report does not mark the run as canonical (for example `--host`, which renders with the host's Playwright Chromium) THEN THE SYSTEM SHALL install nothing and exit 1, unless `--allow-host` is also given.

- **AC-AST-044.1** Given `pnpm assets:thumbnails --host` without `--allow-host`, When rendering succeeds, Then the command exits 1 with a message naming `--allow-host`, and no file under `assets/packs/` changes.

**REQ-AST-045 [P2]** THE SYSTEM SHALL frame each thumbnail kind as follows. **Bodies**: the body alone, auto framing (the export framing of spec 005). **Other parts**: the part alone (every other slot empty, default tints and anatomy) on the default character's body when the part fits it (spec 001 REQ-CMP-008), else on the first fitting built body by reference, in the default style unless the part's `styles` excludes it (then its first listed style); framed on a square box around the body vertices of the regions `SLOT_FRAMING_REGIONS[slot]` (table in Data & contracts; all `BODY_REGIONS` for a slot not in the table) united with the part's own screen box, centred in the 64 px cell with a 4 px margin. **Character presets** and **looks**: auto framing; a look shows the default character. **Body shapes**: the default character with the shape applied over its style's anatomy preset (spec 002 REQ-ANA-023), with one shared scale per pack and style, the largest auto-framing world-units-per-pixel of the group's shapes, so every shape fits and tall and petite shapes differ in height. IF no built body fits a part THEN planning SHALL report it and `pnpm assets:thumbnails` SHALL exit 1 before rendering.

- **AC-AST-045.1** Given the fixture shirt (slot `torso`) and the fixture body, When planned, Then the shirt's job uses that body, has no other slot, and has framing `region` with regions `neck`, `torso`, `pelvis`, `upper-arms` and margin 4.
- **AC-AST-045.2** Given body-shape presets `tall` and `petite` of style `chibi` in one pack, When rendered, Then both jobs have framing `shared` with the same group, and the covered height in px of `tall` is greater than that of `petite`.
- **AC-AST-045.3** Given a fixture part whose `bodies` matches no built body, When `pnpm assets:thumbnails` runs, Then it exits 1 naming the part's path and "no built body fits", and nothing is rendered.

**REQ-AST-046 [P2]** WHEN `pnpm assets:thumbnails` installs thumbnails THE SYSTEM SHALL write `assets/packs/<packId>/thumbnails/index.json` (`ThumbnailIndex`, Data & contracts) as canonical JSON with one entry per thumbnail of the pack, sorted by path, recording the job's input hash `inputs` and the file's SHA-256 `sha256`. `inputs` is the SHA-256 of a stable serialization of the render recipe version (`THUMBNAIL_RECIPE`), the job without pack and path, every built part entry the job's character uses (without its `thumbnail` field), the embedded rigs of their packs, the default clip's entry and, for body shapes, the group's shape factors and base anatomy.

- **AC-AST-046.1** Given a canonical run, When `thumbnails/index.json` is read, Then it has `format: 'sprite-thumbnail-index'`, `version: 1`, one entry per installed file in path order, each `sha256` equals the file's SHA-256 and `width`/`height` equal its size; When `pnpm assets:check` runs, Then the index is not an `AST_ORPHAN_FILE`.
- **AC-AST-046.2** Given the plan computed twice on the same packs, Then every `inputs` is identical; Given one part's manifest entry changed (for example its `tintSlots`), Then only the jobs whose character uses that part get a new `inputs`.

**REQ-AST-047 [P2]** WHEN `pnpm assets:check` runs THE SYSTEM SHALL recompute the thumbnail plan without a GPU and, for every planned thumbnail file that exists, warn `AST_THUMBNAIL_STALE`, naming the ID and path, IF `thumbnails/index.json` is absent or invalid or has no entry for the path, the file's SHA-256 differs from its entry, or the entry's `inputs` differ from the recomputed plan. The warning SHALL NOT change the exit code.

- **AC-AST-047.1** Given a fixture pack with current thumbnails and index, When checked, Then no thumbnail warning is printed; When a part's built entry changes, or a thumbnail is overwritten by hand, or `thumbnails/index.json` is deleted, Then `AST_THUMBNAIL_STALE` names each affected thumbnail (for a hand edit with "do not edit thumbnails by hand") and the exit code is still 0.

**REQ-AST-048 [P2]** WHEN `pnpm assets:check` runs THE SYSTEM SHALL warn `AST_THUMBNAIL_INVALID`, naming the ID, path and every problem, for every planned thumbnail file that exists and is not a WebP, is not lossless (`VP8L`), is not `cellPx × scale` px square (REQ-AST-042), or is over 12,288 bytes. The warning SHALL NOT change the exit code. A missing file is reported only as `AST_THUMBNAIL_MISSING` (REQ-AST-020, REQ-AST-039).

- **AC-AST-048.1** Given a part thumbnail that is a 128×128 lossy (`VP8 `) WebP, or a 64×64 lossless one, or 13,000 bytes, When checked, Then `AST_THUMBNAIL_INVALID` names the part and the matching problem, and the exit code is 0.

**REQ-AST-049 [P2]** WHEN `pnpm assets:thumbnails` installs thumbnails THE SYSTEM SHALL delete every file under a pack's `thumbnails/` (except `index.json`) that no job of the plan produces, rewrite only files whose bytes changed, and set each part's manifest `thumbnail` field to `thumbnails/<partId>.webp` exactly when that file exists (removing it otherwise; the same rule `assets:build` applies, AC-AST-015.1).

- **AC-AST-049.1** Given a pack holding `thumbnails/retired-hat.webp` for a part no longer in the manifest, When thumbnails are installed, Then that file is deleted and the summary counts 1 removed; Given a second install of an unchanged render, Then the summary counts 0 written.

## Edge cases

- Source archive version changes on itch.io → hash mismatch (REQ-AST-001); update `asset-sources.json` in a dedicated PR with a new rig report.
- One pack fails verify-rig → outcome `mapped` or `fallback` (REQ-AST-007), never silent.
- Multi-mesh sources with overlapping names → config patterns must match exactly one node per part (REQ-AST-009).
- Joint not in any region → build fails (REQ-AST-012).
- Retired IDs → REQ-AST-019; spec 001 REQ-CMP-024 handles old character files referencing them.
- KTX2 encoder non-determinism → moot for M1: textures are PNG (REQ-AST-010 as amended); PNG encoding is single-threaded with fixed settings (REQ-AST-014).
- Unzipped vendor folder with a stray OS file (`.DS_Store`, `Thumbs.db`) → it changes the tree hash (REQ-AST-024 includes hidden files); delete it or update `asset-sources.json` in a dedicated PR.
- Symbolic link inside a source folder → `AST_SOURCE_FORMAT`, not followed (REQ-AST-024).
- Bind poses that differ between packs → skeleton groups, reported as `warn`, not a failure (REQ-AST-026); clips are rest-pose corrected at runtime (spec 004 REQ-ANM-023).
- More than 4 influences per vertex in a source → limited to 4 with a warning (REQ-AST-027).
- Body without `_REGION` → load fails (REQ-AST-028); `_REGION` value out of range → `AST_REGION_INVALID` (REQ-AST-025).
- Bundled GLB with Draco or KTX2 → refused at load (REQ-AST-029).
- A community pack adds a body or a lower-soled `feet` part to an existing skeleton group → the next `assets:build` (even with `--pack`) remeasures `soleOffsetM` over all built packs and refreshes the rig JSON and every embedding manifest (REQ-AST-030); goldens that show that group may shift by up to 1 px and are regenerated with a written reason. *(Added 2026-10-09 (M3-00).)*
- Skeleton group that drives no bundled body (Quaternius `superhero-m`, `ual`) → no `soleOffsetM`; the engine falls back to joint-only grounding for it (spec 002 REQ-ANA-008). *(Added 2026-10-09 (M3-00).)*
- Body without any `feet`-region triangle (for example feet hidden in the source art) → `bodySoleY` comes from no vertex; the group is measured from `F(G)` alone, and with `F(G)` empty too the build fails with `AST_SOLE_OFFSET_RANGE` naming the group and the value `none` (REQ-AST-033). *(Added 2026-10-09 (M3-00).)*
- Contributor without a GPU → `assets:build` and `assets:check` need no GPU; only thumbnails need Playwright (software GL allowed). *(Amended 2026-10-09 (M3-21): installable thumbnails need Docker for the canonical golden container (REQ-AST-044); `assets:check` still flags stale and invalid thumbnails without a GPU (REQ-AST-047, -048).)*
- Engine code, the container image or three.js changes in a way the input hash cannot see → the maintainer bumps `THUMBNAIL_RECIPE` in `tools/lib/thumbnails/jobs.ts`, every thumbnail then warns `AST_THUMBNAIL_STALE` until re-rendered (REQ-AST-046, -047). *(Added 2026-10-09 (M3-21).)*
- Part that no built body fits → planning problem, `assets:thumbnails` exits 1 before rendering (REQ-AST-045). *(Added 2026-10-09 (M3-21).)*
- No built pack → `assets:thumbnails` prints "nothing to render" and exits 0. *(Added 2026-10-09 (M3-21).)*

## Data & contracts

`tools/packs/<packId>/pack.config.json` (authored, committed):

```json
{
  "format": "sprite-pack-config",
  "version": 1,
  "packId": "quaternius-outfits",
  "name": "Modular Character Outfits – Fantasy",
  "license": { "license": "CC0-1.0", "author": "Quaternius", "sourceUrl": "https://quaternius.itch.io/modular-character-outfits-fantasy", "commercialUse": "yes", "attributionRequired": false },
  "rig": "quaternius-ue5-65",
  "parts": [
    { "id": "male-ranger-torso", "match": { "file": "Modular Parts/Male_Ranger_Body.gltf" },
      "name": "Ranger tunic", "slot": "torso", "hides": ["neck", "torso", "upper-arms", "pelvis"],
      "tintSlots": [{ "material": "Cloth", "slot": "primary" }, { "material": "Leather", "slot": "leather" }],
      "bodies": ["superhero-m"], "tags": ["ranger", "light-armor"] }
  ],
  "clips": []
}
```

*(Example amended 2026-10-08 (M1 D4): M1 bundles only the free Superhero male and female bodies (`bodyType: 'superhero'`); outfit parts fit them through `bodies` and tuned `hides` (the vendor readme uses only the head of the body under outfits); extracting the Regular bodies from the combined outfit files is deferred. Exact `hides` lists are tuned during M1 visual review. A body entry may set `characterSkeletonGroup` (REQ-AST-026, spec 001 REQ-CMP-037), e.g. `"characterSkeletonGroup": "male-outfits"` on `superhero-m`. Amended 2026-10-09 (M1-33): the committed group ID is `male`, so the M1 config has `"characterSkeletonGroup": "male"` on `superhero-m` and `"female"` on `superhero-f`.)*

`tools/asset-sources.json` (authored, committed; M1 D3 and PM rig update c):

```json
{
  "format": "sprite-asset-sources",
  "version": 1,
  "sources": [
    { "packId": "quaternius-ubc", "dir": "Universal Base Characters[Standard]",
      "name": "Universal Base Characters", "vendorUrl": "https://quaternius.itch.io/universal-base-characters",
      "version": "<vendor version>", "tier": "standard", "license": "CC0-1.0", "author": "Quaternius",
      "treeSha256": "<64 lowercase hex>",
      "archive": { "file": "<optional original zip name>", "sha256": "<optional 64 lowercase hex>" } }
  ]
}
```

The `dir` value above is illustrative; the committed file records the real vendor folder names.

Rig report (`assets/reports/rig-report.json`):

```ts
export interface RigReport {
  format: 'sprite-rig-report';
  version: 1;
  canonicalRig: RigId;
  tolerances: { posM: number; rotRad: number; scale: number };
  toolVersions: Record<string, string>;     // gltf-transform, node, verify-rig
  summary: { pass: number; warn: number; fail: number };
  /** Added 2026-10-08 (M1 PM rig update d). REQ-AST-007 outcome. */
  outcome: 'shared' | 'mapped' | 'fallback';
  /** Added 2026-10-08. File every other file was compared with. */
  referenceFile: string;
  /** Added 2026-10-08. Files sharing one rest pose within tolerance (REQ-AST-026). */
  skeletonGroups: Array<{
    id: string;
    /** True for exactly one group: the one holding `referenceFile`; its `id` equals the rig's
     *  `defaultSkeletonGroup` (amended 2026-10-08, M1-01c). */
    isReference: boolean;
    files: string[];
    vsReference: { bonesOverTolerance: number; maxPosM: number; maxPosHeightFraction: number; maxRotDeg: number; maxScale: number };
  }>;
  items: Array<{
    file: string;                           // path relative to assets-src or assets
    packId: string;
    kind: 'skinned-mesh' | 'animation';
    status: 'pass' | 'warn' | 'fail';
    jointCount: number;
    missingBones: string[];
    extraBones: string[];
    parentMismatches: Array<{ bone: string; expected: string | null; actual: string | null }>;
    bindPose: Array<{ bone: string; maxPosDelta: number; maxRotDelta: number; maxScaleDelta: number }>;
    issues: Array<{ severity: 'info' | 'warn' | 'error'; code: string; message: string }>;
    suggestedBoneMap?: Record<string, string | null>;
    /** Added 2026-10-08. Optional per-item metrics for readers (worst deltas, skeleton height, weight stats, clip/channel counts). */
    metrics?: {
      skeletonHeightM?: number; worstBindPosM?: number; worstBindPosHeightFraction?: number;
      worstBindRotRad?: number; worstBindRotDeg?: number; worstBindScale?: number;
      worstRestPosM?: number; worstRestRotRad?: number; worstRestScale?: number; worstBone?: string;
      lengthAxis?: 'x' | 'y' | 'z';
      weights?: Record<string, number>;     // e.g. sampled, maxInfluences, unnormalizedVertices, maxSumDeviation
      clipCount?: number; channelCount?: number;
    };
  }>;
}
```

All report fields added on 2026-10-08 are additive within `version: 1`.

Rig JSON addition (`packages/parts-schema/rigs/<rigId>.json`, spec 002 `RigDefinition`): `socketBones` and `skeletonGroups` (rest-pose local transforms per bone and group). Overlay addition (`tools/rigs/<rigId>.overlay.json`): `socketBones` and `skeletonGroups: { <groupId>: <representative source file> }`.

*(Amended 2026-10-08 (M1-01c).)* The full rig JSON shape is spec 002 `RigDefinition`; its top-level keys are `id`, `comment?`, `bones`, `parents`, `rootBone`, `lengthAxis`, `anatomyBones`, `regionBones`, `socketBones`, `skeletonHeightM?`, `defaultSkeletonGroup` and `skeletonGroups`. Source of each key:

| Key | Source |
|-----|--------|
| `bones`, `parents`, `rootBone`, `lengthAxis`, `skeletonHeightM` | derived from the reference file |
| `anatomyBones`, `regionBones`, `socketBones`, `defaultSkeletonGroup` | overlay (hand-edited) |
| `skeletonGroups[].restPose` | derived from each group's representative file (overlay `skeletonGroups`) |
| `comment` | derivation note + overlay `comment` |
| `skeletonGroups[].soleOffsetM` | measured by `assets:build` from the built packs (REQ-AST-030, added 2026-10-09 (M3-00)); kept by `--write-canonical` (REQ-AST-034); checked by `assets:check` (REQ-AST-032); never hand-edited |

There is no `hipBone` key (the hip is `socketBones.pelvis`, spec 004 REQ-ANM-023) and no top-level `joints` key (rest poses live only in `skeletonGroups[].restPose`). Excerpt:

```json
{
  "id": "quaternius-ue5-65",
  "bones": ["root", "pelvis", "spine_01", "…"],
  "parents": { "root": null, "pelvis": "root", "spine_01": "pelvis", "…": "…" },
  "rootBone": "root",
  "lengthAxis": "y",
  "socketBones": { "hand_r": "hand_r", "hand_l": "hand_l", "head": "Head", "spine_03": "spine_03", "pelvis": "pelvis" },
  "defaultSkeletonGroup": "superhero-m",
  "skeletonGroups": [
    { "id": "superhero-m", "restPose": { "root": { "t": [0, 0, 0], "r": [-0.7071068, 0, 0, 0.7071068], "s": [1, 1, 1] }, "…": {} } }
  ]
}
```

Overlay addition (M1-01c): `defaultSkeletonGroup` (a key of the overlay's `skeletonGroups` whose representative file is the verify-rig reference file).

Error codes use the `AST_` prefix: `AST_SOURCE_HASH_MISMATCH`, `AST_SOURCE_FORMAT`, `AST_SOURCE_READ`, `AST_CONFIG_UNMATCHED`, `AST_REGION_UNMAPPED`, `AST_REGION_INVALID`, `AST_MANIFEST_STALE`, `AST_BUDGET_TRIANGLES`, `AST_BUDGET_TEXTURES`, `AST_BUDGET_INFLUENCES`, `AST_LICENSE_NOT_ALLOWED`, `AST_ID_REMOVED`, `AST_ID_REUSED`, `AST_ORPHAN_FILE`, `AST_RIG_MISMATCH`. Report and warning codes (non-fatal unless noted): `AST_BIND_POSE_WITHIN_TOLERANCE` (info, AC-AST-004.1), `AST_WEIGHTS_UNNORMALIZED` (warn; error when a weight sum is off by > 1e-2), `AST_CLIP_TARGETS` (info: clip and channel counts), `AST_INFLUENCES_LIMITED` (warn, REQ-AST-027), `AST_SKELETON_GROUP_UNMATCHED` (warn, REQ-AST-026). *(List amended 2026-10-08, M1.)*

*(Amended 2026-10-09 (M1-33): codes used by the M1 tools.)* Build and check codes added: `AST_SOURCE_MISSING` (error, exit 2: a listed source folder is absent; prints download instructions, AC-AST-001.3), `AST_RIG_MISSING` (error: the pack's rig JSON is missing or unreadable; exit 2 in `assets:build`, AC-AST-013.3), `AST_REGION_UNWEIGHTED` (error: a body primitive or vertex has no joint weights, so no region can be assigned, AC-AST-012.3), `AST_RETIRED_IDS_INVALID` (error, AC-AST-019.3), `AST_BUDGET_SIZE` (error: default set over 15 MB, AC-AST-016.2). Warnings added (the command continues): `AST_TEXTURES_DROPPED` (secondary maps removed to meet the 4-texture budget, REQ-AST-010 amendment, AC-AST-010.4), `AST_SOURCE_IMAGE_MISSING` (an image referenced by a source glTF is absent; texture dropped, AC-AST-010.5), `AST_CLIP_GROUP_DEFAULTED` (clip recorded with `defaultSkeletonGroup`, AC-AST-026.6), `AST_BUDGET_FILE_SIZE` (one built file over 3 MiB, AC-AST-016.3), `AST_NORMALIZE_NONUNIFORM` (non-uniform armature scale baked as its mean, AC-AST-011.2), `AST_BIND_POSE_DIFFERS` (the REQ-AST-026 `warn` naming a file's skeleton group), `AST_THUMBNAIL_MISSING` (REQ-AST-020: missing thumbnail = warning). Report info: `AST_SKELETON_GROUP` (group of an item). The M1 tools also use these codes, listed here for completeness: `AST_USAGE` (bad CLI arguments, exit 2), `AST_CONFIG_INVALID`, `AST_CONFIG_MISSING` (pack config fails its schema or is absent), `AST_MANIFEST_INVALID`, `AST_MANIFEST_DUPLICATE`, `AST_MANIFEST_MISSING`, `AST_MANIFEST_UNKNOWN`, `AST_MANIFEST_RIG` (manifest assembly: schema failure, duplicate ID, authored entry without output, output without authored entry, rig ID or embedded rig mismatch), `AST_FILE_MISSING`, `AST_HASH_MISMATCH` (REQ-AST-020: a listed file is absent or its SHA-256 differs), `AST_RIG_INVALID` (rig JSON fails REQ-ANA-021), `AST_LICENSE_MISSING` (REQ-AST-017 record incomplete), `AST_LICENSES_STALE` (REQ-AST-018 diff).

*(Added 2026-10-09 (M3-00), sole offset.)* `AST_SOLE_OFFSET_RANGE` (error: measured `soleOffsetM` outside −0.1…0.1 m or not measurable, REQ-AST-033), `AST_SOLE_OFFSET_STALE` (error in `assets:check`: stored value missing, extra or off by more than 0.0001 m, REQ-AST-032), `AST_SOLE_SPREAD` (warning: body sole and lowest `feet` part differ by more than 0.010 m, REQ-AST-031).

`assets/packs/<packId>/retired-ids.json` (written by `assets:build`, read by `assets:check`; format fixed 2026-10-09 (M1-33)). One ID namespace per pack: an ID in `ids` is retired for parts and clips alike. IDs are sorted and never removed from the list.

```json
{
  "format": "sprite-retired-ids",
  "version": 1,
  "ids": ["cape-99"]
}
```

Output layout: `assets/packs/<packId>/{manifest.json, clips.json?, parts/*.glb, clips/*.glb, thumbnails/*.webp, presets/**/*.json, retired-ids.json}`.

*(Amended 2026-10-09, M3 PM decision: preset and thumbnail layout as built, REQ-AST-035 to REQ-AST-039.)* In full:

```
assets/packs/<packId>/
  manifest.json, clips.json?, retired-ids.json
  parts/*.glb, clips/*.glb
  thumbnails/<partId>.webp                  REQ-AST-015 (manifest `thumbnail`)
  thumbnails/characters/<id>.webp           REQ-AST-039, one per character preset
  thumbnails/looks/<id>.webp                REQ-AST-039, the look preset's `thumbnail` field
  thumbnails/shapes/<style>/<id>.webp       REQ-AST-039, body-shape preset per style
  presets/index.json                        generated, REQ-AST-036
  presets/{anatomy,body-shapes,styles,categories,swatches,characters,looks}/<id>.json
```

Thumbnail image format: ~~WebP, or PNG, as chosen by REQ-AST-015's implementation; see the build.~~ lossless WebP, simple `VP8L` form, untagged sRGB (REQ-AST-040; settled 2026-10-09 (M3-21)). The layout also holds the generated `thumbnails/index.json` (REQ-AST-046). `presets/` exists only for packs with authored preset files; in M3 only `quaternius-ubc` has them.

`presets/index.json` (`presetIndexSchema`, generated, never hand-edited; `path` is relative to the pack base URL, unique, in a kind's folder; the file is canonical JSON, so its keys are sorted and `files` comes first, unlike the reading order below):

```json
{
  "format": "sprite-preset-index",
  "version": 1,
  "files": [
    { "kind": "anatomy-preset", "path": "presets/anatomy/default.json" },
    { "kind": "body-shape", "path": "presets/body-shapes/athletic.json" },
    { "kind": "look", "path": "presets/looks/classic-16bit.json" }
  ]
}
```

`kind` is one of `anatomy-preset`, `body-shape`, `style`, `easy-category`, `swatch-set`, `character`, `look` (`PRESET_FILE_KINDS`). The per-kind file formats are the parts-schema schemas in the REQ-AST-035 table; their `format` strings are `sprite-anatomy-preset`, `sprite-body-shape-preset`, `sprite-style`, `sprite-easy-category`, `sprite-swatch-set`, `sprite-character-preset` and `sprite-look-preset`, each `version: 1`.

*(Added 2026-10-09, M3 PM decision.)* Preset codes: `AST_PRESET_INVALID` (error in `assets:build`, exit 1, and in `assets:check`: a preset file or `presets/index.json` is unreadable or invalid, REQ-AST-035, REQ-AST-037), `AST_PRESET_REF` (error in `assets:check`: a character preset or Easy category references a style, part or slot that does not resolve, REQ-AST-038). `AST_MANIFEST_STALE` also covers built presets that differ from their sources, and `AST_THUMBNAIL_MISSING` also covers character and look preset thumbnails (REQ-AST-037, REQ-AST-039).

*(Added 2026-10-09 (M3-21), thumbnails.)* Warnings of `assets:check` (the exit code is unchanged): `AST_THUMBNAIL_STALE` (a present thumbnail is not in `thumbnails/index.json`, differs from its recorded hash, or was rendered from changed inputs, REQ-AST-047), `AST_THUMBNAIL_INVALID` (a present thumbnail is not a lossless WebP of the planned size or is over 12,288 bytes, REQ-AST-048). `AST_THUMBNAIL_MISSING` (REQ-AST-020, REQ-AST-039) now also covers body-shape thumbnails.

`assets/packs/<packId>/thumbnails/index.json` (generated by `pnpm assets:thumbnails`, never hand-edited, canonical JSON; REQ-AST-046):

```ts
export interface ThumbnailIndex {
  format: 'sprite-thumbnail-index';
  version: 1;
  /** Sorted by `path`. */
  thumbnails: Array<{
    path: string;                                   // pack-relative, e.g. 'thumbnails/characters/knight.webp'
    kind: 'part' | 'character' | 'look' | 'shape';
    id: string;                                     // part or preset ID
    inputs: string;                                 // lowercase hex SHA-256 of the job inputs
    sha256: string;                                 // lowercase hex SHA-256 of the file
    width: number;                                  // px, 128 or 64 (REQ-AST-042)
    height: number;
  }>;
}
```

Slot framing regions (`SLOT_FRAMING_REGIONS` in `tools/lib/thumbnails/jobs.ts`, REQ-AST-045). A slot not listed (including `body`, which uses auto framing) is framed on all `BODY_REGIONS`; the region box is united with the part's own box, made square, centred, with a 4 px margin in the 64 px cell.

| Slots | Regions |
|---|---|
| `hair`, `eyebrows`, `beard`, `face`, `headwear` | `head`, `hair`, `neck` |
| `torso`, `back` | `neck`, `torso`, `pelvis`, `upper-arms` |
| `accessory` | `neck`, `torso`, `upper-arms` |
| `arms` | `upper-arms`, `lower-arms`, `hands` |
| `hands` | `lower-arms`, `hands` |
| `legs` | `pelvis`, `upper-legs`, `lower-legs` |
| `feet` | `lower-legs`, `feet` |

Recipe constants (`tools/lib/thumbnails/jobs.ts`): `THUMBNAIL_RECIPE` (`'m3-21.1'`, part of every `inputs` hash), `DEFAULT_LOOK_ID` (`'classic-16bit'`), `THUMBNAIL_CELL_PX` (64), `REGION_MARGIN_PX` (4), `MAX_THUMBNAIL_BYTES` (12,288), `THUMBNAIL_SHAPE_STYLES` (`['realistic', 'chibi']`, asserted equal to the engine's supported (style, `human`) pairs by the GPU harness, because tools may not import the engine catalog).

## Non-functional

- NFR-1 (P-02): no bundled file without a license record; `ASSETS_LICENSE.md` generated and checked.
- NFR-2 (P-11): contributing a part or pack needs only open-source tools (Blender, Node, pnpm) and data edits.
- NFR-3 (P-07): default character + default clips ≤ 15 MB; `assets:check` ≤ 60 s in CI.
- NFR-4: tools run on Linux, macOS and Windows (Node LTS), no GPU except thumbnails.

## Open questions

- ~~[NEEDS CLARIFICATION: Which Quaternius tiers do we bundle? The free Standard tiers are limited: UBC Standard has 2 bodies and 5 hairstyles, the Outfits page says only Ranger and Peasant are free, and UAL Standard has 45 clips. Paid tiers (UBC Source $19.99, Outfits Source $20, UAL Pro $9.99) are also CC0, so redistribution is legal, but bundling paid content is a courtesy and community question. Blocks the content list and the default character, not the tools. Owner: project owner.]~~ Resolved 2026-10-09 (M1-33), PM default recorded 2026-10-08 after the owner left it open: bundle only the free tiers (UBC Standard, Outfits Ranger and Peasant, UAL Standard). Paid packs stay out of the repository out of respect for the vendor; users can build them locally from `assets-src/` because packs are data (REQ-AST-022).
- ~~[NEEDS CLARIFICATION: Do built packs (tens of MB of GLB/KTX2) go in git directly, in Git LFS, or in release artifacts fetched at build time? Affects clone size and the "no proprietary tool" rule (P-11). Owner: maintainers.]~~ Resolved 2026-10-09 (M1-33), PM decision 2026-10-08: plain git, no LFS, under a size budget (built packs ≤ 30 MB; per-file warning above 3 MiB, AC-AST-016.3). The M1 build is 18 MB in 80 files with no file over 3 MiB.
- ~~[NEEDS CLARIFICATION: Allow `CC-BY-4.0` for bundled assets (REQ-AST-017), or CC0 only? CC-BY adds an attribution duty to users' games (handled by CREDITS.txt). Proposal: allow, with an export warning. Owner: project owner.]~~ Resolved 2026-10-09 (M1-33), PM decision 2026-10-08: allowed, with credits (REQ-AST-017 as written; `CREDITS.txt`, spec 005). All M1 bundled packs are CC0.
- [NEEDS CLARIFICATION: If KTX2 (Basis) encoding is not byte-deterministic even single-threaded, should REQ-AST-014 exempt texture bytes and compare decoded pixels instead? Deferred with KTX2 (REQ-AST-010 as amended 2026-10-08, M1 D2); reopen when KTX2 returns.]
- [NEEDS CLARIFICATION: Spec 008 AC-UPL-054.1 says no Meshopt decoder file is requested in a page that equips stored user assets outside the upload worker. Bundled packs now need the in-thread Meshopt decoder on the main thread (REQ-AST-029), so a session with a bundled body and user parts would request it. Proposal: scope AC-UPL-054.1 to the user-asset loader (it must not register the decoder) rather than the whole page. Owner: spec-writer for 008 with the security reviewer; blocks nothing in M1, must be settled before M5.]
- [NEEDS CLARIFICATION: When KTX2 returns, which same-origin transcoder setup is used (a self-hosted `worker-src 'self'` module worker, or calling the Basis WASM on the main thread)? Shared with spec 000 / 008 open questions on `KTX2Loader` blob workers. Owner: asset-pipeline-engineer; not blocking (PNG in M1).]
- M1 D4 (2026-10-08): fit groups for M1 are answered as "Superhero bodies only, outfits restricted with `bodies` and tuned `hides`". Whether to add Regular bodies extracted from the combined outfit files is reopened only if the M1 visual review shows neck, wrist or ankle seams that `hides` cannot cover (spec 001 open question).
- ~~[NEEDS CLARIFICATION: The vendor pages give different counts (Outfits: 62 vs 82 parts; UBC: 6 vs 8 bodies). verify-rig output becomes the authoritative inventory.]~~ Resolved 2026-10-09 (M1-33): the authoritative inventory is the committed `assets/reports/rig-report.json` (files checked) and the generated `manifest.json` / `clips.json` (what is bundled); vendor page counts are not used.

- [NEEDS CLARIFICATION: The thumbnail render (`pnpm assets:thumbnails`, REQ-AST-043, -044) is not in CI yet: no workflow renders the jobs, so AC-AST-040.1, AC-AST-041.1, AC-AST-042.2, AC-AST-043.2, AC-AST-043.3 and AC-AST-045.2 are only exercised when a maintainer runs the command locally with Docker. CI covers the planner, the index and the check codes (`tools/lib/thumbnails/thumbnails.test.ts`). Should CI run the render in the golden container (as for the REQ-PIX-028 goldens) and fail on any thumbnail that differs from the committed one, or is the `AST_THUMBNAIL_STALE` warning of `assets:check` enough? Owner: maintainers. Added 2026-10-09 (M3-21); does not block M3.]
- [NEEDS CLARIFICATION: AC-AST-015.2 says a static prop is shown alone and fills ≥ 60 % of the image height. The M3-21 build shows every non-body part on a body, and a prop slot (absent from `SLOT_FRAMING_REGIONS`) is framed on the whole body united with the prop's box, so a small prop does not reach 60 %. No bundled pack has props in M3, so nothing fails today. Either keep AC-AST-015.2 and add a prop rule to the planner before props ship, or deprecate it for the body-context rule. Owner: PM with asset-pipeline-engineer. Added 2026-10-09 (M3-21); blocks the first pack with props.]
- Resolved 2026-10-09 (M3-00, user decision on GitHub issue #10): the pipeline measures and stores a per-skeleton-group sole offset (REQ-AST-030..034) so the engine grounds on the sole without reading vertices (spec 002 REQ-ANA-008).

## References

- GitHub issue #10 (grounding 1 px low on the Quaternius rig) and `.tagconn/work/m3-plan.md` row M3-00
- ADR-0001 (shared-skeleton risk and fallbacks), ADR-0005 (user assets separate), ADR-0008 (M1 rig outcome `mapped`, `docs/adr/0008-shared-rig-skeleton-groups-runtime-retarget.md`), `docs/architecture.md` §1.1, §4.3, §4.8, §5 (M1), §7
- M1 implementation read for the 2026-10-09 (M1-33) amendments: `tools/build-parts.ts`, `tools/lib/build/{textures,split,normalize,region,sources,emit}.ts`, `tools/lib/check/{ids,budgets,run}.ts`, `packages/parts-schema/rigs/quaternius-ue5-65.json`, `assets/packs/*/manifest.json`, `assets/packs/quaternius-ual/clips.json`
- M3 implementation read for the 2026-10-09 preset and thumbnail amendments (REQ-AST-035 to REQ-AST-039): `tools/lib/build/presets.ts`, `tools/lib/check/presets.ts`, `tools/lib/check/presets.test.ts`, `packages/parts-schema/src/presets.ts`, `assets/packs/quaternius-ubc/presets/index.json`, `tools/packs/quaternius-ubc/presets/looks/*.json`
- M3 implementation read for the 2026-10-09 thumbnail amendments (REQ-AST-040 to REQ-AST-049, M3-21): `tools/thumbnails.ts`, `tools/lib/thumbnails/{jobs,index-file,webp,register,read-packs}.ts`, `tools/lib/thumbnails/thumbnails.test.ts`, `tools/lib/check/thumbnails.ts`, `tools/lib/check/run.ts`, `packages/engine/test/gpu/thumbnails/thumbnail-render.ts`, ADR-0009 (`docs/adr/0009-golden-images-and-gpu-determinism.md`)
- RFC 9649, WebP Image Format (RIFF container, simple lossless `VP8L` form, `VP8X`/`ICCP` chunks): https://www.rfc-editor.org/rfc/rfc9649 (accessed 2026-10-09)
- `.tagconn/work/research.md` (2026-10-08)
- Quaternius Universal Base Characters: https://quaternius.itch.io/universal-base-characters (accessed 2026-10-08)
- Quaternius Modular Character Outfits – Fantasy: https://quaternius.itch.io/modular-character-outfits-fantasy (accessed 2026-10-08)
- Quaternius Universal Animation Library: https://quaternius.itch.io/universal-animation-library (accessed 2026-10-08)
- glTF-Transform: https://gltf-transform.dev/ (CLI and functions; accessed 2026-10-08)
- Khronos forum, "Gltf + multiple bin": https://community.khronos.org/t/gltf-multiple-bin/111141 (optimize pipeline step order; `instance` drops node names; accessed 2026-10-08)
- KTX-Software / Basis Universal: https://github.com/KhronosGroup/KTX-Software (accessed 2026-10-08)
- Khronos glTF-Validator: https://github.com/KhronosGroup/glTF-Validator (accessed 2026-10-08)
- `.tagconn/work/m1-plan.md` §2.3, §5 (D1–D5, R3, R6) and the M1 verify-rig PM update (2026-10-08)
- Chrome for Developers, "New in WebGPU 133" (single-component `uint8`/`unorm8` vertex formats): https://developer.chrome.com/blog/new-in-webgpu-133 (accessed 2026-10-08)
- three.js `GLTFLoader` (custom attribute names lowercased; `setMeshoptDecoder`): https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/GLTFLoader.js (accessed 2026-10-08)
- three.js `KTX2Loader` (transcoder worker pool): https://threejs.org/docs/#examples/en/loaders/KTX2Loader (accessed 2026-10-08)
- glTF 2.0 specification, accessor component types and skin `JOINTS_n`/`WEIGHTS_n`: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html (accessed 2026-10-08)
