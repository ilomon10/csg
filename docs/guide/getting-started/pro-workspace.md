---
title: Pro workspace
description: "The Pro layout: part library, viewport toolbar, five inspector tabs and the bottom dock, with resizing and narrow-window behaviour."
---

# Pro workspace

Pro is the full editor. It shows your character in a viewport with a part library on the left, an inspector on the right and a dock along the bottom. Pro gives you the anatomy sliders, the render settings, the look and the animation controls.

<!-- TODO(screenshot): Pro workspace at 1440 by 900 px with the five regions labelled -->

## The regions

| Region | Where | What it holds |
|--------|-------|---------------|
| Part library | Left, 280 px wide by default | A search box, slot filters, **Show incompatible**, the part grid, and the **Randomize** and **Character file** menus. |
| Viewport | Centre | Your character, and the viewport toolbar underneath it. |
| Inspector | Right, 320 px wide by default | Five tabs: **Parts**, **Colors**, **Anatomy**, **Render** and **Animation**. |
| Dock | Bottom, 240 px tall by default | **Timeline**, **Material graph** and **Post graph**. |

The top bar is shared with Easy. It holds the undo and redo buttons and the **Export** button in Pro.

## The viewport toolbar

- **3D | Pixel**: switches the view. **Pixel** shows the frame that will be exported, scaled up with sharp pixels. **3D** shows a full-resolution view that you can turn with the mouse. Press `V` to switch.
- **Direction** **◀** and **▶**: step through the facings. Press `[` and `]`.
- **Zoom** (Pixel view only): whole steps from 1× to 16×, so the pixels stay sharp. Press `+` and `-`.
- **Frame** (`F`): fits the character in view. Pixel view sizes the character automatically, so Frame matters most in the 3D view.
- **Background**: a checkerboard, a solid color or transparent.
- **Idle | Walk** and **Play | Pause**: control the preview animation.

## The inspector tabs

- **Parts**: what fills each slot. Each equipped part has a **Remove** button.
- **Colors**: the color of each tint. Pick a swatch, or type a hex color such as `#3a5fcd`. See [Colors and tints](../composer/colors-and-tints.md).
- **Anatomy**: the nine proportion values, and the presets. See [Anatomy](../anatomy/index.md).
- **Render**: the look (see [Look presets](../render-settings/look-presets.md)) and the render settings. See [Render settings](../render-settings/index.md).
- **Animation**: the clip picker and each clip's settings. See [Animation](../animation/index.md).

Switch tabs with the arrow keys, or with `Alt+Shift+1` to `Alt+Shift+5`. The editor remembers the last tab you used.

## The dock

- **Timeline** plays the preview frame by frame, with the frame readout. See [Animation](../animation/index.md).
- **Material graph** and **Post graph** are the shader graph editors. They arrive with the shader graph editor in a later release. Until then, each tab shows a short notice.
- Press `Ctrl / Cmd+J` to show or hide the dock, and `Ctrl / Cmd+Shift+M` to make it fill the area below the top bar. When the dock is not maximized, the viewport always keeps at least 240 by 240 pixels.

## Resize and collapse

- Drag the edge between two regions to resize the part library (200 to 480 pixels), the inspector (280 to 560 pixels) or the dock (at least 120 pixels, and at most 60 % of the window height).
- Each divider also works with the keyboard. Focus it, then use the arrow keys to move it by 16 pixels. **Home** and **End** go to the smallest or largest size.
- You can collapse the part library, the inspector and the dock.
- The editor remembers sizes and collapsed regions between visits.

## Narrow windows

- From 1280 pixels, all regions are docked.
- From 1024 to 1279 pixels, the part library becomes a drawer. A button in the top bar opens it.
- From 768 to 1023 pixels, the part library and the inspector both become drawers, and the dock starts collapsed.
- Below 768 pixels, editing is not supported yet. A view-only layout is planned.

<!-- spec: REQ-UX-001 -->
<!-- spec: REQ-UX-002 -->
<!-- spec: REQ-UX-003 -->
<!-- spec: REQ-UX-004 -->
<!-- spec: REQ-UX-005 -->
<!-- spec: REQ-UX-006 -->
<!-- spec: REQ-UX-040 -->
<!-- spec: REQ-CMP-009 -->
<!-- spec: REQ-CMP-032 -->
