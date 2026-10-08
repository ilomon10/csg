---
title: Color nodes
description: Reference for the color nodes, covering blend modes, hue and saturation shifts, gradient ramps, luminance and conversion between linear and sRGB color.
---

# Color nodes

Color nodes mix, shift and measure colors. Colors in the graph are linear. Use the conversion nodes when you need the sRGB form.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `color.mix@1`

Blends two colors. Its field chooses the blend mode: mix, multiply, screen, overlay or add. The `t` input sets how strongly `b` is applied.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| a      | In  | color | -       |
| b      | In  | color | -       |
| t      | In  | float | 0.5     |
| out    | Out | color | -       |

## `color.hsv@1`

Shifts the hue, saturation and value of a color. The hue shift runs from -0.5 to 0.5.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | In  | color | -       |
| hue    | In  | float | 0       |
| sat    | In  | float | 1       |
| val    | In  | float | 1       |
| out    | Out | color | -       |

## `color.ramp@1`

Maps a value from 0 to 1 onto a gradient of two to sixteen color stops. Its fields set the stops and the interpolation: constant (hard steps) or linear (smooth).

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| t      | In  | float | -       |
| color  | Out | color | -       |
| alpha  | Out | float | -       |

## `color.luminance@1`

The brightness of a color, from the Rec. 709 weights used for television and HD video.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | In  | color | -       |
| out    | Out | float | -       |

## `color.linearToSrgb@1`

Converts a linear color to sRGB. The alpha value stays the same.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | In  | color | -       |
| out    | Out | color | -       |

## `color.srgbToLinear@1`

Converts an sRGB color to linear. The alpha value stays the same.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | In  | color | -       |
| out    | Out | color | -       |
