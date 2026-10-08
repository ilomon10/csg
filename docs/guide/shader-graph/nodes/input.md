---
title: Input nodes
description: Reference for the input nodes, which bring surface, screen, part and time values into a shader graph, plus the constant and parameter nodes.
---

# Input nodes

Input nodes provide values from the scene: surface directions, screen position, the equipped part, time and tints. Constant nodes give you fixed values.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `input.uv@1`

Mesh texture coordinates in the material graph, or the screen position in the post graph. Works in material and post graphs.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| uv     | Out | vec2 | -       |

## `input.normal@1`

The surface normal in world space, normalized. Material graph only.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| normal | Out | vec3 | -       |

## `input.viewDir@1`

The direction from the surface to the camera, in world space. Material graph only.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| dir    | Out | vec3 | -       |

## `input.lightDir@1`

The direction from the surface to the key light. Material graph only.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| dir    | Out | vec3 | -       |

## `input.partId@1`

The index of the equipped part under the surface. Material graph only.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| id     | Out | int  | -       |

## `input.time@1`

Seconds since the preview started. In exports, time is always 0, and the node shows a warning badge. Use it for previews only. Works in material and post graphs.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| t      | Out | float | -       |

## `input.screenPos@1`

The pixel position of each pixel in the low-resolution frame, and the same position from 0 to 1. Works in material and post graphs.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| px     | Out | vec2 | -       |
| uv     | Out | vec2 | -       |

## `input.texelSize@1`

The size of one pixel in texture units, and the frame resolution in pixels. Works in material and post graphs.

| Socket     | Dir | Type | Default |
| ---------- | --- | ---- | ------- |
| texel      | Out | vec2 | -       |
| resolution | Out | vec2 | -       |

## `input.tint@1`

The color of one tint slot. Its field chooses the slot: skin, hair, eyes, primary, secondary, metal or leather. Material graph only.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | Out | color | -       |

## `input.partAlbedo@1`

The base texture of the part, multiplied by its vertex color. Material graph only.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| color  | Out | color | -       |
| alpha  | Out | float | -       |

## `input.float@1`

A constant number. Set the value in the node's field. Works in material and post graphs.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| out    | Out | float | 0       |

## `input.vec2@1`

A constant two-part vector. Set the value in the node's field. Works in material and post graphs.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| out    | Out | vec2 | 0, 0    |

## `input.vec3@1`

A constant three-part vector. Set the value in the node's field. Works in material and post graphs.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| out    | Out | vec3 | 0, 0, 0 |

## `input.color@1`

A constant color. Set the value in the node's field. Works in material and post graphs.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| out    | Out | color | #000000 |

## `param.get@1`

Reads one value from the Blackboard. Create it by dragging a parameter from the Blackboard onto the canvas. Works in material and post graphs.

| Socket | Dir | Type         | Default |
| ------ | --- | ------------ | ------- |
| value  | Out | param's type | -       |
