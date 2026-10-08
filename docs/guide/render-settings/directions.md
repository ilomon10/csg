---
title: Directions
description: Choose 1, 2, 4 or 8 facing directions for your sprites, the label each direction gets, and how single-direction sprites choose their facing.
---

# Directions

A direction is one way the character faces. The editor turns the character to each direction in turn and renders every animation frame for it. The character itself turns. The camera does not move.

## Choose how many

| Directions | Facings you get                  | Typical use                                  |
| ---------- | -------------------------------- | -------------------------------------------- |
| 1          | One, chosen in **Single facing** | Side-scrolling, or a sprite that never turns |
| 2          | `e` and `w`                      | Side-scrolling games that flip sprites       |
| 4          | `e`, `n`, `w` and `s`            | Top-down games with four directions          |
| 8          | All eight, listed below          | Top-down and isometric games                 |

## Direction labels

Each direction has a short label. The labels appear in file names, so they are useful to know.

| Label | Facing                       |
| ----- | ---------------------------- |
| `e`   | East, to the right on screen |
| `ne`  | North-east                   |
| `n`   | North, away from the camera  |
| `nw`  | North-west                   |
| `w`   | West, to the left on screen  |
| `sw`  | South-west                   |
| `s`   | South, toward the camera     |
| `se`  | South-east                   |

Directions go counter-clockwise from east. Each step is 45 degrees.

## Single facing

With one direction, choose which facing to draw. The default is `e` for the side camera, and `s` for the three-quarter and isometric cameras, where the character faces the viewer.

## Every direction matches

Every direction uses the same animation timing and the same body proportions. Only the facing changes, so frame 3 of `walk` lines up across all directions.

> [!NOTE]
> **Planned.** Creating the west-facing directions by mirroring the east-facing ones is planned for a later release. Mirroring flips the sprite, so an item held in one hand moves to the other.

<!-- spec: REQ-PIX-005 -->
<!-- spec: REQ-ANM-011 -->
