---
title: Interface tour
description: A tour of the home screen, the top bar and the Easy and Pro workspaces, which share one document and one undo history.
---

# Interface tour

The editor has three views: the **home screen**, the **new-character wizard** and the **editor**. The editor has two workspaces, **Easy** and **Pro**. Both show the same character, so you can switch between them at any time.

<!-- TODO(screenshot): Easy and Pro side by side at 1440 by 900 px, with the top bar labelled -->

## The views

| View | Address | What it is |
|------|---------|------------|
| Home screen | `#home` | Your characters and presets. See [Home screen](./home-screen.md). |
| Wizard | `#new` | Builds a new character in eight steps. See [New-character wizard](./new-character-wizard.md). |
| Editor | `#p=<id>` | Edits one project, in Easy or Pro. |

Back and Forward in your browser move between these views.

## The top bar

The top bar is on every editor view.

- **Home**: returns to the home screen. Any pending save is finished first.
- **Project name** and **save status**: **Saved**, **Saving…**, **Unsaved changes** or **Save failed**. See [Save, load and share](../composer/save-load-share.md).
- **Search** (`Ctrl / Cmd+K`): opens the command palette.
- **Renderer badge**: **WebGPU**, **WebGL2**, or **No GPU**. It opens the diagnostics report.
- **Help** (`?`): shows the shortcuts for where you are. See [Keyboard shortcuts](./keyboard-shortcuts.md).
- **Settings**: theme (Dark, Light or System), single-key shortcuts, reduced motion and the startup view.
- **Workspace**: the **Easy | Pro** switch.
- **Export**: opens the export dialog (Pro). In Easy, the Export button is in the bottom bar.

## Switch workspaces

Switch with any of these:

- The **Easy | Pro** switch in the top bar.
- `Ctrl / Cmd+Alt+P`.
- The command palette: type "workspace", then choose **Switch workspace**.

Switching changes only the layout. The character stays the same, and nothing is converted or reset. No dialog opens. The change does not add an entry to the undo history.

- **One undo history**: an undo in Pro can undo a change you made in Easy, and the other way round.
- **Shared view state**: the preview mode (Pixel or 3D), the direction, the preview animation and the save status carry over.
- **Custom values**: Easy shows a value it cannot display as a **Custom** tile, card or swatch, with an **Edit in Pro** button. It never changes the value only because it displays it.
- **Remembered choice**: the editor reopens projects in the workspace you used last. A new browser profile starts in Easy.

## Easy and Pro

- **Easy** is a character creator with tiles, swatches and body shapes. There are no sliders. See [Easy workspace](./easy-workspace.md).
- **Pro** shows the part library, the viewport, the inspector and the dock. It gives you the anatomy sliders, the render settings, the look and the animation controls. See [Pro workspace](./pro-workspace.md).

## Undo and redo

- Every change to your character is one entry in a single history of up to 200 steps. Each entry has a label, such as "Undo: Equip Ponytail".
- **Ctrl / Cmd+Z** undoes and **Ctrl / Cmd+Shift+Z** redoes, from any region, except inside a text field.
- A drag, or a quick run of key presses on one control, is one entry.
- Changes to the view, such as zoom and panel sizes, are not in the history.
- The history lasts for this session. A page reload clears it.

## Command palette and help

- **Command palette** (`Ctrl / Cmd+K`): type a few letters of any command, such as "rand", and press **Enter**. Each command shows its shortcut. Commands that cannot run now are shown greyed out, with the reason.
- **Shortcut help** (`?` or `F1`): lists the shortcuts that work where you are, in your platform's notation.

## Keyboard and screen reader use

- Every action can be reached with the keyboard.
- **F6** moves focus between the top bar, the preview, the panel and the bottom bar. **Shift+F6** moves backwards.
- **Escape** closes a dialog, the palette or the help overlay without changing anything.
- With reduced motion, panels and the lineup do not slide. You can set this in your system or in **Settings**.

<!-- spec: REQ-UX-020 -->
<!-- spec: REQ-UX-022 -->
<!-- spec: REQ-UX-024 -->
<!-- spec: REQ-UX-034 -->
<!-- spec: REQ-UX-037 -->
<!-- spec: REQ-UX-051 -->
<!-- spec: REQ-UX-052 -->
<!-- spec: REQ-UX-053 -->
<!-- spec: REQ-UX-054 -->
<!-- spec: REQ-UX-055 -->
<!-- spec: REQ-UX-056 -->
<!-- spec: REQ-UX-001 -->
<!-- spec: REQ-UX-003 -->
<!-- spec: REQ-UX-042 -->
