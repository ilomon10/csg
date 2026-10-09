---
title: Camera styles
description: Choose a side, three-quarter or isometric camera, and understand how framing and the pivot row keep every frame of a sheet aligned.
---

# Camera styles

The camera decides how your character looks from the outside. All three styles use a flat, orthographic projection. Nothing gets smaller with distance.

> [!NOTE]
> **Planned.** The camera controls are planned with the Render tab. The values on this page are the ones the pipeline uses.

## Choose a camera

- **Side** (best for platformers): viewing angle 0 degrees, 2 default directions, default pivot row 3 px at 64 px.
- **Three-quarter** (best for top-down RPGs): viewing angle 35 degrees, 8 default directions, default pivot row 12 px at 64 px.
- **Isometric** (best for isometric RPGs): viewing angle 30 degrees, 8 default directions, default pivot row 10 px at 64 px.

Choosing a camera also sets a sensible default for directions and the facing used when a sheet has only one direction. See [Directions](./directions.md).

<!-- TODO(screenshot): the same character in side view and in three-quarter view, side by side -->

The isometric camera uses a 2:1 ratio, so its pixels line up with the classic isometric grid.

## Framing

Framing decides how big the character is in each frame.

- **Auto** (the default) fits the whole character, including its outer outline, inside the frame on all four sides of the pivot. It looks at every clip, frame and direction in the export, so the character is never cut off. Every frame of one export uses the same scale, so a character never jumps in size between frames.
- **A fixed scale** sets how many world units each pixel covers. Use the same scale for every character in your game, so a tall knight and a short goblin stay in proportion.

If any part of the character would fall outside the frame, the export still runs and shows a warning that names the clip and direction.

## Pivot row

The pivot is the point where the character stands on the ground. In every frame, the feet sit on the same pixel row, so the character does not jitter when it plays. The pivot row is counted from the bottom of the frame.

The default depends on the camera and on the frame height:

- **Side:** 3 pixels. With the outline turned off it is 2 pixels. With a 3-pixel outline it is 5 pixels.
- **Three-quarter:** about 3/16 of the frame height, so 12 pixels at 64 px and 6 pixels at 32 px.
- **Isometric:** about 5/32 of the frame height, so 10 pixels at 64 px and 5 pixels at 32 px.

The higher pivot gives the feet in front of the character room to show when the camera looks down. You rarely need to change it.

> [!NOTE]
> **Planned.** A custom camera angle from 0 to 90 degrees, in steps of 0.5 degrees, is planned for a later release.

<!-- spec: REQ-PIX-003 -->
<!-- spec: REQ-PIX-004 -->
<!-- spec: REQ-PIX-007 -->
<!-- spec: REQ-PIX-008 -->
<!-- spec: REQ-PIX-009 -->
