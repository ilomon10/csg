---
title: Using sprites in game engines
description: How to load an exported sprite sheet into a game engine, which engine files the editor writes today, and which are planned.
---

# Using sprites in game engines

Any engine that can load a PNG and cut it into rectangles can use an export. The manifest and the Aseprite-style JSON give the rectangle of every frame, in the order you need.

## What works today

- **Any engine**: load the sheet PNG and use the frame rectangles from the Aseprite-style JSON or the manifest.
- **Phaser 3**: load the Aseprite-style JSON with Phaser's Aseprite loader. Phaser then creates one animation for each animation and direction, with the right frame count and timing.
- **Other sprite tools**: the Aseprite-style JSON uses the same layout as Aseprite exports, so tools that read that format can usually open it.

## Planned engine files

The editor can also write engine-specific files in later releases. Each one is planned, not available yet.

| Engine   | Planned file                                                  |
| -------- | ------------------------------------------------------------- |
| Godot 4  | A `SpriteFrames` resource that lists every animation          |
| Phaser 3 | A texture atlas file and a short README with the loader calls |
| Tiled    | A tileset file with animated tiles                            |
| Unity    | Not yet decided. Support depends on the format chosen.        |

> [!NOTE]
> **Planned.** The engine files above are planned for a later release. Until then, use the Aseprite-style JSON or the manifest.

## Tips

- Keep the padding and margin you chose in the export. Your engine needs them to read the sheet correctly.
- If your engine expects frames in a row, use the **Grid by animation** layout.
- Use the **Frames as ZIP** layout if your engine prefers one image per frame.
- Check the sheet size against your engine's texture limit. Sheets wider or taller than 4096 pixels may not load on every platform.

<!-- spec: REQ-EXP-010 -->
<!-- spec: REQ-EXP-029 -->
<!-- spec: REQ-EXP-028 -->
