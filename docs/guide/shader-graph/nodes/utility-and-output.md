---
title: Utility and output nodes
description: Reference for the reroute, group and output nodes that organize a graph and deliver its final color in the material and post graphs.
---

# Utility and output nodes

These nodes organize a graph. Reroute points keep wires tidy. Groups bundle nodes into one reusable block. Output nodes deliver the final color, and every graph needs exactly one of them.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `util.reroute@1`

A point on a wire. It takes whatever type is connected to its input, and passes it on. It never changes a value, so the conversion happens at the node after it. Works in material and post graphs.

| Socket | Dir | Type | Default |
| ------ | --- | ---- | ------- |
| in     | In  | any  | -       |
| out    | Out | any  | -       |

## `util.customFunction@1`

> [!NOTE]
> **Planned.** This node is planned for a later release. Its sockets are declared on each node, and it will only offer built-in functions.

## `group.instance@1`

A use of a group. Its sockets are the interface the group declares, so changing the group changes every instance. Works in material and post graphs.

## `group.input@1`

The entry point inside a group. Its outputs are the group's inputs. It exists only inside a group.

## `group.output@1`

The exit point inside a group. Its inputs are the group's outputs. It exists only inside a group.

## `output.material@1`

The final surface of a character in the material graph. Every material graph needs exactly one.

| Socket | Dir | Type  | Default  |
| ------ | --- | ----- | -------- |
| color  | In  | color | built-in |
| alpha  | In  | float | 1        |

The `color` default is the tint multiplied by the part's base texture. The engine writes the normal and part ID on its own.

## `output.post@1`

The final frame in the post graph. Every post graph needs exactly one.

| Socket | Dir | Type  | Default  |
| ------ | --- | ----- | -------- |
| color  | In  | color | built-in |

The `color` default is the scene color, as drawn before any post effects.
