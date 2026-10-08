---
title: Chibi and readability
description: Why small sprites need exaggerated proportions, how the chibi preset helps, and the readability hints planned for small output sizes.
---

# Chibi and readability

At 32 or 64 pixels, realistic proportions break down. A head becomes a four-pixel blob, forearms disappear, and faces are lost. Exaggerated proportions keep a character readable at small sizes.

## Use the chibi preset

The **Chibi** preset makes the head large and the limbs short. It is the best starting point for a sprite of 32 to 64 pixels.

Apply it in the **Anatomy** tab, then adjust:

1. If the head is too large, lower **Head** a little.
2. If the arms are too thin to see, raise **Limb thickness**.
3. If the feet are lost, raise **Feet**.

Check each change in **Pixel** view at the size you will export. Zoom in with `+` to see details, then zoom out to see what the game will show.

## Pick a size for the style

| Size             | Good for                                               |
| ---------------- | ------------------------------------------------------ |
| 32 pixels        | Tiny characters, strong silhouettes, chibi proportions |
| 48 to 64 pixels  | Most platformers and RPGs                              |
| 96 to 128 pixels | Detailed sprites, usually with realistic proportions   |

The **Realistic** preset is meant for 96 to 128 pixels.

> [!NOTE]
> **Planned.** A readability hint will appear when a forearm or shin is narrower than 2 pixels, or the head is shorter than 6 pixels, at the current size. It will name the slider to fix it, such as **Limb thickness**.

<!-- spec: REQ-ANA-013 -->
<!-- spec: REQ-ANA-015 -->
