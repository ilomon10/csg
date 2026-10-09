---
title: Easy workspace
description: "Build a character with big option tiles, color swatches and body shapes: the categories, preview controls, bottom bar and Custom values."
---

# Easy workspace

Easy is a character creator built from big tiles and color swatches. There are no sliders, numbers or free color pickers. Everything you change in Easy is the same data that Pro edits, so you can switch to Pro at any time and keep your work.

<!-- TODO(screenshot): Easy workspace at 1440 by 900 px, Hair tab open, preview on the left -->

## Layout

- **Preview** on the left, about 55 % of the width. It shows the character, with the **Pixel | 3D** and **Idle | Walk** switches below it.
- **Customize** on the right. It holds the category tabs and the option tiles.
- **Bottom bar**: **Undo**, **Redo**, **Randomize**, **Reset tab** and **Export**.
- **Top bar**: the same as in every editor view. See [Interface tour](./interface-tour.md).

On a window between 768 and 1023 pixels wide, the preview sits above the Customize panel.

## Categories

The tabs are **Body**, **Skin**, **Face**, **Hair**, **Outfit**, **Accessories** and **Colors**. Use the arrow keys to move between tabs, and press **Enter** to open one. The tab you used last is remembered.

- **Body** holds the body tiles and the **Shape** group (see below).
- **Skin** holds the skin-tone swatches.
- **Hair**, **Face**, **Outfit** and **Accessories** hold the parts for that area, with a color row under the tiles.
- **Colors** lists the color channels as tile groups. Choose a channel, and its swatch row appears below.

If a category has few parts, its tiles show "None" and not much else. That is expected.

## Option tiles

- Each tile is at least 96 pixels square and shows the part's picture and name.
- Optional slots start with a **None** tile.
- Parts that do not fit your body are not shown.
- Use the arrow keys to move between tiles, and **Home** or **End** to go to the first or last one.
- Press **Enter** or **Space** to choose a tile. The focus does not change the choice, so you can look before you pick.
- Each choice is one undo step, labelled "Equip" followed by the part name.

## Color swatches

Under the tiles, a row of swatches sets the color of the part you chose most recently.

- The row is labelled "Color:" followed by the part name, for example "Color: Ponytail".
- Use the arrow keys to move through the swatches. Each one has a spoken color name, and the chosen one shows a check mark.
- A run of quick key presses on one swatch row is one undo step.

## Body shapes

The **Body** tab has a **Shape** group with six cards: **Average**, **Slim**, **Athletic**, **Stocky**, **Tall** and **Petite**. Choosing a card sets all nine proportions as one undo step. The shapes build on your current style. See [Body shapes](../anatomy/body-shapes.md).

## Custom values

Some characters have values Easy cannot show as a tile or swatch. For example, a body proportion set in Pro, or a color that is not in the swatch set.

- Easy shows the value as a selected **Custom** tile, card or swatch. For a color, the name reads "Custom color" followed by the hex value.
- **Edit in Pro** switches to Pro and opens the control that sets that value.
- Looking at a Custom value never changes it.

## Preview

- **Rotate**: drag left or right across the preview, one step for every 48 pixels. Use the **◀** and **▶** buttons, or the **←** and **→** keys while the preview has focus. Each new facing is announced, for example "Facing south-west".
- **Pixel | 3D**: switches between the pixel view and the full-resolution 3D view.
- **Idle | Walk**: plays that animation in the preview. If the preview is playing a different animation, neither button is pressed, and the animation name is shown beside them.

Changes appear in the preview within about 150 milliseconds. A part that is still loading shows a spinner on its tile.

## Bottom bar

- **Undo** and **Redo** name the step they will undo or redo, for example "Undo: Equip Ponytail". They are disabled when there is nothing to undo or redo.
- **Randomize** opens a menu with two choices:
  - **This tab** randomizes only the current category.
  - **Everything** randomizes the whole character. Locked values stay as they are.
- **Reset tab** sets the current category back to the default character, as one step labelled "Reset Hair", for example.
- **Export** opens the export dialog.

Easy has no workspace switch in the bottom bar. Use the top bar, or `Ctrl / Cmd+Alt+P`.

<!-- spec: REQ-UX-051 -->
<!-- spec: REQ-UX-056 -->
<!-- spec: REQ-UX-057 -->
<!-- spec: REQ-UX-058 -->
<!-- spec: REQ-UX-059 -->
<!-- spec: REQ-UX-060 -->
<!-- spec: REQ-UX-061 -->
<!-- spec: REQ-UX-062 -->
<!-- spec: REQ-UX-063 -->
<!-- spec: REQ-UX-064 -->
<!-- spec: REQ-UX-065 -->
<!-- spec: REQ-UX-066 -->
<!-- spec: REQ-UX-067 -->
<!-- spec: REQ-UX-068 -->
<!-- spec: REQ-UX-055 -->
