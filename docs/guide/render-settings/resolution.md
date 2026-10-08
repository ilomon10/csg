---
title: Resolution
description: Set the width and height of each sprite frame from 32 to 128 pixels, and see how the preview and export scale that size.
---

# Resolution

Resolution is the size of one frame, in pixels. You can set the width and height separately, from 32 to 128 pixels each. The default is 64 by 64.

<!-- TODO(screenshot): Resolution fields in the Render tab with a 32 by 48 frame in Pixel view -->

## Choose a size

- Use whole numbers only. Fractions are not allowed.
- Non-square frames are fine, for example 32 by 48 for a tall character.
- Smaller frames look blockier and keep the silhouette simple. Larger frames show more detail.

## How the size reaches your screen

- The **preview** scales the frame up by a whole number, so every sprite pixel becomes a square of equal size. Nothing is blurred.
- The **export** writes each frame at the size you set. You can also export 2x, 4x or 8x copies. These repeat each pixel, so they stay sharp.

## Sheet size limits

A sprite sheet cannot be larger than 8192 pixels in either direction. The export dialog stops before rendering if a sheet would be too large, and tells you what to change, such as fewer scales or fewer columns. See [Sheet layouts](../export/sheet-layouts.md).

> [!NOTE]
> A sheet wider or taller than 4096 pixels may not load in some game engines or on older phones. The export still runs, and it shows a warning.

<!-- spec: REQ-PIX-001 -->
<!-- spec: REQ-PIX-002 -->
<!-- spec: REQ-EXP-025 -->
