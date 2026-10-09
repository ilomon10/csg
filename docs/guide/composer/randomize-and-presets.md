---
title: Randomize and presets
description: Randomize a character with seeded results, choose what to randomize and what to lock, and start a new project from a built-in preset.
---

# Randomize and presets

Randomize builds a new variation of your character with a random mix of parts, colors and proportions. Presets are ready-made characters you can start from in one click.

## Randomize

Randomize is in three places:

- **Easy**, in the bottom bar, as the **Randomize** menu:
  - **This tab** changes only the current category.
  - **Everything** changes the whole character.
- **Pro**, with `R` for a randomize that keeps locks, or `Shift+R` for a randomize with a new seed. The part library also has a **Randomize** menu.
- **Wizard**, with the **Randomize** button on steps 1 to 7. It changes only that step.

Each press uses a new seed, and the seed is stored in the character. The same seed with the same locks always gives the same character.

Randomize only chooses parts that fit your body and your style. Some optional slots stay empty, which is normal. Randomize never chooses a coming-soon style or species.

## Lock what you want to keep

In Pro, lock a slot, the colors or the anatomy before you randomize. Locked items keep their current values. For example, lock **hair** and the colors to keep a hairstyle and palette while you randomize the outfit.

Style and species stay as they are unless you unlock them.

If a locked part does not fit any other body, the editor keeps the body and the part and shows no error.

## Start from a preset

A preset is a ready-made character. The home screen shows the built-in presets in the lineup, and you start from one with **Start from this preset**. See [Home screen](../getting-started/home-screen.md).

- The editor creates a new project with a copy of the preset's character.
- The preset itself never changes, so you can start from it again.
- A preset can open with a side, three-quarter or isometric camera. The camera it opens with is set by the preset.

Saving your own character as a preset is planned for a later release.

<!-- TODO(screenshot): home lineup with the preset strip and the Start from this preset button -->

## Undo

Each randomize and each reset of a category is one undo step. Press `Ctrl / Cmd+Z` to go back to the character you had before. Starting from a preset creates a new project, so its undo history starts empty.

<!-- spec: REQ-CMP-018 -->
<!-- spec: REQ-CMP-019 -->
<!-- spec: REQ-CMP-020 -->
<!-- spec: REQ-CMP-027 -->
<!-- spec: REQ-CMP-046 -->
<!-- spec: REQ-CMP-047 -->
<!-- spec: REQ-UX-065 -->
<!-- spec: REQ-UX-066 -->
<!-- spec: REQ-UX-077 -->
<!-- spec: REQ-UX-078 -->
<!-- spec: REQ-UX-096 -->
