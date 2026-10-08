---
title: Render settings overview
description: Where the Render tab sets the camera, directions, size, lighting, toon bands, outlines, palette and alpha, and how those settings reach the exported sprites.
---

# Render settings overview

The **Render** tab controls how your character becomes pixels. Every setting here also applies to the export.

<!-- TODO(screenshot): Render tab with the camera, directions and resolution sections visible -->

## What each section controls

| Section    | What it sets                                          | Page                                                |
| ---------- | ----------------------------------------------------- | --------------------------------------------------- |
| Camera     | Side, three-quarter or isometric view, and framing    | [Camera styles](./camera-styles.md)                 |
| Directions | How many facings to draw, from 1 to 8                 | [Directions](./directions.md)                       |
| Resolution | Width and height of each frame, from 32 to 128 pixels | [Resolution](./resolution.md)                       |
| Lighting   | The direction of the key light and ambient light      | [Toon shading and outlines](./toon-and-outlines.md) |
| Toon       | Number of shading bands and rim light                 | [Toon shading and outlines](./toon-and-outlines.md) |
| Outline    | Outer and inner outlines, and their color             | [Toon shading and outlines](./toon-and-outlines.md) |
| Palette    | A fixed set of colors, and dithering                  | [Palettes and dithering](./palettes-and-dither.md)  |
| Alpha      | How see-through a pixel must be to stay visible       | See below                                           |

## Alpha cutoff

Every pixel in the export is either fully visible or fully transparent. The **alpha cutoff** decides the boundary. A pixel whose opacity reaches the cutoff is kept, and anything below it is removed. The default is 0.5.

## Pixel view matches the export

The viewport shows the exact frame that the export will contain, at the same size and with the same colors. You do not need to export to check a change. Switch to **Pixel** view to see it.

## Look presets

The four built-in looks change the lighting, outline, palette and dithering in one step. They are **Classic 16-bit** (the default), **GameBoy 4-color**, **NES-like** and **Hi-bit**. Choose one from the look picker in the Look panel. See [Shader graph](../shader-graph/index.md).

<!-- spec: REQ-PIX-003 -->
<!-- spec: REQ-PIX-037 -->
