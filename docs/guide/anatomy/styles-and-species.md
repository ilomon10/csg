---
title: Styles and species
description: Which body styles and species are available now or coming soon, what changing a style does, and how coming-soon characters are handled.
---

# Styles and species

A character has a **style**, which sets its overall look and starting proportions, and a **species**, such as Human. Together they decide which parts fit and which animations you can export.

## Styles

| Style | Status | What it is |
|-------|--------|------------|
| Realistic | Available | The default. Natural proportions, for sprites from 96 to 128 pixels. |
| Chibi | Available | A large head, short limbs and large hands and feet. Good for small sprites. See [Chibi and readability](./chibi-and-readability.md). |
| Stickman | Coming soon | Not available yet. |
| Voxel | Coming soon | Not available yet. |

## Species

| Species | Status |
|---------|--------|
| Human | Available |
| Animal | Coming soon. An anthropomorphic animal. |
| Monster | Coming soon. |

In this release, a character can be Realistic or Chibi, and Human.

## Coming soon options

A coming-soon option is listed with a **Coming soon** label. You cannot choose it. You can still move to it with the arrow keys, and its description reads "Coming soon. Available in a later update."

If a saved character already uses a coming-soon style or species, it still loads and stays unchanged. The preview shows a fallback instead, with a notice such as "Stickman is coming soon. Showing Realistic for now." Export is blocked until you choose an available style. The export button shows the reason as text.

## Change the style

Choosing a style does two things, both as one undo step:

- It sets the style's starting proportions. Choosing Chibi applies the Chibi anatomy preset, and choosing Realistic applies the Realistic preset. See [Anatomy](./index.md).
- It removes any parts that do not fit the new style, and lists them in a notice. For example, a part that is made only for Realistic is removed when you choose Chibi.

One undo brings back the old style, the proportions and the removed parts.

## Where to choose

- **New character**: steps 1 and 2 of the [wizard](../getting-started/new-character-wizard.md).
- **Easy**: the **Body** category.

<!-- spec: REQ-CMP-038 -->
<!-- spec: REQ-CMP-042 -->
<!-- spec: REQ-CMP-043 -->
<!-- spec: REQ-CMP-044 -->
<!-- spec: REQ-CMP-045 -->
<!-- spec: REQ-CMP-048 -->
<!-- spec: REQ-UX-090 -->
<!-- spec: REQ-UX-091 -->
<!-- spec: REQ-UX-092 -->
