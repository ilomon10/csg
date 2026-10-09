---
title: Metadata and file names
description: What the Aseprite-style JSON and the manifest contain, how frames, tags and durations are written, and how file names are built.
---

# Metadata and file names

You choose the metadata format in the export dialog:

- **Aseprite-style JSON and manifest** (the default). The JSON describes every frame and tag, so an engine can play the right frames by name. The manifest records exactly how the sheet was made.
- **Manifest only**. You get the manifest, and no JSON for engines.
- **None**. You get the sheet and `CREDITS.txt` only.

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
    "app": "Character Sprite Generator",
    "version": "0.1.0",
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
- `<label>` is the label of the animation entry, which is the clip name unless you renamed it. Labels contain no underscore, so each part of a name can be read back.
- Each tag plays forward.

## Durations

Each frame has a duration in milliseconds, calculated as 1000 divided by the frame rate, rounded to a whole number. At 12 fps, the duration is 83.

## The manifest

The manifest file ends in `.manifest.json`. It covers every scale in one file, and records:

- the editor version, the three.js version and the graphics backend that made the sheet;
- a fingerprint (SHA-256) of the project, so you can tell which project it came from;
- the size of one frame and the pivot point;
- the scales, and for each frame its animation, direction, index, sheet file and rectangle;
- any warnings that were shown during export.

Use the manifest when you need to rebuild or check a sheet exactly.

## File names

The base name comes from the character name, in lowercase, with dashes instead of spaces and symbols. For example, "Sir Knight #2 (blue)" becomes `sir-knight-2-blue`. A name with no usable letters becomes `character`. You can set a different base name in the export dialog.

| File                       | Name                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sprite sheet               | `<name>.png`, or `<name>@2x.png` for 2x                                                                                     |
| Strip sheet (strip layout) | `<name>_<label>.png`, or `<name>_<label>@2x.png` for 2x                                                                     |
| Aseprite-style JSON        | Same name as the sheet, ending in `.json`                                                                                   |
| Manifest                   | `<name>.manifest.json`, covering every scale                                                                                |
| Frames (frames layout)     | `<name>/<label>/<direction>/<frame>.png` in the ZIP, one file per frame; for other scales, `<name>@2x/...`                  |
| Credits                    | `CREDITS.txt`                                                                                                               |
| Download                   | `<name>.zip`                                                                                                                |

<!-- spec: REQ-EXP-010 -->
<!-- spec: REQ-EXP-011 -->
<!-- spec: REQ-EXP-012 -->
<!-- spec: REQ-EXP-013 -->
<!-- spec: REQ-EXP-016 -->
