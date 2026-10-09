---
title: Render settings overview
description: Where the Render tab sets the camera, directions, size, lighting, toon bands, outlines, palette and alpha, and the default look each one starts from.
---

# Render settings overview

The **Render** tab controls how your character becomes pixels. The settings here also apply to the export.

The settings are changed in the **Render** tab of the Pro workspace. The defaults on these pages are the values the pixel pipeline starts from.

<!-- TODO(screenshot): Render tab with the camera, directions and resolution sections visible -->

## What each section controls

| Section    | What it sets                                          | Page                                                |
| ---------- | ----------------------------------------------------- | --------------------------------------------------- |
| Camera     | Side, three-quarter or isometric view, and framing    | [Camera styles](./camera-styles.md)                 |
| Directions | How many facings to draw, from 1 to 8                 | [Directions](./directions.md)                       |
| Resolution | Width and height of each frame, from 32 to 128 pixels | [Resolution](./resolution.md)                       |
| Lighting   | The direction of the key light and ambient light      | [Toon shading and outlines](./toon-and-outlines.md) |
| Toon       | Number of shading bands and rim light                 | [Toon shading and outlines](./toon-and-outlines.md) |
| Outline    | Outer and inner outlines, and their colors            | [Toon shading and outlines](./toon-and-outlines.md) |
| Palette    | A fixed set of colors, and dithering                  | [Palettes and dithering](./palettes-and-dither.md)  |
| Alpha      | How see-through a pixel must be to stay visible       | See below                                           |

## Default look

- **Resolution:** 64 by 64 pixels.
- **Key light:** 135 degrees around the screen (upper left) and 45 degrees high.
- **Ambient:** 0.1.
- **Toon bands:** 3, evenly spaced.
- **Rim light:** on, strength 0.5.
- **Outer outline:** on, 1 pixel, black.
- **Inner lines:** on, darkened by 0.6, drawn where parts meet.
- **Palette:** none (exact colors).
- **Dither:** none, strength 0.5.
- **Alpha cutoff:** 0.5.

Camera defaults (directions, pivot row) depend on the camera you choose. See [Camera styles](./camera-styles.md).

## Alpha cutoff

Every pixel in the export is either fully visible or fully transparent. The **alpha cutoff** decides the boundary. A pixel whose opacity reaches the cutoff is kept, and anything below it is removed. The cutoff can be from 0.01 to 1. The default is 0.5.

## Pixel view matches the export

The preview is designed to show exactly the frame that the export will contain, at the same size and with the same colors. You do not need to export to check a change.

## Look presets

Four built-in looks set the lighting, outline, palette and dithering in one step: Classic 16-bit (the default), GameBoy 4-color, NES-like and Hi-bit. See [Look presets](./look-presets.md).

<!-- spec: REQ-PIX-003 -->
<!-- spec: REQ-PIX-037 -->
