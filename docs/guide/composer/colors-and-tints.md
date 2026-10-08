---
title: Colors and tints
description: Recolor skin, hair, eyes and outfits with seven tint slots, using hex values, color swatches and the active palette.
---

# Colors and tints

A character has seven tints. Each tint recolors every part whose material is linked to it.

| Tint        | Typical use                 |
| ----------- | --------------------------- |
| `skin`      | Skin                        |
| `hair`      | Hair                        |
| `eyes`      | Eyes                        |
| `primary`   | Main outfit color           |
| `secondary` | Accent outfit color         |
| `metal`     | Buckles, armour and weapons |
| `leather`   | Belts, boots and straps     |

Changing a tint updates every equipped part at once. You do not reload the parts.

## Change a tint

1. Open the **Colors** tab in the inspector.
2. Click a tint, such as **primary**.
3. Pick a swatch, or type a hex color in the text field.

Hex colors have six digits and start with `#`, for example `#3a5fcd`. Uppercase letters are accepted and saved in lowercase. A value such as `123456` or `#12G` is rejected, and the message tells you the format.

<!-- TODO(screenshot): Colors tab with the color picker open on primary -->

## Swatches

The picker offers three kinds of swatches:

- **Palette colors**, when a palette is active in the **Render** tab. Choosing one sets the tint to that exact color.
- **Skin tones**, **hair colors** and **general** swatches.

## How a tint is applied

Some materials keep their shading and texture detail when you recolor them. Others become a flat color. The part data decides which. A material that is not linked to any tint never changes.

## Keyboard use

Press `Enter` on a tint to open its picker. Move between swatches with the arrow keys. Each swatch announces its hex value. Press `Escape` to close the picker. Focus returns to the tint you opened it from.

> [!NOTE]
> **Planned.** Dragging in the color picker updating the preview live, with one undo step at the end, and per-part tint overrides are planned for a later release.

<!-- spec: REQ-CMP-013 -->
<!-- spec: REQ-CMP-014 -->
<!-- spec: REQ-CMP-016 -->
