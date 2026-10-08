---
title: Adding parts
description: Add a character part (outfit, hair, prop) to a pack by editing pack.config.json and running the asset scripts. No engine code.
---

Parts are data. You add one by editing a pack's `pack.config.json` and building the pack. You never edit the generated `manifest.json` and you never change engine code (constitution P-11). The full pipeline is in [Asset pipeline](./assets) and spec 011 (`specs/011-asset-pipeline.md`). Check that spec's status before you open a PR: it is still draft.

## 1. Check the license

Every pack has a license record with `license`, `author` and `sourceUrl`. Bundled assets must be `CC0-1.0`. `CC-BY-4.0` is still under discussion in spec 011. A part from a different source needs its own `license` override, and an override without an `author` fails validation and names the part ID (AC-AST-017.2).

## 2. Check the rig

- A skinned part must use the bone names of the canonical rig. Run `pnpm assets:verify-rig` to see missing or extra bones.
- A static prop attaches to one socket bone: `hand_r`, `hand_l`, `head`, `spine_03` or `pelvis`.

## 3. Add the entry to pack.config.json

Edit `tools/packs/<packId>/pack.config.json`. These are the authored fields:

| Field          | Meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `id`           | Stable part ID. Never reuse an ID, even after removal.                   |
| `name`         | Label shown in the picker.                                               |
| `slot`         | Slot ID from spec 001, for example `torso`, `headwear` or `feet`.        |
| `match`        | `file` and `node` that select exactly one node in the source GLB.        |
| `hides`        | Body regions the part covers, so the base body does not clip through it. |
| `tintSlots`    | Maps a GLB material name to a tint slot, for example `primary`.          |
| `alsoOccupies` | Other slots the part takes up.                                           |
| `bodyTypes`    | Body types the part fits.                                                |
| `tags`         | Search tags.                                                             |
| `socket`       | For a static prop: its socket bone.                                      |
| `license`      | Only when the part differs from the pack license.                        |

Example entry (illustrative values):

```json
{
  "id": "ranger-torso",
  "match": {"file": "Ranger.gltf", "node": "Ranger_Body"},
  "name": "Ranger tunic",
  "slot": "torso",
  "hides": ["torso", "upper-arms"],
  "tintSlots": [{"material": "Cloth", "slot": "primary"}],
  "bodyTypes": ["regular"],
  "tags": ["ranger", "light-armor"]
}
```

Rules:

- `match` must match exactly one node. A pattern that matches nothing fails with `AST_CONFIG_UNMATCHED`.
- If you remove a part, add its ID to `assets/packs/<packId>/retired-ids.json`. Otherwise `pnpm assets:check` fails with `AST_ID_REMOVED`.

## 4. Build the pack

```sh
pnpm assets:build --pack <packId>
```

This splits the source into one GLB per part, optimizes each file, and generates `assets/packs/<packId>/manifest.json`. The generated fields are `file`, `rig`, `sha256`, `stats` and `thumbnail`. Do not edit them by hand.

## 5. Check the build

```sh
pnpm assets:check
pnpm assets:verify-rig
pnpm test
```

- `assets:check` validates schemas, hashes, budgets, licenses and ID stability. It fails with `AST_MANIFEST_STALE` if `manifest.json` was edited by hand, and says to edit `pack.config.json` instead.
- `assets:verify-rig` compares the part against the canonical rig and writes a report to `assets/reports/`.

## 6. Check it visually

Once the composer exists, run `pnpm --filter @csg/web dev`, equip the part, and check the fit at 64 px. Include a screenshot in the PR.

## 7. Update the license list

Run `pnpm assets:licenses`. It regenerates the bundled section of `ASSETS_LICENSE.md` from the manifests. Do not edit that section by hand. CI fails when the committed file differs from the generated one (planned).

## In the pull request

- Cite the spec IDs that cover the part's slot and rig.
- Name the asset source and version you used.
- Attach the screenshot from step 6.
- Fill in the asset section of the PR template (REQ-AST-023, planned).
