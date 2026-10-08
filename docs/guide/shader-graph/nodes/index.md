---
title: Node reference
description: Reference for the built-in shader graph nodes, grouped by category, with type IDs, sockets, value types and defaults.
---

# Node reference

This reference lists every built-in node. Each node has a type ID, such as `math.add@1`, a short description, and a table of its sockets.

> [!NOTE]
> **Planned.** The node reference describes the built-in nodes for the first release of the graph editor. Names and defaults may still change before then.

## How to read a node

- **Type ID**: the name of the node, with a version after the `@`. Use it to search for a node.
- **Socket**: a named input or output. Connect wires to sockets.
- **Dir**: `In` for an input, `Out` for an output, or `Field` for a value you set in the node itself.
- **Type**: the kind of value the socket carries. `gen` means the socket takes its type from what is connected. It can be `float`, `vec2`, `vec3` or `vec4`.
- **Default**: the value used when nothing is connected. `built-in` means the value comes from the render settings or the part. A hyphen means the reference gives no default.

## Categories

| Category           | Nodes                                                  | Page                                          |
| ------------------ | ------------------------------------------------------ | --------------------------------------------- |
| Input              | Surface, screen and part values, and constants         | [Input](./input.md)                           |
| Math               | Arithmetic, rounding, blending and comparisons         | [Math](./math.md)                             |
| Vector             | Splitting, combining, and vector operations            | [Vector](./vector.md)                         |
| Color              | Mixing, hue, gradients and brightness                  | [Color](./color.md)                           |
| Toon               | Toon shading bands and rim light                       | [Toon](./toon.md)                             |
| Post               | Edge detection, outlines, palette, dithering and alpha | [Post](./post.md)                             |
| Utility and output | Reroute points, groups and the final output            | [Utility and output](./utility-and-output.md) |

Nodes marked **material** work in the material graph. Nodes marked **post** work in the post graph. Nodes that work in both are marked **material and post**.
