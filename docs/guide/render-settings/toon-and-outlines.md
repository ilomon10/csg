---
title: Toon shading and outlines
description: Set the key light, toon shading bands, rim light and outlines to get a cel-shaded pixel look that reads well at small sizes.
---

# Toon shading and outlines

Toon shading turns smooth 3D lighting into a few flat bands of color. Outlines add a dark edge around the silhouette. Together they make a sprite read clearly at small sizes.

<!-- TODO(screenshot): the same sphere with 2 bands, 3 bands and 4 bands, with the outline on -->

## Key light

The key light comes from the upper left of the screen by default. It stays in that place when the character turns, so the light stays consistent across directions and camera styles.

- **Azimuth** sets the direction around the screen. The default is 135 degrees.
- **Elevation** sets how high the light is. The default is 45 degrees.
- **Ambient** lifts the darkest band. The default is 0.15.

## Toon bands

- **Bands** sets how many flat shades a surface has, from 2 to 4. The default is 3.
- **Thresholds** set where each band starts. By default the bands are evenly spaced.

## Rim light

Rim light adds a bright edge on the lit side of the character. It is on by default.

- **Strength** sets how bright the rim is, from 0 to 1. The default is 0.35.
- **Width** sets how thick the rim is, from 0 to 1. The default is 0.25.

## Outlines

The **outer outline** draws a border around the outside of the character. It is on by default, at 1 pixel wide. You can choose 1, 2 or 3 pixels. The width stays the same at every frame size, so a 1-pixel outline is always one pixel.

The **outline color** can be:

- **Darken**, the default. Each outline pixel is a darker shade of the color next to it. The **darken amount** is 0.6 by default.
- **Black**. If a palette is active, the darkest palette color is used.
- **Custom**. Pick any color.

The **inner lines** are drawn where two parts meet, such as a sword in front of a torso. Choose what triggers them: the part, the depth, or the surface angle. By default only the part triggers an inner line.

> [!TIP]
> Start with a 2-band toon at 32 pixels. Add bands only if the sprite still reads clearly.

<!-- spec: REQ-PIX-011 -->
<!-- spec: REQ-PIX-012 -->
<!-- spec: REQ-PIX-013 -->
<!-- spec: REQ-PIX-015 -->
<!-- spec: REQ-PIX-016 -->
<!-- spec: REQ-PIX-017 -->
