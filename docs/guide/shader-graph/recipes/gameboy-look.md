---
title: GameBoy look
description: Recreate a four-shade green handheld look with a custom palette, a 4x4 dither and a dark outline, starting from the GameBoy preset.
---

# GameBoy look

This recipe gives sprites a four-shade green look. Every visible pixel uses one of four colors, and a fine dither suggests the in-between tones.

> [!NOTE]
> **Planned.** This recipe is planned for a later release. The **GameBoy 4-color** look preset gives the same result in one click.

## Fastest: use the preset

1. Open the **Look** panel.
2. Choose **GameBoy 4-color** from the look picker.
3. Check the sprite in **Pixel** view at 64 pixels.

## Build it yourself

1. Open the **Render** tab.
2. Set **Palette** to **Custom**.
3. Enter four greens, from darkest to lightest. Enter them one at a time.
4. Set **Dithering** to **Bayer 4x4** and **Strength** to about 0.3.
5. Set the outline to **Darken** with width 1.
6. Check the result at 64 pixels and at 32 pixels.

## Check your work

Zoom in on the sprite. Every visible pixel should be one of your four greens, or a dithered mix of two of them. If you see other colors, the palette is not active, so check step 2.

<!-- TODO(screenshot): GameBoy look sprite in Pixel view, 64 pixels -->
