---
title: Look presets
description: Four built-in looks that set lighting, outline, palette and dithering in one step, plus the Look panel for fine-tuning.
---

# Look presets

A **look** is the set of render settings that gives your sprites their style: the light, the toon shading, the outline, the palette and the dithering. A **look preset** sets all of them in one step. Then you can fine-tune the result in the **Look** panel.

<!-- TODO(screenshot): Look panel with the preset picker on Classic 16-bit and its controls -->

## The four presets

| Preset | What it looks like |
|--------|--------------------|
| Classic 16-bit | The default look, with exact colors and a clear black outline. |
| GameBoy 4-color | Four shades of green (`#081820`, `#346856`, `#88c070` and `#e0f8d0`), a 4×4 dither pattern, and a 1-pixel dark outline. |
| NES-like | The 55-color NES palette, two toon bands, and no dithering. |
| Hi-bit | The 32-color Endesga palette, four toon bands, a rim of light, and inner outlines. |

Each preset has a thumbnail and a one-line description. Choose a preset to apply it.

## The Look panel

The Look panel is for quick changes. It has:

- A **preset picker** at the top.
- Up to ten controls, such as sliders, color pickers and checkboxes. Each one has a label and a **Reset** button that returns it to the preset's value.

Applying a preset over a look you have changed asks you to confirm first. The change is one undo step.

In Pro, the Look panel is in the **Render** tab of the inspector. The full settings are below it. See [Render settings](./index.md).

## The full render settings

The **Render** tab also holds every setting the look is made of:

- **Resolution**: the width and height of each frame, from 32 to 128 pixels. See [Resolution](./resolution.md).
- **Camera**: side, three-quarter or isometric. See [Camera styles](./camera-styles.md).
- **Directions**: 1, 2, 4 or 8 facings. See [Directions](./directions.md).
- **Palette** and **Dither**. See [Palettes and dithering](./palettes-and-dither.md).
- **Outline**, **Toon** and **Light**. See [Toon shading and outlines](./toon-and-outlines.md).

A value that is not allowed is marked with a message next to its field. The preview keeps the last good value until you fix it.

## What is planned

> [!NOTE]
> **Planned.** Custom camera angles, mirrored directions, importing a palette from a `.hex` or `.gpl` file, and looks built from shader graphs are planned for later releases.

<!-- spec: REQ-EDT-034 -->
<!-- spec: REQ-EDT-044 -->
<!-- spec: REQ-EDT-045 -->
<!-- spec: REQ-PIX-037 -->
<!-- spec: REQ-PIX-018 -->
