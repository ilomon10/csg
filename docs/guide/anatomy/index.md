---
title: Anatomy
description: Change proportions with body shapes in Easy or the nine anatomy sliders in Pro, and understand how a style sets the starting proportions and presets.
---

# Anatomy

Anatomy is the set of proportions of your character: how tall it is, how big its head is, how long its limbs are. There are two ways to change it.

- **Body shapes** (Easy, and the wizard): six ready-made shapes, such as **Stocky** or **Slim**. See [Body shapes](./body-shapes.md).
- **Anatomy sliders** (Pro, **Anatomy** tab): nine values you can set exactly, with presets.

Every value is a multiplier of the body as it was made. A value of 1.00 means no change.

<!-- TODO(screenshot): Pro Anatomy tab with the nine sliders and the preset menu -->

## Styles set the starting point

Choosing a **style** also sets the anatomy values. Realistic sets the Realistic preset, and Chibi sets the Chibi preset. The change is one undo step. Parts stay on your character unless they do not fit the new style. See [Styles and species](./styles-and-species.md).

## The nine sliders

| Slider         | Range        | Default | What it changes                    |
| -------------- | ------------ | ------- | ---------------------------------- |
| Height         | 0.80 to 1.25 | 1.00    | The whole character                |
| Head           | 0.80 to 2.00 | 1.00    | The head, and anything worn on it  |
| Torso width    | 0.80 to 1.40 | 1.00    | The chest and waist                |
| Shoulders      | 0.80 to 1.40 | 1.00    | The collarbones and shoulder width |
| Arm length     | 0.75 to 1.25 | 1.00    | Upper arms and forearms            |
| Leg length     | 0.70 to 1.30 | 1.00    | Thighs and shins                   |
| Hands          | 0.75 to 1.75 | 1.00    | Hands and fingers                  |
| Feet           | 0.75 to 1.75 | 1.00    | Feet and toes                      |
| Limb thickness | 0.75 to 1.75 | 1.00    | Arms and legs, from the inside out |

Values are stored to two decimal places.

## Change a value

- Drag a slider, or type a number in its box.
- Use the arrow keys to change a value by 0.01. Use `Page Up` and `Page Down` to change it by 0.10.
- If you type a number outside the range, the value is clamped to the nearest limit. The field says, for example, "Maximum 2.00".
- Each slider has a reset button that returns it to 1.00.

Each completed drag or key burst is one undo step.

## Presets

Presets set all nine sliders at once. Applying a preset is one undo step.

- **Default**: the body as it was made.
- **Chibi**: a large head, short limbs and large hands and feet. Good for small sizes. See [Chibi and readability](./chibi-and-readability.md).
- **Heroic**: broad shoulders and a small head, for a strong silhouette.
- **Realistic**: the same as the default. Use it for larger sprites, from 96 to 128 pixels.

If you change a value after applying a preset, the preset name shows "(modified)". Choose **Reset** to return to the preset's values.

## Things that stay correct

- Feet stay on the ground when you change proportions, and animations keep their timing.
- Hats and other head items grow with the head.
- Hand-held props keep their size when you change the hands.
- Clothing and hair follow the body automatically. You do not need to change each part.

> [!NOTE]
> When framing is set to **Auto**, the camera scales the character to fill the frame. Height changes are then hard to see. Set a fixed framing scale in **Render** to compare heights. See [Camera styles](../render-settings/camera-styles.md).

> [!NOTE]
> **Planned.** Morph targets, which are extra shape changes that some bodies provide, are planned for a later release. The sliders will appear when a body supports them.

<!-- spec: REQ-ANA-001 -->
<!-- spec: REQ-ANA-003 -->
<!-- spec: REQ-ANA-007 -->
<!-- spec: REQ-ANA-008 -->
<!-- spec: REQ-ANA-013 -->
<!-- spec: REQ-ANA-017 -->
<!-- spec: REQ-CMP-042 -->
