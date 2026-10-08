---
title: Math nodes
description: Reference for the math nodes, covering arithmetic, rounding, clamping, blending, smooth steps, remapping, comparisons and selection.
---

# Math nodes

Math nodes work on numbers and vectors. Most of them accept `gen` sockets, which take the width of whatever is connected: a number, or a vector of two, three or four parts.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `math.add@1`

Adds two values.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 0       |
| out    | Out | gen  | -       |

## `math.subtract@1`

Subtracts `b` from `a`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 0       |
| out    | Out | gen  | -       |

## `math.multiply@1`

Multiplies two values.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 1       |
| out    | Out | gen  | -       |

## `math.divide@1`

Divides `a` by `b`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 1       |
| out    | Out | gen  | -       |

## `math.min@1`

The smaller of `a` and `b`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 0       |
| out    | Out | gen  | -       |

## `math.max@1`

The larger of `a` and `b`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 0       |
| out    | Out | gen  | -       |

## `math.power@1`

Raises `a` to the power `b`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| a      | In  | gen  | 0       |
| b      | In  | gen  | 1       |
| out    | Out | gen  | -       |

## `math.abs@1`

The absolute value of `x`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.floor@1`

Rounds `x` down to a whole number.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.ceil@1`

Rounds `x` up to a whole number.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.round@1`

Rounds `x` to the nearest whole number.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.fract@1`

The fractional part of `x`, the amount after the decimal point.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.sin@1`

The sine of `x`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.cos@1`

The cosine of `x`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.oneMinus@1`

Returns 1 minus `x`. Useful for turning a mask around.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.saturate@1`

Clamps `x` to the range 0 to 1.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.clamp@1`

Limits `x` to the range from `min` to `max`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| min    | In  | gen  | 0       |
| max    | In  | gen  | 1       |
| out    | Out | gen  | -       |

## `math.mix@1`

Blends from `a` to `b`. A `t` of 0 gives `a`, a `t` of 1 gives `b`.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| a      | In  | gen   | -       |
| b      | In  | gen   | 1       |
| t      | In  | float | 0.5     |
| out    | Out | gen   | -       |

## `math.step@1`

Returns 0 when `x` is below `edge`, and 1 otherwise.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| edge   | In  | gen  | 0.5     |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.smoothstep@1`

Returns a smooth curve from 0 to 1 as `x` moves from `e0` to `e1`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| e0     | In  | gen  | 0       |
| e1     | In  | gen  | 1       |
| x      | In  | gen  | -       |
| out    | Out | gen  | -       |

## `math.remap@1`

Maps `x` from the range `inMin` to `inMax` onto the range `outMin` to `outMax`.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| x      | In  | gen  | -       |
| inMin  | In  | gen  | -       |
| inMax  | In  | gen  | 1       |
| outMin | In  | gen  | -       |
| outMax | In  | gen  | 1       |
| out    | Out | gen  | -       |

## `math.compare@1`

Compares `a` and `b` with the operator in its field: less than, less than or equal, equal, greater than or equal, or greater than. Outputs true or false.

| Socket | Dir | Type  | Default |
| ------ | --- | ----- | ------- |
| a      | In  | float | -       |
| b      | In  | float | -       |
| out    | Out | bool  | -       |

## `math.select@1`

Returns `a` when `cond` is true, and `b` when it is false.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| cond   | In  | bool | -       |
| a      | In  | gen  | -       |
| b      | In  | gen  | -       |
| out    | Out | gen  | -       |
