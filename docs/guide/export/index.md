---
title: Exporting sprite sheets
description: Export your character as one ZIP with sprite sheets, metadata, a manifest and a credits file, what the export dialog checks before it runs, and how to cancel.
---

# Exporting sprite sheets

Export turns your character into files a game can use. Every export is one ZIP download, and the ZIP always contains a `CREDITS.txt`.

<!-- TODO(screenshot): export dialog with the layout, scales, metadata and the Export button -->

## Export a sheet

1. Set up the character, the animations (Pro, **Animation** tab) and the size and camera (Pro, **Render** tab).
2. Click **Export** in the bottom bar (Easy) or the top bar (Pro), or press `Ctrl / Cmd+E`.
3. Choose a layout, the scales you want, the metadata and a base name. See [Sheet layouts](./sheet-layouts.md).
4. Click **Export**. A progress bar shows the render, encode and package steps.
5. Your browser downloads `<name>.zip`.

Export uses the settings you had when you pressed **Export**. You can keep editing while it runs, and the file will not include those later changes.

## What is in the ZIP

- One sheet PNG for each scale you chose, such as `<name>.png` and `<name>@2x.png`.
- An Aseprite-style JSON file that describes every frame, if you chose it. See [Metadata and file names](./metadata-json.md).
- A manifest JSON file with the exact settings and versions that made the sheet, if you chose a metadata format that includes it.
- `CREDITS.txt`, which lists every asset used. It is always included. See [Credits and licensing](./credits-and-licensing.md).

If the ZIP would hold only one file, it still comes as a ZIP, so the credits always travel with the sprites.

The same settings, from the same version of the editor and on the same graphics backend (WebGPU or WebGL2), always give byte-identical files. The files contain no dates, so you can keep them in version control.

## Checks before the export starts

The export dialog checks your settings first.

- **Coming-soon styles**: if the character uses a style or species that is not available yet, the export button is disabled and says why. See [Styles and species](../anatomy/styles-and-species.md).
- **Too large**: a sheet larger than 8192 pixels in either direction, more than 4096 frames, or more than 512 MB of uncompressed image data is refused before rendering. The message names the limit and suggests a fix.
- **Large sheets**: a sheet wider or taller than 4096 pixels exports, with a warning that some engines cannot load it.
- **Licenses**: if an asset has an unknown, non-commercial or share-alike license, a blocking dialog lists those assets. The export starts only after you confirm. See [Credits and licensing](./credits-and-licensing.md).
- **Empty frames**: if every frame is transparent, the editor warns you before the download.

## Progress and cancel

The progress bar goes through three steps: **render**, **encode** and **package**. The editor stays responsive while it works.

To cancel, press **Cancel**. The export stops within a quarter of a second. Nothing is downloaded, and your character is unchanged.

## Export options

| Option | Choices | Status |
| ------ | ------- | ------ |
| Layout | Grid by animation, strip per animation, frames as ZIP | Available |
| Row order | Clip first, or direction first | Available |
| Columns | No limit, or wrap rows after 1 to 256 frames | Available |
| Padding and margin | 0 to 16 pixels each | Available |
| Scales | 1×, 2×, 4× and 8× | Available |
| Metadata | None, manifest only, or Aseprite-style JSON with manifest | Available |
| Power-of-two sizes, edge extrusion, palette PNG, animated previews, engine presets | | Planned for later releases |

<!-- spec: REQ-EXP-009 -->
<!-- spec: REQ-EXP-011 -->
<!-- spec: REQ-EXP-017 -->
<!-- spec: REQ-EXP-018 -->
<!-- spec: REQ-EXP-020 -->
<!-- spec: REQ-EXP-021 -->
<!-- spec: REQ-EXP-023 -->
<!-- spec: REQ-EXP-024 -->
<!-- spec: REQ-EXP-025 -->
<!-- spec: REQ-EXP-027 -->
<!-- spec: REQ-CMP-044 -->
