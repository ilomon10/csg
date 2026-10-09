---
title: Home screen
description: Pick a saved character or a preset from the lineup, start a new character, and use the menu to open, duplicate, rename, export, pin or delete a character.
---

# Home screen

The home screen is the first thing you see when you open the editor. It shows your characters as a lineup, so you can pick one and keep working in a single click.

<!-- TODO(screenshot): home screen with three saved characters, the selected one centred and the ⋯ menu open -->

## What is on the screen

- **Lineup**: your characters stand in a row on a stage. The selected character is centred and drawn larger, and its name is highlighted.
- **Details line**: under the lineup, the selected character's name and "Edited" date. Presets show "Preset" instead.
- **Avatar strip**: a row of square portraits in the same order as the lineup. Use it with the keyboard.
- **New character** and **Random preset**: the two tiles before the strip.
- **Edit** or **Start from this preset**: the main button under the lineup. Its label depends on the selected character.
- **⋯**: the menu for a saved character. Presets do not have one.
- **Open file…**, **Settings** and **Help**: in the header.

## The order of characters

The lineup and the avatar strip use the same order:

1. **Pinned** characters, most recently edited first.
2. **Other saved characters**, most recently edited first.
3. **Built-in presets**, in the order the presets ship.

The first character in this order is selected when the home screen opens.

Presets cover side-view, three-quarter and isometric cameras. A preset opens with the camera it was made for.

## Choose a character

- Click a portrait in the avatar strip, or click the lineup.
- Use the **←** and **→** keys to move through the strip. The lineup follows.
- Press **Home** or **End** to go to the first or last character.

The avatar strip is the accessible list. Each portrait is announced with its name, its position and whether it is saved or a preset, for example "Mage, 4 of 12, saved".

## Open, create or start

| What you want | What to do |
|---------------|------------|
| Keep working on a saved character | Select it, then choose **Edit**. It opens in the last workspace you used. |
| Start from a built-in preset | Select it, then choose **Start from this preset**. The editor creates a project with a copy of the preset, and opens it. The preset is not changed. |
| Make a new character from scratch | Choose **New character**, or press `Ctrl / Cmd+Alt+N`. See [New-character wizard](./new-character-wizard.md). |
| Try a random preset | Choose **Random preset**. It selects a random built-in preset and does not create a project. |
| Open a project file you saved earlier | Choose **Open file…**, or press `Ctrl / Cmd+O`. |

## The ⋯ menu

The menu is for the selected saved character.

- **Open**: the same as **Edit**.
- **Duplicate**: makes a copy named after the character with " copy" added, and selects it.
- **Rename**: sets a new name, from 1 to 64 characters after spaces are trimmed.
- **Export**: opens the character and shows the export dialog.
- **Pin** or **Unpin**: moves the character into or out of the pinned group. The order is kept after a reload.
- **Delete**: asks you to confirm. The default button is **Cancel**. When you confirm, the character, its autosave versions and its cached previews are removed. The selection moves to the next character.

Nothing is removed if you choose **Cancel**.

## When you have no saved characters

The lineup shows only the presets, and the text "No saved characters yet. Create one or start from a preset." appears next to the strip. The **New character** tile has focus when the page loads, so you can press **Enter** to start.

## Previews on the home screen

Each character in the lineup plays its idle animation, and the strip shows still portraits.

- Only the selected character and the characters next to it animate, so a long list stays smooth.
- Characters off screen are not drawn.
- Playback pauses while the browser tab is hidden.
- Previews are cached in this browser. A character's preview is redrawn only after you change it.

If you turned on reduced motion, the lineup moves to the new selection without sliding, and each character shows a still frame.

## Startup

The home screen opens each time you open the editor with no project chosen. If you turn off **Show home screen on startup** in **Settings**, the editor opens your most recently edited project instead. The address `#home` always shows the home screen.

<!-- spec: REQ-UX-069 -->
<!-- spec: REQ-UX-071 -->
<!-- spec: REQ-UX-072 -->
<!-- spec: REQ-UX-073 -->
<!-- spec: REQ-UX-075 -->
<!-- spec: REQ-UX-076 -->
<!-- spec: REQ-UX-077 -->
<!-- spec: REQ-UX-078 -->
<!-- spec: REQ-UX-079 -->
<!-- spec: REQ-UX-080 -->
<!-- spec: REQ-UX-085 -->
<!-- spec: REQ-UX-087 -->
