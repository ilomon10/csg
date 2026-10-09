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

- **Palette colors**, when a palette is active in the **Render** tab. Choosing one sets the tint to that exact color. This swatch group is planned with the Render tab.
- **Skin tones**, **hair colors** and **general** swatches.

## How a tint is applied

Each material uses one of two modes. The part data decides which one.

- **Multiply** (the usual mode). The tint is multiplied with the colors of the texture, so the shading and detail of the texture stay. White leaves the authored colors unchanged, and a grey tint darkens them. The hair texture is neutral grey, so hair starts as brown (`#7a4a26`). Most other tints start as white, so a new character keeps its authored colors.
- **Replace**. The whole part becomes the flat tint color. Its shape is kept, so transparent areas stay transparent.

In both modes, transparent areas of a part stay transparent. A material that is not linked to any tint never changes.

## Keyboard use

Press `Enter` on a tint to open its picker. Move between swatches with the arrow keys. Each swatch announces its hex value. Press `Escape` to close the picker. Focus returns to the tint you opened it from.

> [!NOTE]
> **Planned.** Dragging in the color picker updating the preview live, with one undo step at the end, and per-part tint overrides are planned for a later release.

<!-- spec: REQ-CMP-013 -->
<!-- spec: REQ-CMP-014 -->
<!-- spec: REQ-CMP-016 -->
