---
title: Vector nodes
description: Reference for the vector nodes, covering splitting and combining vectors, dot and cross products, normalizing, length, distance and reflection.
---

# Vector nodes

Vector nodes work on groups of two, three or four numbers. A vector cannot become a single number directly. Use `vector.split@1` to pick one part, or `vector.length@1` to measure it.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `vector.split@1`

Splits a four-part vector into its four numbers.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| v      | In  | vec4  | -       |
| x      | Out | float | -       |
| y      | Out | float | -       |
| z      | Out | float | -       |
| w      | Out | float | -       |

## `vector.combine@1`

Builds vectors from up to four numbers. Each output uses the first parts of the inputs it needs.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| x      | In  | float | 0       |
| y      | In  | float | 0       |
| z      | In  | float | 0       |
| w      | In  | float | 0       |
| vec2   | Out | vec2  | -       |
| vec3   | Out | vec3  | -       |
| vec4   | Out | vec4  | -       |

## `vector.dot@1`

The dot product of two three-part vectors. Use it to measure how much two directions line up.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| a      | In  | vec3  | -       |
| b      | In  | vec3  | -       |
| out    | Out | float | -       |

## `vector.cross@1`

The cross product of two three-part vectors. The result is at right angles to both.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | vec3 | -       |
| b      | In  | vec3 | -       |
| out    | Out | vec3 | -       |

## `vector.normalize@1`

Scales a vector so its length is 1, keeping its direction.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| v      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `vector.length@1`

The length of a vector, as a single number.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| v      | In  | gen   | -       |
| out    | Out | float | -       |

## `vector.distance@1`

The distance between two points.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| a      | In  | gen   | -       |
| b      | In  | gen   | -       |
| out    | Out | float | -       |

## `vector.reflect@1`

Reflects the direction `i` off a surface with normal `n`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| i      | In  | vec3 | -       |
| n      | In  | vec3 | -       |
| out    | Out | vec3 | -       |
