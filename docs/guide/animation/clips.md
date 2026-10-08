---
title: Clips and the clip library
description: Browse the bundled animation clips by category, add them to an export, reorder them and give each one a unique label.
---

# Clips and the clip library

A clip is one named animation, such as `idle`, `walk`, `run` or `attack_1`. The clip library holds the clips that ship with the editor.

## Categories

| Category   | Holds                                     |
| ---------- | ----------------------------------------- |
| Locomotion | Walking, running and other ways of moving |
| Combat     | Attacks and guards                        |
| Reaction   | Being hit, and other short responses      |
| Death      | Falling and dying                         |
| Emote      | Gestures and expressions                  |
| Misc       | Everything else                           |

## Add and remove clips

- Select a clip to add it to the export list.
- Select an entry in the list to remove it.
- You can export up to 32 clips in one sheet. The add button is disabled after that, with the message "Maximum 32 animations per export".

Each entry in the list becomes a row of frames in the sheet, in the order shown.

## Reorder clips

Move an entry up or down with the mouse, or with `Alt+Up` and `Alt+Down`. Each move is one undo step.

## Labels

Each entry has a label. The label is used in file names and in the metadata, so it must be unique.

- Labels use lowercase letters, digits and dashes, up to 48 characters.
- Adding the same clip twice gives the second entry a new label, such as `attack-1-2`. You can rename it.

## Root motion

Some clips move the character across the ground, such as a run that travels forward. By default, the editor removes that movement. The character stays in the centre of the frame, and the sprite does not drift. Only the up-and-down motion stays, so a jump still rises.

> [!NOTE]
> **Planned.** Keeping the movement as metadata, so your game can move the sprite to match, is planned for a later release. Clips you upload yourself, and a per-direction override, are also planned.

<!-- spec: REQ-ANM-002 -->
<!-- spec: REQ-ANM-004 -->
<!-- spec: REQ-ANM-006 -->
<!-- spec: REQ-ANM-013 -->
