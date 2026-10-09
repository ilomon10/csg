---
title: Parts and slots
description: The fifteen slots a character can hold, how parts fill them, how parts hide body regions, and why some parts do not fit a body or a style.
---

# Parts and slots

A character has fifteen slots. Each slot holds at most one part. Only the body slot must always be filled.

<!-- spec: REQ-CMP-001 -->

| Slot             | What goes in it                | Required |
| ---------------- | ------------------------------ | -------- |
| `body`           | The base character             | Yes      |
| `hair`           | Hairstyles                     | No       |
| `eyebrows`       | Eyebrows                       | No       |
| `beard`          | Beards and moustaches          | No       |
| `face`           | Masks and glasses              | No       |
| `headwear`       | Hats and helmets               | No       |
| `torso`          | Shirts, armour and robe tops   | No       |
| `arms`           | Sleeves and bracers            | No       |
| `hands`          | Gloves                         | No       |
| `legs`           | Trousers and skirts            | No       |
| `feet`           | Shoes and boots                | No       |
| `back`           | Capes and backpacks            | No       |
| `accessory`      | Belts and pouches              | No       |
| `prop-main-hand` | An item held in the right hand | No       |
| `prop-off-hand`  | An item held in the left hand  | No       |

## Equip and clear a part

- Choose a part tile to equip it. The new part replaces the old one in that slot.
- To clear a slot, select it and choose **Clear**, or press `Delete`.
- The body slot cannot be cleared. Its clear control is disabled.

Keyboard users can move through the part grid with the arrow keys, equip with `Enter`, and clear the focused slot with `Delete`.

## Search and filter

In Pro, the part library has a search box. It matches the part name and its tags as you type, and it works with the slot filter. Filters by source, pack and license are planned for a later release.

## Mix parts from different packs

Parts from different packs combine freely. A shirt from one pack can go on a body from another, as long as both fit the body.

## Parts that take more than one slot

Some parts, such as a robe, fill two slots. Equipping a robe clears the `legs` slot and shows "occupied by Robe" there. Choosing trousers for `legs` removes the robe, so the latest choice always wins.

One undo brings back both the previous torso and the previous legs.

## Parts that hide body regions

A part can hide regions of the body underneath it, so the body does not poke through. A helmet can hide the hair, for example. Hidden hair stays in your character file, and it returns when you remove the helmet.

## Parts that do not fit

A part fits a character when all of these are true:

- Skinned parts (clothes and hair that bend with the skeleton) use the same skeleton as the body.
- The part lists the body, or lists no bodies.
- The part's body type matches the body, or it lists no body types.
- The part lists the character's style, or lists no styles.
- The part lists the character's species, or lists no species.

Incompatible parts are hidden from the picker. Turn on **Show incompatible** to see them. They appear greyed out, each with a text reason such as "Fits Superhero bodies only".

If you change the body, the style or the species and some equipped parts no longer fit, those parts are removed. A notice lists them, for example "Removed 1 part that does not fit this body: Chestplate". One undo restores the old choice and the removed parts.

<!-- TODO(screenshot): Pro part library with Show incompatible on, one greyed part showing its reason -->

<!-- spec: REQ-CMP-002 -->
<!-- spec: REQ-CMP-007 -->
<!-- spec: REQ-CMP-008 -->
<!-- spec: REQ-CMP-009 -->
<!-- spec: REQ-CMP-010 -->
<!-- spec: REQ-CMP-011 -->
<!-- spec: REQ-CMP-030 -->
<!-- spec: REQ-CMP-032 -->
<!-- spec: REQ-CMP-048 -->
