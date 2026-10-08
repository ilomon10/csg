---
title: Randomize and presets
description: Generate seeded random characters with locked parts, and start from built-in or saved character presets.
---

# Randomize and presets

Randomize builds a new character with a random mix of parts and tints. Presets are ready-made characters you can load in one click.

> [!NOTE]
> **Planned.** Randomize, the preset gallery and saving your own presets are planned for a later release. The notes below describe how they will work.

## Randomize

- Press `R` to randomize the character. Press `Shift+R` for a new seed.
- The seed is stored in the character file. The same seed with the same locks always gives the same character.
- Only compatible parts are chosen, so randomized characters never contain a part that does not fit the body.
- Some optional slots are often left empty. Beards and back items are examples. How often a slot stays empty is set per slot in the data.

## Lock what you want to keep

Lock a slot, the tints or the anatomy before you randomize. Locked items keep their current values. For example, lock **hair** and **tints** to keep a hairstyle and palette while you randomize the outfit.

If the body is locked and a locked part does not fit any other body, the editor keeps the body and the part and shows no error.

## Presets

- **Built-in presets** are characters that ship with the editor. They appear in the preset gallery with a thumbnail.
- **Local presets** are characters you save from the editor. They are stored in this browser and never leave it.

Applying a preset is one undo step.

<!-- TODO(screenshot): preset gallery with thumbnails and the lock icons beside the slot list -->

<!-- spec: REQ-CMP-018 -->
<!-- spec: REQ-CMP-019 -->
<!-- spec: REQ-CMP-027 -->
