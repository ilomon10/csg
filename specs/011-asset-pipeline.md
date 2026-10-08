---
id: AST
title: Asset pipeline (ingestion, rig verification, manifests, licensing)
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 004-animation]
last_updated: 2026-10-08
---

# 011 – Asset pipeline

## Rules for IDs

`REQ-AST-NNN` and `AC-AST-NNN.k`, following `specs/_template.md`. IDs are never renumbered or reused. PM decision 2026-10-08: the AST area gets this dedicated spec.

## Context

Bundled characters come from CC0 Quaternius packs: Universal Base Characters (UBC), Modular Character Outfits – Fantasy and the Universal Animation Library (UAL), plus CC0 Quaternius/KayKit props. Raw packs are large (UBC Source ≈ 600 MB, Outfits Standard ≈ 280 MB), come in several formats and are not in the shape the engine needs: one optimized file per part, a manifest, thumbnails and license records. The pipeline turns local source packs into committed, optimized, licensed, data-driven packs that the composer (001), anatomy (002) and animation (004) consume.

The pipeline is also how the riskiest assumption gets tested. The research brief cites a third-party claim that all packs share one 65-joint UE5-style skeleton with identical bind poses. **That claim is unverified.** `tools/verify-rig.ts` is the **M1 spike** that confirms or refutes it, and its result gates the final contracts of 001/002/004 (ADR-0001 risk, architecture §7).

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
- **AC-AST-001.3** Given `assets-src/` is missing a listed pack, When a tool runs without `--pack`, Then it prints download instructions (vendor URL, tier, target folder) for that pack and exits with code 2.

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

**REQ-AST-008 [P2]** WHERE verify-rig finds name mismatches THE SYSTEM SHALL suggest a bone map per failing file using the DOM-free auto-map heuristic of spec 008, written to the report as `suggestedBoneMap`.

- **AC-AST-008.1** Given the fixture with `Hand_R`, When verify-rig runs, Then `suggestedBoneMap` maps `Hand_R` → `hand_r`.

### Build: optimize, split, manifest

**REQ-AST-009 [P1]** THE SYSTEM SHALL provide `pnpm assets:build [--pack <id>]` (`tools/build-parts.ts`) that, driven by each pack's committed `tools/packs/<packId>/pack.config.json`, splits sources into one GLB per part and one GLB per clip (or per clip group) under `assets/packs/<packId>/`.

- **AC-AST-009.1** Given a fixture source GLB holding 3 outfit meshes and a config mapping node-name patterns to slots, When the build runs, Then 3 part GLBs are written, each containing one mesh, the skeleton it is skinned to, and its materials and textures only.
- **AC-AST-009.2** Given a config pattern matching no node, When the build runs, Then it fails with `AST_CONFIG_UNMATCHED` naming the pattern.

**REQ-AST-010 [P1]** THE SYSTEM SHALL optimize every output with `@gltf-transform` in this fixed order: `dedup` → `prune` → `weld` → `resample` (tolerance 1e-4) → texture resize (max 512² for parts and props, 1024² for bodies) → texture encoding as PNG → Meshopt compression (`EXT_meshopt_compression`). It SHALL NOT apply `join`, `flatten`, `instance`, `simplify`, Draco or KTX2/Basis (`KHR_texture_basisu`): the first five rename or merge nodes, change skinning or conflict with Meshopt; KTX2 is deferred (see below). *(Amended 2026-10-08 (M1 D2): the KTX2 step (ETC1S color, UASTC normals) is replaced by resized PNG for M1. Reason: the KTX2 encoder (`toktx`, KTX-Software) is not installable from npm, which breaks P-11 tooling, and three's `KTX2Loader` starts its transcoder in `blob:` workers, which the CSP `worker-src 'self'` (REQ-GEN-010) blocks. KTX2 may return only through a later amendment once a same-origin transcoder worker exists. Draco stays banned.)*

- **AC-AST-010.1** Given a built part, When inspected, Then it uses `EXT_meshopt_compression`, declares neither `KHR_texture_basisu` nor `KHR_draco_mesh_compression`, every `images[].mimeType` is `image/png` with width and height ≤ the REQ-AST-010 limit for its kind, and all node and bone names equal the source names (case-sensitive, e.g. `Head` stays `Head`). *(Amended 2026-10-08 (M1 D1, D2): was "uses `KHR_texture_basisu`".)*
- **AC-AST-010.2** Given a fixture clip, When resampled, Then every sampled bone transform at 30 Hz differs from the source by ≤ 1e-4 (position m, quaternion components).

**REQ-AST-011 [P1]** THE SYSTEM SHALL normalize outputs to meters, +Y up and the character facing +Z, and SHALL bake any armature-root transform so that `RigDefinition` bind poses hold. *(M1-gated: the source orientation is confirmed by verify-rig.)*

- **AC-AST-011.1** Given a fixture exported at 100× scale facing −Z, When built, Then the body's bounding box height is within 1 % of the reference and its forward vector is +Z.

**REQ-AST-012 [P1]** THE SYSTEM SHALL write a per-vertex body-region attribute `_REGION` (unsigned byte, `BodyRegion` index as fixed by REQ-AST-025) on body parts, assigning each vertex to the region of its highest-weight joint via `RigDefinition.regionBones`, so the engine can hide regions (spec 001 REQ-CMP-011) without separate meshes.

- **AC-AST-012.1** Given the fixture body, When built, Then every vertex has a `_REGION` value, and vertices weighted ≥ 0.5 to `hand_l` carry the `hands` index.
- **AC-AST-012.2** Given a joint not listed in any `regionBones` entry, When built, Then the build fails with `AST_REGION_UNMAPPED` naming the joint.

**REQ-AST-013 [P1]** THE SYSTEM SHALL generate `assets/packs/<packId>/manifest.json` (`PartManifest`, spec 001) and, for animation packs, `clips.json` (`ClipManifest`, spec 004), filling computed fields (`file`, `rig`, `sha256`, `stats.triangles`, `stats.textures`, `durationSec`, `hasRootMotion`, `thumbnail`, `skeletonGroup`) from the outputs and authored fields (`id`, `name`, `slot`, `hides`, `tintSlots`, `alsoOccupies`, `bodyType(s)`, `bodies`, `characterSkeletonGroup`, `tags`, `socket`, `license`) from `pack.config.json`. The manifest embeds a copy of `packages/parts-schema/rigs/<rigId>.json` in `rigs[]`, and `assets:check` fails with `AST_MANIFEST_STALE` when the copy differs. *(Amended 2026-10-08 (M1 PM rig update a): `skeletonGroup`, `characterSkeletonGroup`, `bodies` and the embedded rig copy added; clip entries also get `sha256`, spec 004.)*

- **AC-AST-013.1** Given a build, When `manifest.json` is validated with `@csg/parts-schema`, Then it passes, and each entry's `sha256` equals the SHA-256 of its file.
- **AC-AST-013.2** Given `manifest.json` is edited by hand, When `pnpm assets:check` runs, Then it fails with `AST_MANIFEST_STALE` and says to edit `pack.config.json` instead.

**REQ-AST-014 [P1]** THE SYSTEM SHALL make builds deterministic: running the build twice on the same sources with the same tool versions SHALL produce byte-identical outputs (single-threaded texture encoding, sorted iteration, no timestamps).

- **AC-AST-014.1** Given the fixture sources, When the build runs twice in clean folders, Then every output file's SHA-256 matches.

**REQ-AST-015 [P2]** THE SYSTEM SHALL render a 128×128 px WebP thumbnail per part (part on the pack's reference body, three-quarter camera, toon material, transparent background) and per character preset, with `pnpm assets:thumbnails`, using Playwright Chromium with `forceWebGL`.

- **AC-AST-015.1** Given a built pack, When thumbnails run, Then each part has `thumbnails/<partId>.webp` of exactly 128×128 px and ≤ 12 KB, and the manifest `thumbnail` field points to it.
- **AC-AST-015.2** Given a static prop, When its thumbnail is rendered, Then the prop is shown alone and framed to fill ≥ 60 % of the image height.

### Budgets, licensing and integrity

**REQ-AST-016 [P1]** THE SYSTEM SHALL enforce per-file budgets on built outputs: bodies ≤ 20,000 triangles, skinned parts ≤ 10,000, static props ≤ 5,000; ≤ 4 textures per file; ≤ 4 joint influences per vertex; and the default character plus its default clips ≤ 15 MB total transfer size.

- **AC-AST-016.1** Given a fixture part with 10,001 triangles, When `assets:check` runs, Then it fails with `AST_BUDGET_TRIANGLES` naming the part and the limit.
- **AC-AST-016.2** Given the default `CharacterSpec` (spec 001) and default clips, When the sizes of their files are summed, Then the total is ≤ 15 MB (architecture §4.3).

**REQ-AST-017 [P1]** THE SYSTEM SHALL require a license record (`license`, `author`, `sourceUrl`) for every pack and accept only `CC0-1.0` or `CC-BY-4.0` for bundled assets; any other license SHALL fail the check (P-02, REQ-GEN-008).

- **AC-AST-017.1** Given a pack config with license `CC-BY-SA-4.0`, When `assets:check` runs, Then it fails with `AST_LICENSE_NOT_ALLOWED`.
- **AC-AST-017.2** Given a part with a `license` override lacking `author`, When validated, Then validation fails naming the part ID and `author`.

**REQ-AST-018 [P1]** THE SYSTEM SHALL generate the bundled-assets section of `ASSETS_LICENSE.md` from the manifests (`pnpm assets:licenses`), and CI SHALL fail when the committed file differs from the generated one.

- **AC-AST-018.1** Given a new pack added without regenerating, When CI runs, Then the job fails with a diff showing the missing pack entry.

**REQ-AST-019 [P1]** THE SYSTEM SHALL keep IDs stable: a part or clip ID removed from a manifest SHALL be listed in `assets/packs/<packId>/retired-ids.json`, and a retired ID SHALL never be reused.

- **AC-AST-019.1** Given a part ID removed from `pack.config.json` but not added to `retired-ids.json`, When `assets:check` runs, Then it fails with `AST_ID_REMOVED` naming the ID.
- **AC-AST-019.2** Given a new part whose ID is in `retired-ids.json`, When checked, Then it fails with `AST_ID_REUSED`.

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
- **AC-AST-025.3** Given a built body whose `_REGION` holds a value ≥ 11, When `pnpm assets:check` runs, Then it fails with `AST_REGION_INVALID` naming the part and the number of invalid vertices.

**REQ-AST-026 [P1]** THE SYSTEM SHALL classify every skinned mesh and clip whose bone names, parents, joint count, `lengthAxis`, armature root transform, unit scale, up axis and clip targets match the `RigDefinition` (REQ-AST-003 a, b, e–h, "structurally compatible") into the rig's **skeleton groups**: sets of files whose rest poses agree within the REQ-AST-004 tolerances. In `assets:build` and in `assets:check` (verify-rig `--built` mode), a bind-pose difference between a structurally compatible file and the reference SHALL be reported as `warn` naming the file's skeleton group, and SHALL NOT fail the command; a structural difference SHALL fail with `AST_RIG_MISMATCH`. Standalone `pnpm assets:verify-rig` keeps per-item statuses against the reference file (AC-AST-003.3) and reports the groups and the outcome `mapped`. *(Added 2026-10-08, M1 PM rig update a.)*

- **AC-AST-026.1** Given the fixture rig with skeleton groups `g-a` and `g-b` (`g-b` differs only in the `pelvis` rest translation by 0.05 m), a body in `g-a` and a shirt in `g-b`, When `pnpm assets:build` and `pnpm assets:check` run, Then both exit 0, the shirt's manifest entry has `skeletonGroup: 'g-b'`, and the check output has a `warn` line for the shirt naming `g-b` and `pelvis`.
- **AC-AST-026.2** Given the same fixture with one shirt bone renamed (`hand_r` → `Hand_R`), When `pnpm assets:build` runs, Then it fails with `AST_RIG_MISMATCH` (REQ-AST-022 AC-AST-022.2).
- **AC-AST-026.3** Given verify-rig `--write-canonical` on the fixtures, When the rig JSON is written, Then `skeletonGroups` holds one entry per group whose ID comes from the overlay, with a rest-pose local transform (translation, rotation quaternion, scale) for every bone in `bones`.
- **AC-AST-026.4** Given a structurally compatible part whose rest pose matches no declared group, When built, Then the build succeeds with warning `AST_SKELETON_GROUP_UNMATCHED` naming the part, and its manifest entry has no `skeletonGroup`.
- **AC-AST-026.5** Given the committed `assets/reports/rig-report.json`, When validated, Then it has `outcome`, `referenceFile` and `skeletonGroups`, and every `skinned-mesh` item's file appears in exactly one group.

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
- Contributor without a GPU → `assets:build` and `assets:check` need no GPU; only thumbnails need Playwright (software GL allowed).

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

*(Example amended 2026-10-08 (M1 D4): M1 bundles only the free Superhero male and female bodies (`bodyType: 'superhero'`); outfit parts fit them through `bodies` and tuned `hides` (the vendor readme uses only the head of the body under outfits); extracting the Regular bodies from the combined outfit files is deferred. Exact `hides` lists are tuned during M1 visual review. A body entry may set `characterSkeletonGroup` (REQ-AST-026, spec 001 REQ-CMP-037), e.g. `"characterSkeletonGroup": "male-outfits"` on `superhero-m`.)*

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

Output layout: `assets/packs/<packId>/{manifest.json, clips.json?, parts/*.glb, clips/*.glb, thumbnails/*.webp, presets/**/*.json, retired-ids.json}`.

## Non-functional

- NFR-1 (P-02): no bundled file without a license record; `ASSETS_LICENSE.md` generated and checked.
- NFR-2 (P-11): contributing a part or pack needs only open-source tools (Blender, Node, pnpm) and data edits.
- NFR-3 (P-07): default character + default clips ≤ 15 MB; `assets:check` ≤ 60 s in CI.
- NFR-4: tools run on Linux, macOS and Windows (Node LTS), no GPU except thumbnails.

## Open questions

- [NEEDS CLARIFICATION: Which Quaternius tiers do we bundle? The free Standard tiers are limited: UBC Standard has 2 bodies and 5 hairstyles, the Outfits page says only Ranger and Peasant are free, and UAL Standard has 45 clips. Paid tiers (UBC Source $19.99, Outfits Source $20, UAL Pro $9.99) are also CC0, so redistribution is legal, but bundling paid content is a courtesy and community question. Blocks the content list and the default character, not the tools. Owner: project owner.]
- [NEEDS CLARIFICATION: Do built packs (tens of MB of GLB/KTX2) go in git directly, in Git LFS, or in release artifacts fetched at build time? Affects clone size and the "no proprietary tool" rule (P-11). Owner: maintainers.]
- [NEEDS CLARIFICATION: Allow `CC-BY-4.0` for bundled assets (REQ-AST-017), or CC0 only? CC-BY adds an attribution duty to users' games (handled by CREDITS.txt). Proposal: allow, with an export warning. Owner: project owner.]
- [NEEDS CLARIFICATION: If KTX2 (Basis) encoding is not byte-deterministic even single-threaded, should REQ-AST-014 exempt texture bytes and compare decoded pixels instead? Deferred with KTX2 (REQ-AST-010 as amended 2026-10-08, M1 D2); reopen when KTX2 returns.]
- [NEEDS CLARIFICATION: Spec 008 AC-UPL-054.1 says no Meshopt decoder file is requested in a page that equips stored user assets outside the upload worker. Bundled packs now need the in-thread Meshopt decoder on the main thread (REQ-AST-029), so a session with a bundled body and user parts would request it. Proposal: scope AC-UPL-054.1 to the user-asset loader (it must not register the decoder) rather than the whole page. Owner: spec-writer for 008 with the security reviewer; blocks nothing in M1, must be settled before M5.]
- [NEEDS CLARIFICATION: When KTX2 returns, which same-origin transcoder setup is used (a self-hosted `worker-src 'self'` module worker, or calling the Basis WASM on the main thread)? Shared with spec 000 / 008 open questions on `KTX2Loader` blob workers. Owner: asset-pipeline-engineer; not blocking (PNG in M1).]
- M1 D4 (2026-10-08): fit groups for M1 are answered as "Superhero bodies only, outfits restricted with `bodies` and tuned `hides`". Whether to add Regular bodies extracted from the combined outfit files is reopened only if the M1 visual review shows neck, wrist or ankle seams that `hides` cannot cover (spec 001 open question).
- [NEEDS CLARIFICATION: The vendor pages give different counts (Outfits: 62 vs 82 parts; UBC: 6 vs 8 bodies). verify-rig output becomes the authoritative inventory.]

## References

- ADR-0001 (shared-skeleton risk and fallbacks), ADR-0005 (user assets separate), `docs/architecture.md` §1.1, §4.3, §4.8, §5 (M1), §7
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
