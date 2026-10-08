---
title: Keyboard shortcuts
description: Every default keyboard shortcut in the editor, grouped by where it works, with notes on single-key shortcuts and browser conflicts.
---

# Keyboard shortcuts

In this guide, `Ctrl / Cmd` means `Ctrl` on Windows and Linux, and `⌘` (Command) on macOS. `Alt` means Option on macOS. The shortcut help (`?` or `F1`) shows each shortcut in your platform's notation, for example `Ctrl+Shift+Z` or `⇧⌘Z`.

Shortcuts only fire in the region they belong to. For example, the graph shortcuts work only when the graph canvas has focus. Press `F6` to move focus between regions.

> [!NOTE]
> Single-key shortcuts such as `R`, `V` and `M` work only while their region has focus. Turn them off with the **Single-key shortcuts** setting if they get in the way. Shortcuts do not fire while you type in a text field, except `Ctrl / Cmd+S`, `Ctrl / Cmd+K`, `Ctrl / Cmd+Shift+P`, `F1` and `Escape`.

## Everywhere

| Action                                               | Keys                               |
| ---------------------------------------------------- | ---------------------------------- |
| Open the command palette                             | Ctrl / Cmd+K or Ctrl / Cmd+Shift+P |
| Show the shortcut help                               | ? or F1                            |
| Undo                                                 | Ctrl / Cmd+Z                       |
| Redo                                                 | Ctrl / Cmd+Shift+Z or Ctrl / Cmd+Y |
| Save the project now                                 | Ctrl / Cmd+S                       |
| Download the project file                            | Ctrl / Cmd+Shift+S                 |
| Open a project                                       | Ctrl / Cmd+O                       |
| Start a new project                                  | Ctrl / Cmd+Alt+N                   |
| Open the export dialog                               | Ctrl / Cmd+E                       |
| Move focus to the next region                        | F6                                 |
| Move focus to the previous region                    | Shift+F6                           |
| Close a dialog, palette or overlay, or cancel a drag | Escape                             |

## Panels and dock

| Action                        | Keys                       |
| ----------------------------- | -------------------------- |
| Show or hide the bottom dock  | Ctrl / Cmd+J               |
| Switch dock to Timeline       | Ctrl / Cmd+Shift+L         |
| Switch dock to Material graph | Ctrl / Cmd+Shift+G         |
| Switch dock to Post graph     | Ctrl / Cmd+Shift+O         |
| Maximize or restore the dock  | Ctrl / Cmd+Shift+M         |
| Open an inspector tab, 1 to 5 | Alt+Shift+1 to Alt+Shift+5 |

The inspector tabs are numbered in this order: 1 Parts, 2 Colors, 3 Anatomy, 4 Render, 5 Animation.

## Composer

These work in the part library, the viewport and the inspector.

| Action                    | Keys                |
| ------------------------- | ------------------- |
| Randomize, keeping locks  | R                   |
| Randomize with a new seed | Shift+R             |
| Clear the focused slot    | Delete or Backspace |

`Delete` and `Backspace` clear a slot only when a slot in the part library has focus.

## Viewport and timeline

| Action                          | Keys                                  |
| ------------------------------- | ------------------------------------- |
| Play or pause the preview       | Space                                 |
| Step one frame back or forward  | Left and Right arrows, or `,` and `.` |
| Jump to the first or last frame | Home and End (timeline)               |
| Toggle 3D and Pixel view        | V (viewport)                          |
| Frame the character             | F (viewport)                          |
| Previous or next direction      | [ and ] (viewport)                    |
| Zoom in or out in Pixel view    | + and - (viewport)                    |

Stepping a frame pauses playback.

## Shader graph canvas

These work when the graph canvas has focus.

| Action                                       | Keys                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Open the node search                         | Shift+A, or tap Space                                                                  |
| Zoom the canvas in or out                    | + and -                                                                                |
| Mute or unmute selected nodes                | M                                                                                      |
| Collapse or expand selected nodes            | H                                                                                      |
| Turn the preview on selected nodes on or off | Shift+H                                                                                |
| Hide or show unused sockets                  | Ctrl / Cmd+H                                                                           |
| Frame the selection (all nodes if none)      | F                                                                                      |
| Frame all nodes                              | Home                                                                                   |
| Add a frame around the selection             | J                                                                                      |
| Group into a subgraph, or ungroup            | Ctrl / Cmd+G, or Ctrl / Cmd+Alt+G                                                      |
| Enter or leave a group                       | Tab (with a group selected to enter, or with nothing selected inside a group to leave) |
| Leave a group                                | Escape (with nothing selected)                                                         |
| Copy, cut or paste nodes                     | Ctrl / Cmd+C, Ctrl / Cmd+X or Ctrl / Cmd+V                                             |
| Duplicate the selection                      | Ctrl / Cmd+D or Shift+D                                                                |
| Delete the selection                         | Delete or Backspace                                                                    |
| Select all nodes                             | A or Ctrl / Cmd+A                                                                      |
| Deselect all                                 | Alt+A                                                                                  |
| Move selected nodes one grid step            | Ctrl / Cmd+arrow keys                                                                  |
| Connect the focused socket from a list       | C                                                                                      |
| Turn grid snapping on or off                 | Shift+S                                                                                |

In any other case, `Tab` moves focus as usual, so you can always leave the canvas with `Tab` or `F6`. A grid step is 16 pixels.

### Moving around without a mouse

Move focus between nodes with the arrow keys. Press `Enter` to enter the focused node, and `Tab` or `Shift+Tab` to move between its sockets and controls. Press `Escape` to leave the node.

### Mouse gestures

- Pan by holding `Space` and dragging, or by dragging with the middle mouse button. A quick tap of `Space` opens the node search instead.
- Zoom with `Ctrl / Cmd` and the mouse wheel, or pinch on a trackpad.
- Alt-click a wire to add a reroute point.
- Hold `Alt` while dragging a node to place it without snapping.
- Drag a wire into empty space to open the node search with only the compatible nodes.

## Fitting a prop

These work while you fit a prop in the upload wizard.

| Action             | Keys   |
| ------------------ | ------ |
| Move the gizmo     | W      |
| Rotate the gizmo   | E      |
| Scale the gizmo    | R      |
| Apply the fitting  | Enter  |
| Cancel the fitting | Escape |

While you fit a prop, `R` scales the gizmo instead of randomizing the character.

> [!IMPORTANT]
> Some shortcuts replace browser shortcuts when the editor is focused. These include `Ctrl / Cmd+E`, `Ctrl / Cmd+J`, `Ctrl / Cmd+D`, `Ctrl / Cmd+H`, `Ctrl / Cmd+G` and `Ctrl / Cmd+O`. The editor never uses reserved browser shortcuts such as `Ctrl+T`, `Ctrl+W`, `Ctrl+R` or browser zoom.

> [!NOTE]
> **Planned.** These are planned for a later release: aligning selected nodes with `Alt+Shift` and an arrow key, finding in the graph with `Ctrl / Cmd+F`, opening the graph context menu with `Shift+F10` or the Menu key, cutting wires by dragging across them with `Ctrl / Cmd` and the right mouse button, and changing shortcuts in Settings.

<!-- spec: REQ-UX-011 -->
<!-- spec: REQ-UX-014 -->
<!-- spec: REQ-UX-016 -->
<!-- spec: REQ-UX-018 -->
<!-- spec: REQ-UX-021 -->
