---
title: Props and sockets
description: Fit a sword, shield, hat or backpack to a socket on the body, start from a category's default placement, and adjust it with the gizmo or number fields.
---

# Props and sockets

A static prop is an item that does not bend with the skeleton, such as a sword, a shield or a hat. It is attached to a **socket**, which is a bone where the item sits. Sockets move with the body, so the item follows every animation.

## Pick a category

When you upload a prop, choose a category. The category fills in the slot, the socket and a default position for the item.

| Category          | Slot           | Socket     |
| ----------------- | -------------- | ---------- |
| One-hand weapon   | prop-main-hand | `hand_r`   |
| Two-hand weapon   | prop-main-hand | `hand_r`   |
| Shield / off-hand | prop-off-hand  | `hand_l`   |
| Headwear          | headwear       | `head`     |
| Back item         | back           | `spine_03` |
| Belt / hip item   | accessory      | `pelvis`   |
| Other             | accessory      | `hand_r`   |

You can choose any socket from the list: `hand_r`, `hand_l`, `head`, `spine_03` or `pelvis`.

## Automatic scale

Before the default placement is applied, the editor scales the prop so that it has a believable height for its category:

- One-hand weapons: 0.4 to 1.2 metres tall.
- Shields: 0.4 to 0.9 metres tall.
- Headwear: 0.1 to 0.4 metres tall.

Other categories keep their size. The editor also moves the pivot to the centre of the item, or to its bottom centre for headwear.

## Adjust the placement

Once a prop is placed, you can move it in two ways.

- **Gizmo**: drag the handles on the prop in the viewport. Press `W` to move, `E` to rotate, and `R` to scale. Hold `Shift` to snap: 0.01 metres for moves, 15 degrees for rotations, and 0.1 times for scale.
- **Number fields**: type exact values. The gizmo and the fields stay in step, so you can switch between them.

| Setting  | Range               | Step  |
| -------- | ------------------- | ----- |
| Position | -2 to 2 metres      | 0.001 |
| Rotation | -180 to 180 degrees | 1     |
| Scale    | 0.01 to 100         | 0.01  |

Scale is uniform by default, so the item keeps its proportions. A scale below 0.01 is raised to 0.01, and the field tells you why.

Press `Enter` to apply the placement, or `Escape` to cancel it.

## Items that grow with the body

A prop attached to the head grows when you change the **Head** slider. A prop in the hand keeps its size when you change the **Hands** slider. See [Anatomy sliders](../anatomy/index.md).

> [!NOTE]
> **Planned.** Adjusting a prop on one character without changing the default for every character is planned for a later release. For now, placements are saved with the upload.

<!-- TODO(screenshot): prop fitting step with the gizmo on a sword held in the right hand -->

<!-- spec: REQ-UPL-026 -->
<!-- spec: REQ-UPL-027 -->
<!-- spec: REQ-UPL-028 -->
<!-- spec: REQ-ANA-007 -->
