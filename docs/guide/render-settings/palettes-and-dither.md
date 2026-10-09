---
title: Palettes and dithering
description: Limit a sprite to the PICO-8 or Endesga-32 palette, or to your own colors, and add ordered dithering to suggest gradients.
---

# Palettes and dithering

A palette limits every color in the sprite to a fixed list. Pixel artists use palettes to keep a set of sprites visually consistent. Dithering mixes palette colors in a pattern, so a gradient can look smooth with a short palette.

Set the palette and dithering in the **Render** tab of the Pro workspace. The palette is set to **None** by default, so the default look uses exact colors.

## Choose a palette

| Palette    | Colors   | Notes                                                     |
| ---------- | -------- | --------------------------------------------------------- |
| None       | Any      | No limit. Colors are exact, as the shading produces them. |
| PICO-8     | 16       | A classic fantasy-console palette.                        |
| Endesga-32 | 32       | A 32-color palette with wide variety.                     |
| Custom     | 1 to 256 | Your own list of colors. Duplicates are removed.          |

Each pixel is matched to the nearest palette color. Colors are compared by how they look to the eye, not by their raw numbers.

<!-- TODO(screenshot): Render tab palette picker with PICO-8 selected and the sprite recolored -->

## Custom palettes

Choose **Custom**, then enter hex colors one at a time. A custom palette needs at least one color and can hold up to 256. If you enter the same color twice, only the first one is kept, and the editor tells you how many were removed.

With one color, every visible pixel becomes that color, and only the outline and transparency still show shape.

> [!NOTE]
> **Planned.** Importing a palette from a `.hex` or `.gpl` file, which Lospec and GIMP export, is planned for a later release.

## Dithering

Dithering arranges palette colors in a fixed pattern, so the eye reads the mix as a shade in between. The pattern is tied to the screen position, so it repeats every 2, 4 or 8 pixels and is the same in every frame.

- **None** turns dithering off. This is the default.
- **Bayer 2x2**, **Bayer 4x4** and **Bayer 8x8** use a grid of different sizes. Bigger grids give a finer, smoother pattern.
- **Strength** sets how strong the pattern is, from 0 to 1. The default is 0.5.

Dithering needs a palette. With the palette set to **None**, dithering has no effect, and the editor says so.

> [!TIP]
> Start with **Bayer 4x4** at a low strength. It is the most common choice for pixel art gradients.

<!-- spec: REQ-PIX-018 -->
<!-- spec: REQ-PIX-019 -->
<!-- spec: REQ-PIX-021 -->
<!-- spec: REQ-PIX-022 -->
