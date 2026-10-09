---
title: New-character wizard
description: Build a new character in eight guided steps, see which styles and species are coming soon, and find out what happens when you finish, go back or discard.
---

# New-character wizard

The wizard guides you through every choice for a new character. It has eight steps, and a live preview stays on the left while you work.

Open it with **New character** on the home screen, or press `Ctrl / Cmd+Alt+N` from the editor.

<!-- TODO(screenshot): wizard on step 3 of 8, Body shape, with the live preview on the left -->

## The eight steps

| Step | Title | What you choose |
|------|-------|-----------------|
| 1 | Style | Realistic or Chibi. Stickman and Voxel are coming soon. |
| 2 | Species | Human. Animal and Monster are coming soon. |
| 3 | Body shape | Average, Slim, Athletic, Stocky, Tall or Petite. |
| 4 | Face | A face from the tiles. |
| 5 | Hair | A hairstyle and a hair color. |
| 6 | Outfit | An outfit from the tiles. |
| 7 | Colors | Skin, hair and outfit colors from the swatches. |
| 8 | Name and finish | A name for the character, then **Finish**. |

Each step title reads "Step n of 8" followed by the step name, so you always know where you are.

## Move between steps

- **Next** keeps this step's choices and goes on.
- **Back** keeps all choices. It is not shown on step 1.
- **Skip** resets this step to the choices you started the wizard with, then goes on. It is not shown on step 8.
- **Randomize** picks new choices for this step only. It is shown on steps 1 to 7.

When you change step, focus moves to the step title, so a screen reader announces it.

## Coming soon styles and species

Some options are listed but not available yet. They show a **Coming soon** label and cannot be chosen. You can still move to them with the arrow keys, and the description reads "Coming soon. Available in a later update." **Randomize** never picks them.

Stickman and Voxel are coming soon as styles. Animal and Monster are coming soon as species. Chibi is available, and it changes proportions. See [Styles and species](../anatomy/styles-and-species.md).

## The preview

The preview on the left shows your character. It starts as a still picture of the starting character, then changes to the live preview as soon as the engine is ready. Each choice shows in the preview straight away.

## Finish

On step 8, type a name, then choose **Finish**.

- The name has spaces trimmed from both ends and must be 1 to 64 characters. If you leave it empty, the character is called "Untitled character".
- The character is saved as a new project within half a second.
- The project opens in the last workspace you used, which is Easy for a new profile. The undo history starts empty.

## Leave without finishing

Press `Escape`, choose **Close**, or go back to the home screen.

- If you have made no changes, the wizard closes at once.
- If you have made changes, a dialog asks "Discard this character?". The default button is **Keep editing**. Choose **Discard** to leave. Nothing is saved.

The wizard is not saved while you work. If you reload the page on the wizard, it starts again at step 1.

<!-- spec: REQ-UX-089 -->
<!-- spec: REQ-UX-090 -->
<!-- spec: REQ-UX-091 -->
<!-- spec: REQ-UX-092 -->
<!-- spec: REQ-UX-093 -->
<!-- spec: REQ-UX-095 -->
<!-- spec: REQ-UX-096 -->
<!-- spec: REQ-UX-097 -->
<!-- spec: REQ-UX-098 -->
<!-- spec: REQ-UX-099 -->
<!-- spec: REQ-UX-100 -->
