---
title: Animation overview
description: Choose the animation clips for your export, preview them exactly as they will be exported, and control playback with the timeline and the keyboard.
---

# Animation overview

Animations decide what your sprite sheet contains. Each animation you choose becomes a row of frames for every direction.

Animation has two parts in Pro:

- The **Animation** tab in the inspector holds the clip picker and your export list.
- The **Timeline** tab in the bottom dock plays the preview frame by frame.

<!-- TODO(screenshot): Animation tab with idle and walk in the export list and the timeline dock below -->

## Choose animations

1. Open the **Animation** tab.
2. Browse the clip library, grouped into **Locomotion**, **Combat**, **Reaction**, **Death**, **Emote** and **Misc**. Or type part of a name, an identifier or a tag in the search box.
3. Choose a clip to add it to the export list. You can export up to 32 clips at once. When the list is full, the add button is disabled and says "Maximum 32 animations per export".

Clips that do not fit your character's body are not listed. Some clips may also be hidden for a style, such as Chibi, where they look wrong.

To change the order of the list, drag an entry up or down. Each move is one undo step.

Each entry has a label, used in the file names. See [Clips](./clips.md).

## Set each animation

Each entry in the export list has its own settings:

- **Frames**: from 1 to 64.
- **FPS**: from 1 to 60.
- **Timing**: **Fit to clip** or **Fixed FPS**.
- **Loop**: whether the animation repeats.

See [Frames and timing](./frames-and-timing.md) for how these choose the poses.

## Preview what you will export

The preview plays the clip on your character. **Show export frames** is on by default. While it is on, the preview steps through exactly the frames that will be exported, at the export frame rate. Turn it off to play smoothly in real time. The export is the same either way.

## Timeline controls

| Control                | How to use it                                 |
| ---------------------- | --------------------------------------------- |
| Play or pause          | `Space`                                       |
| Previous or next frame | `,` and `.`, or the Left and Right arrow keys. Stepping pauses playback. |
| First or last frame    | `Home` and `End`                              |
| Timeline scrubber      | Drag it, or focus it and use the arrow keys. Each arrow press moves one frame. |
| Speed                  | 0.25×, 0.5×, 1× or 2×                         |
| Direction              | Choose one, or step with `[` and `]`          |
| Loop                   | Toggle on or off                              |

The timeline announces each frame, for example "Frame 3 of 8", for screen reader users.

When the clip plays at a different speed from its source, the editor shows the effective speed, for example "Plays at 2.1× source speed".

## Reduced motion

If you turn on reduced motion in your system settings, or in **Settings**, the preview does not start by itself. It shows the first frame with a **Play** button.

## Read the next page

- [Clips](./clips.md): the clip library, labels and the export list.
- [Frames and timing](./frames-and-timing.md): how many frames you get and how fast they play.

> [!NOTE]
> **Planned.** Clips you upload yourself, a setting for clips that move the character across the ground, and playing a clip forward and then backward are planned for later releases.

<!-- spec: REQ-ANM-001 -->
<!-- spec: REQ-ANM-003 -->
<!-- spec: REQ-ANM-004 -->
<!-- spec: REQ-ANM-005 -->
<!-- spec: REQ-ANM-009 -->
<!-- spec: REQ-ANM-017 -->
<!-- spec: REQ-ANM-018 -->
<!-- spec: REQ-ANM-019 -->
<!-- spec: REQ-ANM-020 -->
