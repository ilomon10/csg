---
title: Frames and timing
description: How frame count, frames per second and timing mode decide which poses appear in your sheet, with worked examples of the sampling rules.
---

# Frames and timing

Each clip is sampled at a set of moments. The poses at those moments become your frames. Two settings control this: the number of **frames** and the **frames per second** (fps).

<!-- TODO(screenshot): frame count and fps fields for walk, showing the speed readout -->

## Settings

- **Frames**: a whole number from 1 to 64.
- **FPS**: a whole number from 1 to 60. It sets how fast the frames play in the game.
- **Timing**: **Fit to clip** (the default) or **Fixed FPS**.
- **Loop**: whether the animation repeats.

## Fit to clip

The default mode spreads your frames evenly across the clip, so the speed matches the original animation.

For a looping clip, the last frame does not repeat the first. This keeps the loop seamless.

Example: a clip one second long, with 8 frames and looping, samples at 0, 0.125, 0.25 and so on, up to 0.875 seconds.

For a clip that does not loop, the first and last frames include the very start and end of the clip.

Example: the same clip with 5 frames and no loop samples at 0, 0.25, 0.5, 0.75 and 1.0 seconds.

When you add a clip, the fps is set so playback matches the clip's speed. If you change it, the editor shows how much faster or slower the sprite will play, for example "Plays at 2.1x source speed".

## Fixed FPS

Fixed FPS takes frames at a set rate, starting from the first pose. Use it when your game needs a specific speed.

If the frames run past the end of the clip, the last pose repeats for the rest of them, and the editor warns you. For example, 15 frames at 10 fps on a one-second clip would hold the final pose for the last five frames.

## Same timing in every direction

Every direction uses the same sample times. A walk cycle in direction `e` and in direction `s` has the same timing, so they stay in step.

## Frame durations in the export

Each frame records how long it should show, in milliseconds, calculated as 1000 divided by the fps and rounded. At 12 fps, each frame lasts 83 milliseconds.

> [!NOTE]
> **Planned.** Playing a clip forward and then backward, as a ping-pong loop, is planned for a later release.

<!-- spec: REQ-ANM-007 -->
<!-- spec: REQ-ANM-008 -->
<!-- spec: REQ-ANM-009 -->
<!-- spec: REQ-EXP-010 -->
