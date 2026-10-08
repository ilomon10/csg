---
title: Sheet layouts
description: Compare the grid, strip and per-frame ZIP layouts, and set scale, padding, margin and column wrapping for your sprite sheets.
---

# Sheet layouts

The layout decides how frames are arranged in the files. Pick the one your game expects.

## Layouts

| Layout              | What you get                                                       | Use it when                                    |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Grid by animation   | One PNG. One row per animation and direction, one column per frame | Your engine reads one texture with many frames |
| Strip per animation | One PNG per animation. One row per direction                       | You want a separate image for each animation   |
| Frames as ZIP       | One PNG per frame, in folders by animation and direction           | You want each frame as its own file            |

In **Grid by animation**, rows run animation by animation by default. Choose **Direction first** to put all the rows of one direction together.

Each row holds the frames of one animation and one direction. If an animation has fewer frames than the longest one, the empty cells at the end are transparent.

## Wrapping columns

Set **Max columns** from 1 to 256 to wrap long rows onto the next line. A row never mixes frames from two animations or two directions.

## Padding and margin

- **Padding** adds empty pixels between neighbouring frames, from 0 to 16. It stops neighbouring frames from bleeding into each other when a game scales the sheet.
- **Margin** adds empty pixels around the outside edge, from 0 to 16.

Both are transparent. The default for both is 0.

## Scales

Choose one or more of **1x**, **2x**, **4x** and **8x**. Each scale gets its own sheet. Scaled sheets repeat every pixel as a square block, so they look exactly like the 1x sheet, only bigger. At least one scale must be chosen.

## Example

A character in 8 directions at 64 by 64 pixels, with two animations: `idle` with 4 frames, and `walk` with 8 frames. In **Grid by animation** at 1x, the sheet is 512 by 1024 pixels.

- The width is 8 frames of 64 pixels.
- The height is 16 rows of 64 pixels, one for each animation and direction.
- Row 1 is `idle` facing `e`, and row 9 is `walk` facing `e`.

> [!NOTE]
> **Planned.** Sizing sheets to powers of two, and extruding the edge pixels of each frame into the padding, are planned for a later release. Indexed PNG files, which use a palette, are also planned.

<!-- spec: REQ-EXP-003 -->
<!-- spec: REQ-EXP-004 -->
<!-- spec: REQ-EXP-005 -->
<!-- spec: REQ-EXP-006 -->
<!-- spec: REQ-EXP-009 -->
