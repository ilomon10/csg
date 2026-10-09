---
title: Your first sprite sheet
description: Open the editor, start from a preset character, change its look, choose animations and export a sprite sheet ZIP in about five minutes.
---

# Your first sprite sheet

This walkthrough takes about five minutes. You start from a preset character, change a few things, and export a sprite sheet.

## 1. Open the home screen

Open the editor from the site. The **home screen** opens first. It shows a lineup of characters, with your saved characters at the front and built-in presets after them. On a first visit there are no saved characters yet, and no dialog opens.

You do not need to sign in or install anything.

<!-- TODO(screenshot): home screen on a fresh profile with the preset lineup, the avatar strip and the Edit button -->

## 2. Start from a preset

1. Select a preset in the lineup, or in the avatar strip under it. Use the arrow keys, or click it.
2. Choose **Start from this preset**.

The editor saves a new project with that name and opens it in the **Easy** workspace. The built-in preset itself never changes.

## 3. Change the look

In **Easy**:

1. Open a category tab, such as **Hair**.
2. Choose a tile. The preview updates at once.
3. Choose a color swatch under the tiles.
4. Press **Undo** in the bottom bar if you change your mind.

Easy has no sliders. For fine control, switch to **Pro** (see the next step).

<!-- TODO(screenshot): Easy workspace with the Hair tab open and a swatch row checked -->

## 4. Choose the animations

Easy previews **Idle** and **Walk** with the buttons under the preview, but the export list is set in Pro.

1. Choose **Pro** in the top bar, or press `Ctrl / Cmd+Alt+P`.
2. Open the **Animation** tab in the inspector.
3. Add **idle** and **walk** to the export list.

## 5. Export

1. Click **Export** in the bottom bar (Easy) or the top bar (Pro), or press `Ctrl / Cmd+E`.
2. Keep the layout as **Grid by animation**. It puts one row per animation and direction.
3. Click **Export** in the dialog, then wait for the progress to finish.
4. Your browser downloads one file, `<name>.zip`, where the name comes from your character.

Unzip it. You get the sprite sheet PNG, an Aseprite-style JSON file, a manifest JSON file and a `CREDITS.txt`. Credits always travel with the sprites.

> [!TIP]
> Your project saves itself in this browser. Press `Ctrl / Cmd+S` to save immediately.

## Next steps

- [Home screen](./home-screen.md) explains the lineup, the avatar strip and the menu for each character.
- [New-character wizard](./new-character-wizard.md) builds a character from scratch in eight steps.
- [Interface tour](./interface-tour.md) shows the top bar and how the two workspaces fit together.
- [Export](../export/index.md) explains the layouts and files in detail.

<!-- spec: REQ-UX-070 -->
<!-- spec: REQ-UX-078 -->
<!-- spec: REQ-UX-051 -->
<!-- spec: REQ-EXP-017 -->
