---
title: Camera styles
description: Choose a side, three-quarter or isometric camera, and understand how framing and the pivot row keep every frame of a sheet aligned.
---

# Camera styles

The camera decides how your character looks from the outside. All three styles use a flat, orthographic projection. Nothing gets smaller with distance.

## Choose a camera

| Camera        | Best for       | Viewing angle | Default directions | Default pivot row |
| ------------- | -------------- | ------------- | ------------------ | ----------------- |
| Side          | Platformers    | 0 degrees     | 2                  | 2                 |
| Three-quarter | Top-down RPGs  | 35 degrees    | 8                  | 4                 |
| Isometric     | Isometric RPGs | 30 degrees    | 8                  | 6                 |

Choosing a camera also sets a sensible default for directions and the facing used when a sheet has only one direction.

<!-- TODO(screenshot): the same character in side view and in three-quarter view, side by side -->

The isometric camera uses a 2:1 ratio, so its pixels line up with the classic isometric grid.

## Framing

Framing decides how big the character is in each frame.

- **Auto** (the default) fits the character to the frame, using the largest pose across all animations. Every frame of one export uses the same scale, so a character never jumps in size between frames.
- **A fixed scale** sets how many world units each pixel covers. Use the same scale for every character in your game, so a tall knight and a short goblin stay in proportion.

If any part of the character would fall outside the frame, the export still runs and shows a warning that names the clip and direction.

## Pivot row

The pivot is the point where the character stands on the ground. In every frame, the feet sit on the same pixel row, so the character does not jitter when it plays. The pivot is counted from the bottom of the frame, and it is set per camera as shown in the table.

> [!NOTE]
> **Planned.** A custom camera angle from 0 to 90 degrees, in steps of 0.5 degrees, is planned for a later release.

<!-- spec: REQ-PIX-003 -->
<!-- spec: REQ-PIX-007 -->
<!-- spec: REQ-PIX-008 -->
<!-- spec: REQ-PIX-009 -->
