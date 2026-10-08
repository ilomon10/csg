---
title: Blackboard and the Look panel
description: Expose graph values as parameters, set their ranges, and show them as sliders in the Look panel so teammates can tune the look.
---

# Blackboard and the Look panel

The **Blackboard** is a side panel that lists the parameters of a graph. A parameter is a value you choose, such as the outline width. Parameters can be used by nodes, and they can be shown to non-experts as sliders in the **Look panel**.

<!-- TODO(screenshot): Blackboard panel with Outline width and Dither strength listed -->

## Add and edit a parameter

1. Click `+` in the Blackboard and choose a type, such as float or color.
2. Give it a name, up to 40 characters, that is unique in the graph.
3. Set its minimum, maximum, step and default value.
4. Add a description, so teammates know what it does.
5. Turn on **Show in Look panel** if the parameter should appear as a slider.

Drag parameters to reorder them, or select one and use `Alt+Up` and `Alt+Down`. Group them by the group field to keep long lists tidy.

The editor checks your values as you type. If the minimum is larger than the maximum, or the default is outside the range, it shows an error under the field and keeps the last valid value.

## Use a parameter in a node

Drag a parameter from the Blackboard onto the canvas. The editor creates a node that reads that parameter. Its output follows the parameter's value, and the preview updates as you change it.

If you delete a parameter that nodes still use, the editor asks for confirmation and tells you how many nodes use it.

## Change a value

Changing a parameter updates the preview on the next frame. The graph is not rebuilt, so the change is instant. The value is stored with your project, and it does not change the graph's default value.

## The Look panel

The Look panel is the simple view of your look. It shows:

- the look preset picker;
- one control for each parameter marked **Show in Look panel**, with a reset button for each.

There are no nodes in the Look panel. Keep the number of controls small, around ten, so the panel stays easy to use.

> [!NOTE]
> **Planned.** Saving your own look as a preset, and sharing it as a file, are planned for a later release.

<!-- spec: REQ-EDT-030 -->
<!-- spec: REQ-EDT-031 -->
<!-- spec: REQ-EDT-032 -->
<!-- spec: REQ-EDT-033 -->
<!-- spec: REQ-EDT-034 -->
