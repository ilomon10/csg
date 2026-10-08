---
title: Asset pipeline
description: How source packs become optimized, licensed parts and clips. License rules, Blender export settings, pack.config.json fields, budgets and the asset commands.
---

The asset pipeline turns source packs into the parts, clips and manifests the editor loads. This guide covers what you need to contribute assets. Spec 011 (`specs/011-asset-pipeline.md`) is the source of truth. It is still draft, and some commands below are being added (see [Development setup](./development-setup)).

## Licenses

- Bundled assets must be `CC0-1.0`. `CC-BY-4.0` is under discussion (spec 011).
- Every pack has a `license` record with `license`, `author` and `sourceUrl`. A pack without one fails `pnpm assets:check`.
- Record the license of anything you add. Do not add an asset whose license you have not verified.
- `pnpm assets:licenses` regenerates the bundled section of `ASSETS_LICENSE.md` from the manifests. Do not edit that section by hand.

## Source files

- Source packs for bundled content go in `assets-src/<packId>/`. That folder is gitignored and never committed. Download packs by hand from the vendor site (no automatic download, NG1). Each source is listed in `tools/asset-sources.json` with its SHA-256. A hash mismatch stops the tools with `AST_SOURCE_HASH_MISMATCH`.
- Community packs keep their source GLB files in `tools/packs/<packId>/src/`. Only community packs commit sources this way.
- Accepted format is glTF 2.0 (`.gltf` or `.glb`). For FBX or Blender files, convert to GLB first. A `.fbx` file fails with `AST_SOURCE_FORMAT`.

### Convert FBX or Blender files

1. Open the file in Blender.
2. Apply the transforms (scale 1, rotation 0) on the armature and the meshes.
3. Export as glTF Binary (`.glb`) with the settings in the next section.

## Blender export settings

- Format: glTF Binary (`.glb`), glTF 2.0.
- Units: meters. One Blender unit equals one meter.
- Up axis: +Y up. The character faces +Z.
- Armature: the canonical bone names from `packages/parts-schema/rigs/<rigId>.json`. Renamed or extra bones fail with `AST_RIG_MISMATCH`.
- Skinning: at most 4 bone influences per vertex. Normalize the weights.
- One mesh per part, with a name that matches the `match.node` pattern in `pack.config.json`.

If `pnpm assets:verify-rig` reports a rig mismatch, re-skin the part in Blender to the canonical armature and export again.

## pack.config.json

Each pack has `tools/packs/<packId>/pack.config.json`. It holds the authored data for the pack:

- `format` and `version`, `packId`, `name`, `source`.
- `license`: `license`, `author`, `sourceUrl`.
- `rig`: the `RigId` the pack is skinned to.
- `parts`: one entry per part (see [Adding parts](./adding-parts)).
- `clips`: one entry per animation clip or clip group.

Generated files are never edited. The build writes `manifest.json` and `clips.json` from this file and the outputs.

## Budgets

| Limit                                | Value                                                  |
| ------------------------------------ | ------------------------------------------------------ |
| Body triangles                       | at most 20,000                                         |
| Skinned part triangles               | at most 10,000                                         |
| Static prop triangles                | at most 5,000                                          |
| Textures per file                    | at most 4                                              |
| Texture size                         | 1024 px max for bodies, 512 px max for parts and props |
| Bone influences per vertex           | at most 4                                              |
| Default character plus default clips | at most 15 MB transfer size                            |

`pnpm assets:check` fails with the matching `AST_BUDGET_*` code when a file goes over.

## Commands

Run these from the repository root:

```sh
pnpm assets:build --pack <packId>   # split, optimize, write manifest.json
pnpm assets:check                   # validate built packs (no assets-src needed)
pnpm assets:verify-rig              # check every skinned part and clip against the rig
pnpm assets:licenses                # regenerate the bundled section of ASSETS_LICENSE.md
pnpm assets:thumbnails              # render part thumbnails (needs Playwright Chromium)
```

`assets:build` and `assets:check` need no GPU. Only `assets:thumbnails` uses a browser.

## Adding a community pack

1. Create `tools/packs/<packId>/` with `pack.config.json`.
2. Put your GLB files in `tools/packs/<packId>/src/`.
3. Describe the parts in `pack.config.json`.
4. Run `pnpm assets:build --pack <packId>`, then `pnpm assets:check`.

No TypeScript change is needed (REQ-AST-022).

## Stable IDs

- Part and clip IDs never change and are never reused.
- If you remove an ID, list it in `assets/packs/<packId>/retired-ids.json`. Otherwise `pnpm assets:check` fails with `AST_ID_REMOVED`.
- Reusing a retired ID fails with `AST_ID_REUSED`.

## Determinism

Builds are deterministic. Running the build twice on the same sources with the same tool versions must give byte-identical output. Do not add timestamps or random values to the build.

## Pull requests

When a PR touches `assets/` or `tools/packs/`, fill in the asset section of the PR template (planned, REQ-AST-023). Include the source and version of each asset, its license, and the output of `pnpm assets:check`.
