---
title: Metadata and file names
description: What the Aseprite-style JSON and the manifest contain, how frames and tags are named, and how durations are written for engines.
---

# Metadata and file names

Every export includes two JSON files next to the sheet. The first is an Aseprite-style file that most engines and sprite tools can read. The second is a manifest that records exactly how the sheet was made.

## The Aseprite-style JSON

This file lists every frame: where it sits in the sheet, how long it lasts, and which animation it belongs to. Each animation and direction has a tag, so an engine can play the right frames by name.

```json
{
  "frames": [
    {
      "filename": "walk_e_000",
      "frame": {"x": 0, "y": 0, "w": 64, "h": 64},
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": {"x": 0, "y": 0, "w": 64, "h": 64},
      "sourceSize": {"w": 64, "h": 64},
      "duration": 83
    }
  ],
  "meta": {
    "image": "knight.png",
    "format": "RGBA8888",
    "size": {"w": 512, "h": 1024},
    "scale": "1",
    "frameTags": [
      {"name": "walk_e", "from": 0, "to": 7, "direction": "forward"}
    ]
  }
}
```

The example shows one frame. A real file lists every frame in the sheet.

## Frame and tag names

- A frame is named `<label>_<direction>_<frame>`, for example `walk_ne_004`. The frame number has three digits.
- A tag is named `<label>_<direction>`, for example `walk_ne`.
- `<label>` is the label of the animation entry, which is the clip name unless you renamed it.
- A tag plays forward, or `pingpong` when ping-pong is turned on for that animation (and its frames are not baked in). Looping is a setting for the game to apply.

## Durations

Each frame has a duration in milliseconds, calculated as 1000 divided by the frame rate, rounded to a whole number. At 12 fps, the duration is 83.

## The manifest

The manifest file ends in `.manifest.json`. It records:

- the editor version and renderer that made the sheet;
- the size of one frame and the pivot point;
- the list of directions, animations and scales;
- the rectangle of every frame in every sheet;
- any warnings that were shown during export.

Use the manifest when you need to rebuild or check a sheet exactly.

## File names

| File                       | Name                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sprite sheet               | `<name>.png`, or `<name>@2x.png` for 2x                                                                                     |
| Strip sheet (strip layout) | `<name>_<label>.png`                                                                                                        |
| Aseprite-style JSON        | Same name as the sheet, ending in `.json`                                                                                   |
| Manifest                   | `<name>.manifest.json`, covering every scale                                                                                |
| Frames (frames layout)     | `<name>/<label>/<direction>/<frame>.png` in the ZIP, one file per frame; for other scales, `<name>@2x/...`, `<name>@3x/...` |
| Credits                    | `CREDITS.txt`                                                                                                               |
| Download                   | `<name>.zip`                                                                                                                |

The `<name>` part comes from the character name, in lowercase with dashes instead of spaces and symbols. For example, "Sir Knight #2 (blue)" becomes `sir-knight-2-blue`. A name with no usable letters becomes `character`.

<!-- spec: REQ-EXP-010 -->
<!-- spec: REQ-EXP-011 -->
<!-- spec: REQ-EXP-012 -->
<!-- spec: REQ-EXP-016 -->
