---
title: Post nodes
description: Reference for the post-processing nodes that sample the frame, detect edges, draw outlines, apply the palette and dithering, and set alpha.
---

# Post nodes

Post nodes work on the finished frame, after the character is drawn. They sample neighbouring pixels, find edges, draw outlines, quantize colors to a palette, dither, and set transparency. They work in the post graph only.

The `built-in` default means the value comes from the render settings. For example, `cutoff` uses the alpha cutoff you set in the **Render** tab.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `post.sampleColor@1`

The color of a pixel, offset from the pixel being drawn. The offset is in pixels.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| offset | In  | vec2  | 0, 0    |
| out    | Out | color | -       |

## `post.sampleNormal@1`

The surface normal stored for a pixel, offset from the pixel being drawn.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| offset | In  | vec2 | 0, 0    |
| out    | Out | vec3 | -       |

## `post.sampleDepth@1`

The distance from the camera for a pixel, from 0 (near) to 1 (far), offset from the pixel being drawn.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| offset | In  | vec2  | 0, 0    |
| out    | Out | float | -       |

## `post.sampleId@1`

The part ID stored for a pixel, offset from the pixel being drawn. It also reports whether the pixel is background.

| Socket       | Dir | Type | Default |
| ------------ | --- | ---- | ------- |
| offset       | In  | vec2 | 0, 0    |
| id           | Out | int  | -       |
| isBackground | Out | bool | -       |

## `post.edgeDetect@1`

Finds edges between neighbouring pixels. An outer edge is the border of the character against the background. An inner edge is a line where two parts meet, or where depth or surface angle changes sharply.

Its field `sources` picks what counts as an edge: depth, normal or ID. You can choose more than one. The `width` input sets the outer line from 1 to 3 pixels.

| Socket             | Dir | Type  | Default  |
| ------------------ | --- | ----- | -------- |
| alpha              | In  | float | -        |
| cutoff             | In  | float | built-in |
| depthThresholdPx   | In  | float | 1        |
| normalThresholdDeg | In  | float | 45       |
| width              | In  | int   | 1        |
| outer              | Out | float | -        |
| inner              | Out | float | -        |

## `post.outline@1`

Colors the outline pixels. Its field `mode` sets the color: black, darken, or custom. Darken uses the color next to the edge, made darker by `darkenAmount`. Custom uses `customColor`.

| Socket       | Dir | Type  | Default |
| ------------ | --- | ----- | ------- |
| color        | In  | color | -       |
| outer        | In  | float | -       |
| inner        | In  | float | -       |
| darkenAmount | In  | float | 0.5     |
| customColor  | In  | color | #000000 |
| out          | Out | color | -       |

## `post.paletteQuantize@1`

Maps each color to the nearest color in the active palette, using a precomputed lookup table. With no palette, the color passes through unchanged.

| Socket | Dir | Type    | Default  |
| ------ | --- | ------- | -------- |
| color  | In  | color   | -        |
| lut    | In  | texture | built-in |
| out    | Out | color   | -        |

## `post.bayerDither@1`

Adds an ordered dither pattern before the palette is applied. Its field `matrix` picks the pattern size: 2, 4 or 8. The `strength` input sets how strong the pattern is, and `spread` sets how far each step can move a color.

| Socket    | Dir | Type  | Default  |
| --------- | --- | ----- | -------- |
| color     | In  | color | -        |
| px        | In  | vec2  | built-in |
| strength  | In  | float | built-in |
| spread    | In  | float | 0.25     |
| out       | Out | color | -        |
| threshold | Out | float | -        |

## `post.posterize@1`

Reduces each color channel to a fixed number of levels, from 2 to 256.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | In  | color | -       |
| levels | In  | int   | 8       |
| out    | Out | color | -       |

## `post.alphaCutoff@1`

Makes each pixel either fully visible or fully transparent. A pixel whose alpha reaches the cutoff is kept.

| Socket | Dir | Type  | Default  |
| ------ | --- | ----- | -------- |
| color  | In  | color | -        |
| cutoff | In  | float | built-in |
| out    | Out | color | -        |
