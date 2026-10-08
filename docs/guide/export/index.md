---
title: Exporting sprite sheets
description: Export your character as a ZIP with a sprite sheet, metadata, a manifest and a credits file, and what the export dialog checks before it runs.
---

# Exporting sprite sheets

Export turns your character into files a game can use. Every export is one ZIP download, and the ZIP always contains a `CREDITS.txt`.

<!-- TODO(screenshot): export dialog showing layout, scales, metadata and the Export button -->

## Export a sheet

1. Set up the character, camera, animations and size.
2. Click **Export** in the top bar, or press `Ctrl+E`.
3. Choose a layout, the scales you want, and the metadata format. See [Sheet layouts](./sheet-layouts.md).
4. Optionally choose an engine preset. See [Using in game engines](./using-in-game-engines.md).
5. Click **Export**. A progress bar shows the render and packaging steps.
6. Your browser downloads `<name>.zip`.

You can cancel at any time. Cancelling stops the export within a fraction of a second, and nothing is downloaded. Your character is unchanged.

## What is in the ZIP

- The sprite sheet PNG, one per scale you chose.
- An Aseprite-style JSON file that describes every frame. See [Metadata and file names](./metadata-json.md).
- A manifest JSON file with the exact settings and version that made the sheet.
- `CREDITS.txt`, which lists every asset used. See [Credits and licensing](./credits-and-licensing.md).

The same settings on the same browser always give byte-identical files.

## Warnings and limits

The export dialog checks your settings before it starts.

- **Licenses**: if an asset has an unknown license, a non-commercial license or a share-alike license, a dialog lists those assets. The export starts only after you confirm.
- **Too large**: a sheet larger than 8192 pixels, more than 4096 frames, or more than 512 MB of image data is refused. The message names the limit and suggests a fix.
- **Large textures**: a sheet wider or taller than 4096 pixels exports, with a warning that some engines cannot load it.
- **Empty frames**: if every frame is transparent, the editor warns you before the download.

<!-- spec: REQ-EXP-017 -->
<!-- spec: REQ-EXP-018 -->
<!-- spec: REQ-EXP-021 -->
<!-- spec: REQ-EXP-024 -->
<!-- spec: REQ-EXP-025 -->
<!-- spec: REQ-EXP-027 -->
