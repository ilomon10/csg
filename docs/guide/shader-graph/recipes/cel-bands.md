---
title: Cel-shaded bands
description: Create flat, crisp cel shading with four bands, set the band thresholds yourself, and lift the shadows with ambient light.
---

# Cel-shaded bands

Cel shading gives a surface a few flat shades instead of a smooth gradient. Four bands give a detailed look. Three or two bands read more easily at small sizes.

> [!NOTE]
> **Planned.** This recipe is planned for a later release. The **Bands** control in the **Render** tab is part of the first release.

## Option 1: set the bands in the Render tab

1. Open the **Render** tab.
2. Open the **Toon** section.
3. Set **Bands** to 4. The bands are spaced evenly by default.

## Option 2: set the thresholds in the material graph

Use this when you want uneven bands, for example a wider shadow.

1. Open the material graph in the bottom dock.
2. Select the `toon.ramp` node.
3. Set `steps` to 4.
4. Set `t1`, `t2` and `t3` to rising values between 0 and 1. For example, 0.3, 0.55 and 0.8 give a wide shadow band and narrower lit bands.
5. Set `ambient` to a small value, such as 0.1, to lift the darkest band.

Editing the built-in material graph first makes a copy in your project.

## Check your work

Look at the sprite in **Pixel** view at 64 pixels, then at 32 pixels. If the bands look noisy, reduce the number of bands. If the shadows are too dark to read, raise the ambient value.
