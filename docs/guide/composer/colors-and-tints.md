---
title: Colors and tints
description: Recolor skin, hair, eyes and outfits with seven tint channels, using Easy swatches or the Pro color picker with hex and HSV.
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

## Change a tint in Easy

1. Open the **Colors** category, or the category of the part you want to recolor.
2. Choose a swatch in the row under the tiles. The row is labelled with the part name, for example "Color: Ponytail".
3. Use the arrow keys to move through the swatches. Each check changes the color once.

A run of quick presses on one swatch row is one undo step.

If the color is not in the swatch set, Easy shows it as a **Custom** swatch named with its hex value. Choose **Edit in Pro** to change it exactly. See [Easy workspace](../getting-started/easy-workspace.md).

## Change a tint in Pro

1. Open the **Colors** tab in the inspector.
2. Choose a tint, such as **primary**.
3. Pick a color with the color picker. You can type a hex value, move the hue, saturation and value controls, or choose a swatch.

Hex colors have six digits and start with `#`, for example `#3a5fcd`. Uppercase letters are accepted and saved in lowercase. A value such as `123456` or `#12G` is rejected, and the message tells you the format.

While you drag in the picker, the preview updates live. The whole drag is one undo step, recorded when you let go.

<!-- TODO(screenshot): Pro Colors tab with the color picker open on primary -->

## Swatches

The picker offers three kinds of swatches:

- **Skin tones**, **hair colors** and **general** colors.
- **Palette colors**, when a palette is active in the **Render** tab. Choosing one sets the tint to that exact color.

## How a tint is applied

Each material uses one of two modes. The part data decides which one.

- **Multiply** (the usual mode). The tint is multiplied with the colors of the texture, so the shading and detail of the texture stay. White leaves the authored colors unchanged, and a grey tint darkens them. The hair texture is neutral grey, so hair starts as brown (`#7a4a26`). Most other tints start as white, so a new character keeps its authored colors.
- **Replace**. The whole part becomes the flat tint color. Its shape is kept, so transparent areas stay transparent.

In both modes, transparent areas of a part stay transparent. A material that is not linked to any tint never changes.

## Keyboard use

In Easy, move through a swatch row with the arrow keys and check a swatch with the same keys, as the radio pattern describes. Each swatch announces its name.

In Pro, press `Enter` on a tint to open its picker. Move between swatches with the arrow keys. Each swatch announces its hex value. Press `Escape` to close the picker. Focus returns to the tint you opened it from.

<!-- spec: REQ-CMP-013 -->
<!-- spec: REQ-CMP-014 -->
<!-- spec: REQ-CMP-016 -->
<!-- spec: REQ-CMP-017 -->
<!-- spec: REQ-UX-062 -->
<!-- spec: REQ-UX-055 -->
