---
title: Custom palette
description: Limit every color in your sprites to a palette you choose, with a dark color for outlines and optional dithering for smooth gradients.
---

# Custom palette

Use a custom palette when your game has its own colors. Every visible pixel is then matched to one of the colors you enter.

> [!NOTE]
> **Planned.** This recipe is planned for a later release. Entering colors by hand is part of the first release. Importing a palette file is planned.

## Steps

1. Open the **Render** tab.
2. Set **Palette** to **Custom**.
3. Enter your colors one at a time, as hex values such as `#2b2d42`. You can enter up to 256.
4. If you enter a color twice, the editor keeps the first one and tells you how many it removed.
5. Check the sprite in **Pixel** view at 64 pixels.

## Tips

- Include one dark color for outlines. If the outline is set to **Black** and your palette has no black, the darkest color is used instead. Adding your own dark color gives you more control.
- Include a light color for highlights, so the toon bands still show.
- Keep the palette small while you test. Add colors only when the sprite needs them.
- Add **Bayer 4x4** dithering at a low strength if your gradients look harsh.

## Check your work

Zoom in and look for colors that are not in your list. Every visible pixel should be one of your palette colors, or a dithered mix of two of them.
