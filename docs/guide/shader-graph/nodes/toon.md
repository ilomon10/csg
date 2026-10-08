---
title: Toon nodes
description: Reference for the toon nodes that make the banded shading and rim light of the default material look, plus the planned specular node.
---

# Toon nodes

Toon nodes turn smooth lighting into flat bands, and add a bright rim on the lit edge of a surface. They work in the material graph only.

A default input is `built-in` when the socket takes its value from the scene. For example, `normal` uses the surface normal unless you connect something else.

> [!NOTE]
> **Planned.** Part of the node reference planned for the first release of the graph editor.

## `toon.ramp@1`

Splits the lighting into flat bands. With `steps` set to 3, the surface has three shades. The thresholds `t1`, `t2` and `t3` set where each band starts, and they must rise from 0 to 1. Their defaults space the bands evenly.

| Socket   | Dir | Type  | Default   |
| -------- | --- | ----- | --------- |
| normal   | In  | vec3  | built-in  |
| lightDir | In  | vec3  | built-in  |
| base     | In  | color | built-in  |
| steps    | In  | int   | 3         |
| t1       | In  | float | 1 / steps |
| t2       | In  | float | 2 / steps |
| t3       | In  | float | 3 / steps |
| ambient  | In  | float | 0         |
| color    | Out | color | -         |
| light    | Out | float | -         |

`steps` takes a value from 2 to 4. `ambient` takes a value from 0 to 1, and it lifts the darkest band.

## `toon.rim@1`

Adds a bright edge on the side of the surface that faces the light. Its output is zero everywhere except that edge, and it is multiplied by `strength`.

| Socket   | Dir | Type  | Default  |
| -------- | --- | ----- | -------- |
| normal   | In  | vec3  | built-in |
| viewDir  | In  | vec3  | built-in |
| lightDir | In  | vec3  | built-in |
| width    | In  | float | 0.2      |
| strength | In  | float | 0.5      |
| rim      | Out | float | -        |

`width` and `strength` each take a value from 0 to 1.

## `toon.specularSteps@1`

> [!NOTE]
> **Planned.** This node is planned for a later release. It is not part of the default look.

Adds a glossy highlight in a few flat steps. Use `steps` from 1 to 4 to control how many steps it has.

| Socket    | Dir | Type  | Default  |
| --------- | --- | ----- | -------- |
| normal    | In  | vec3  | built-in |
| viewDir   | In  | vec3  | built-in |
| lightDir  | In  | vec3  | built-in |
| shininess | In  | float | 32       |
| steps     | In  | int   | 1        |
| color     | In  | color | #ffffff  |
| spec      | Out | float | -        |
| color     | Out | color | -        |
