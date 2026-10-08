---
title: Your first sprite sheet
description: Open the editor, change a sample character, pick animations and export a sprite sheet ZIP in about five minutes.
---

# Your first sprite sheet

This walkthrough takes about five minutes. You start from a sample character, change a few things, and export a sprite sheet.

## 1. Open the editor

Open the editor from the home page of the site. On your first visit, a **Welcome** dialog appears. Choose **Start from a sample**, then pick any sample.

The sample renders in the viewport within a few seconds. You do not need to sign in or install anything.

<!-- TODO(screenshot): Welcome dialog with sample character thumbnails -->

## 2. Look at the viewport

The viewport shows your character. Use the **3D** and **Pixel** buttons in the viewport toolbar to switch views.

- **3D** shows a full-resolution view you can orbit.
- **Pixel** shows the low-resolution frame that will be exported, scaled up with sharp pixels.

Press `V` to toggle between them.

## 3. Change a part

1. Open the **Parts** tab in the right-hand inspector.
2. Click a slot such as **hair**, or select it in the part library on the left.
3. Click a part tile. The part replaces whatever was in that slot.

To remove a part, select its slot and choose **Clear**, or press `Delete`.

## 4. Change a color

1. Open the **Colors** tab.
2. Click a tint such as **skin** or **primary**.
3. Pick a swatch, or type a hex color such as `#3a5fcd`.

## 5. Choose the animations

1. Open the **Animation** tab.
2. Add **idle** and **walk** to the export list.
3. Press `Space` in the viewport to play the preview.

## 6. Set the camera and size

1. Open the **Render** tab.
2. Set **Camera** to **Side**.
3. Keep **Resolution** at 64 by 64 pixels, and set **Directions** to 2.

## 7. Export

1. Click **Export** in the top bar, or press `Ctrl+E`.
2. Keep the layout as **Grid by animation**. It puts one row per animation and direction.
3. Click **Export** in the dialog, then wait for the progress bar to finish.
4. Your browser downloads one file, `<name>.zip`.

Unzip it. You get the sprite sheet PNG, a metadata JSON file, a manifest JSON file and a `CREDITS.txt`.

<!-- TODO(screenshot): export dialog with the grid layout selected and the progress bar -->

> [!TIP]
> Your project saves itself in this browser. Press `Ctrl+S` to save immediately.

## Next steps

- [Interface tour](./interface-tour.md) shows every region of the editor.
- [Composer](../composer/index.md) explains parts, slots and tints.
- [Export](../export/index.md) explains the layouts and files in detail.
