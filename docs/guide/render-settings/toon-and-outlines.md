---
title: Toon shading and outlines
description: Set the key light, toon shading bands, rim light and outlines to get a cel-shaded pixel look that reads well at small sizes.
---

# Toon shading and outlines

Toon shading turns smooth 3D lighting into a few flat bands of color. Outlines add an edge around the silhouette and between parts. Together they make a sprite read clearly at small sizes.

> [!NOTE]
> **Planned.** These controls are planned with the Render tab. The values on this page are the default look the pipeline renders today.

<!-- TODO(screenshot): the same sphere with 2 bands, 3 bands and 4 bands, with the outline on -->

## Key light

The key light comes from the upper left of the screen by default. It stays in that place when the character turns, so the light stays consistent across directions and camera styles.

- **Azimuth** sets the direction around the screen. 0 degrees is from the right, 90 degrees is from the top and 180 degrees is from the left. The default is 135 degrees, from the upper left.
- **Elevation** sets how high the light is. 0 degrees is level with the character and 90 degrees is straight at the viewer. The default is 45 degrees.
- **Ambient** sets the brightness of the darkest band. The default is 0.1, so the shadow side keeps 10 % of the full light.

## Toon bands

- **Bands** sets how many flat shades a surface has, from 2 to 4. The default is 3.
- **Thresholds** set where each band starts, as a fraction of full light. By default they are evenly spaced.

## Rim light

Rim light adds a bright 1-pixel edge along the side of the character that faces the key light. It is on by default.

- **Strength** sets how bright the rim is, from 0 to 1. The default is 0.5.
- The rim is always 1 pixel wide. There is no width setting. Older settings that still contain a width value ignore it.
- At an elevation of 90 degrees the light has no sideways direction, so no rim is drawn.

## Outlines

The **outer outline** draws a border around the outside of the character. It is on by default, at 1 pixel wide. You can choose 1, 2 or 3 pixels. The width stays the same at every frame size, so a 1-pixel outline is always one pixel.

The outer outline color can be:

- **Black**, the default. If a palette is active, the darkest palette color is used.
- **Darken**. Each outline pixel is a darker shade of the color next to it. The **darken amount** is 0.6 by default, which keeps 40 % of the brightness.
- **Custom**. Pick any color.

The **inner lines** are drawn inside the character where two parts meet, such as a sword in front of a torso. The inner line color can be **Darken** (the default, with the same darken amount), **Black** or **Custom**. You can set outer and inner colors separately.

Choose what triggers an inner line:

- **Part**, on by default. A line appears where two different parts meet.
- **Depth**, off by default. A line appears where one part is clearly in front of another.
- **Surface angle**, off by default. A line appears where the surface bends sharply.

Each inner line is drawn on the part that is farther from the camera.

> [!TIP]
> Try 2 bands for a bold, simple look. Add bands only if the sprite still reads clearly.

<!-- spec: REQ-PIX-011 -->
<!-- spec: REQ-PIX-012 -->
<!-- spec: REQ-PIX-013 -->
<!-- spec: REQ-PIX-015 -->
<!-- spec: REQ-PIX-016 -->
<!-- spec: REQ-PIX-017 -->
