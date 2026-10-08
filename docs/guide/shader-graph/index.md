---
title: Shader graph overview
description: What the shader graph controls, how the material and post graphs differ, and when to use the Look panel instead of editing nodes.
---

# Shader graph overview

The look of your sprites is made by small building blocks called nodes. Nodes are connected by wires into a **shader graph**. You can edit the graph to change the look, or use the simpler **Look** panel to change a few values without touching nodes.

<!-- TODO(screenshot): bottom dock with the Post graph open next to the Look panel -->

## Two graphs

- The **material graph** decides how each surface of the character is lit and colored. It is where toon shading happens.
- The **post graph** runs on the finished frame. It draws outlines, applies the palette, adds dithering and sets transparency.

Open either graph from the bottom dock, with `Ctrl+Shift+G` for the material graph and `Ctrl+Shift+O` for the post graph.

## Two ways to change the look

- **Look panel**: pick a look preset, then move the sliders and color pickers that a graph has exposed. Use this for quick changes.
- **Graph editor**: add, connect and tune nodes. Use this when a preset is not enough.

## Look presets

| Preset          | What it gives you                                                  |
| --------------- | ------------------------------------------------------------------ |
| Classic 16-bit  | The default look, with toon shading and an outline                 |
| GameBoy 4-color | Four shades of green, a 4x4 dither and a dark outline              |
| NES-like        | The 54-color NES palette, two toon bands and no dithering          |
| Hi-bit          | The Endesga-32 palette, four toon bands, rim light and inner lines |

## Your edits are safe

The built-in graphs never change. When you edit one, the editor first makes a copy in your project and edits the copy. To go back, choose **Reset to default**. That replaces the graph with the built-in version, and one undo brings your version back.

## Pages in this section

- [Editor basics](./editor-basics.md): open, edit and tidy up a graph.
- [Blackboard and the Look panel](./blackboard.md): expose values to non-experts.
- [Node reference](./nodes/index.md): what each node does.
- [Recipes](./recipes/index.md): step-by-step looks you can copy.

> [!NOTE]
> **Planned.** The node reference and recipes are planned for a later release. The graph editor itself, the Look panel and the presets are part of the first release.

<!-- spec: REQ-EDT-001 -->
<!-- spec: REQ-EDT-003 -->
<!-- spec: REQ-EDT-044 -->
<!-- spec: REQ-EDT-034 -->
