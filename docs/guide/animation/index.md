---
title: Animation overview
description: Choose the animation clips for your export, preview them exactly as they will be exported, and control playback with the keyboard.
---

# Animation overview

Animations decide what your sprite sheet contains. Each animation you choose becomes a row of frames for every direction.

<!-- TODO(screenshot): Animation tab with idle and walk in the export list and the timeline dock below -->

## Choose animations

1. Open the **Animation** tab.
2. Browse the clip library, grouped into **Locomotion**, **Combat**, **Reaction**, **Death**, **Emote** and **Misc**.
3. Add the clips you need. You can export up to 32 clips at once.

The library shows each clip's length in seconds. A clip that does not fit your character's skeleton is hidden. Turn on **Show incompatible** to see it greyed out, with the reason "Different skeleton".

## Preview what you will export

The preview plays the clip on your character. Turn on **Show export frames** to see exactly the frames that will be exported, played at the export frame rate. Turn it off to play smoothly in real time. The export is the same either way.

## Playback controls

| Control                | How to use it                                 |
| ---------------------- | --------------------------------------------- |
| Play or pause          | `Space`                                       |
| Previous or next frame | `,` and `.`, or the Left and Right arrow keys |
| Timeline scrubber      | Drag it, or focus it and use the arrow keys   |
| Speed                  | 0.25x, 0.5x, 1x or 2x                         |
| Direction              | Choose one, or step with `[` and `]`          |
| Loop                   | Toggle on or off                              |

The scrubber announces each frame, for example "Frame 3 of 8", for screen reader users.

If you turn on reduced motion in your system settings, the preview does not start playing. It shows the first frame with a **Play** button.

## Read the next page

- [Clips](./clips.md): the clip library, labels and reordering.
- [Frames and timing](./frames-and-timing.md): how many frames you get and how fast they play.

> [!NOTE]
> **Planned.** Clips you upload yourself, and a setting for clips that move the character across the ground, are planned for a later release.

<!-- spec: REQ-ANM-001 -->
<!-- spec: REQ-ANM-017 -->
<!-- spec: REQ-ANM-018 -->
<!-- spec: REQ-ANM-019 -->
