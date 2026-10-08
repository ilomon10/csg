---
title: Thicker outline
description: Make a sprite outline two or three pixels wide, either from the Render tab or in the post graph, and check that it still reads at small sizes.
---

# Thicker outline

A thicker outline makes the silhouette bolder, which helps small sprites stand out. The outline width is always in pixels, so a 3-pixel outline is three pixels at every size.

> [!NOTE]
> **Planned.** This recipe is planned for a later release. The outline width control in the **Render** tab is part of the first release.

## Option 1: change the width in the Render tab

1. Open the **Render** tab.
2. Open the **Outline** section.
3. Set the outer outline width to 2 pixels. Use 3 pixels only for large sprites.

This is the simplest option, and it covers most cases.

## Option 2: change the width in the post graph

Use this when you want the width available as a slider in the **Look** panel.

1. Open the post graph in the bottom dock.
2. Select the `post.edgeDetect` node.
3. Set its `width` input to 2, or to 3. The value must be a whole number from 1 to 3.
4. Optionally, add a parameter called **Outline width** in the Blackboard, from 1 to 3, and connect it to `width`. It then appears as a slider in the Look panel.

Editing the built-in post graph first makes a copy in your project.

## Check the result

Look at the sprite at 32 pixels. A 3-pixel outline can cover most of a small sprite. If the face or the hands disappear, go back to 2 pixels, or reduce the outline to 1 pixel.
