---
title: Interface tour
description: A tour of the editor layout, from the top bar and part library to the viewport, the inspector tabs and the bottom dock.
---

# Interface tour

The editor has five regions around a central viewport. Every feature has one home, and the preview stays visible.

<!-- TODO(screenshot): full editor at 1440 by 900 px with each region labelled -->

```text
+----------------------- Top bar ------------------------------------+
| Project name · Save status · Undo/Redo · Palette · Renderer · Export |
+------------+----------------------------------+---------------------+
| Part       | Viewport                         | Inspector           |
| library    | [3D | Pixel]  dir  zoom  frame   | Parts · Colors ·    |
|            |                                  | Anatomy · Render ·  |
|            |                                  | Animation           |
+------------+----------------------------------+---------------------+
| Bottom dock: Timeline · Material graph · Post graph                 |
+--------------------------------------------------------------------+
```

## The regions

- **Top bar** (48 px tall): project name, save status, undo and redo, the command palette, the renderer badge, help, settings and **Export**.
- **Part library** (280 px wide): the slot list, the part grid, search and filters, and the **Upload** button.
- **Viewport** (fills the middle): your character, the viewport toolbar, and a text summary for screen readers.
- **Inspector** (320 px wide): five tabs, **Parts**, **Colors**, **Anatomy**, **Render** and **Animation**.
- **Bottom dock** (240 px tall): **Timeline**, **Material graph** and **Post graph**.

You can resize the part library (200 to 480 px), the inspector (280 to 560 px) and the dock (at least 120 px). You can also collapse each side region and the dock. The editor remembers sizes and collapsed state between visits. Each splitter also works with the keyboard: focus it, then use the arrow keys.

## The viewport toolbar

- **3D or Pixel** switches the view. Press `V`.
- **Previous and next direction** step through the directions. Press `[` and `]`.
- **Zoom** works in Pixel view only, in whole steps from 1 to 16. Press `+` and `-`. Zoom never uses fractional scales, so pixels stay sharp.
- **Frame character** fits the character in view. Press `F`.
- **Background** switches between a checkerboard, a solid color and transparent.

## The inspector tabs

- **Parts** chooses what fills each slot.
- **Colors** sets the seven tint colors.
- **Anatomy** holds the proportion sliders. See [Anatomy](../anatomy/index.md).
- **Render** sets the camera, size, lighting, outline and palette. See [Render settings](../render-settings/index.md).
- **Animation** chooses clips and frame timing. See [Animation](../animation/index.md).

Switch tabs with the arrow keys, or with `Alt+Shift+1` to `Alt+Shift+5`. The editor remembers the last tab you used.

## The bottom dock

The dock holds the **Timeline** and the two shader graphs. Press `Ctrl+J` to show or hide it, and `Ctrl+Shift+M` to maximize it. When it is not maximized, the viewport always keeps at least 240 by 240 pixels.

## Help, search and undo

- **Command palette**: press `Ctrl+K`, or `Ctrl+Shift+P`. Type a few letters of any command, such as "rand", and press `Enter`.
- **Shortcut help**: press `?` or `F1` to see every shortcut that works where you are.
- **Undo and redo**: press `Ctrl+Z` and `Ctrl+Shift+Z`. Every change to your character can be undone, whichever region has focus.
- **Save status**: the top bar shows **Saved**, **Saving…**, **Unsaved changes** or **Save failed**.

See [Keyboard shortcuts](./keyboard-shortcuts.md) for the full list.

> [!NOTE]
> **Planned.** A guided tour for first-time users, and a notification center that keeps recent messages, are planned for a later release.

<!-- spec: REQ-UX-001 -->
<!-- spec: REQ-UX-003 -->
<!-- spec: REQ-UX-009 -->
