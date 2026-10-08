---
title: Editor basics
description: Open the graph editor, add and connect nodes, read socket colors and error badges, and undo, copy and export your graph edits.
---

# Editor basics

The graph editor shows one graph at a time, on a canvas. Nodes are boxes. Each node has inputs on the left and outputs on the right. A wire carries a value from an output to an input.

<!-- TODO(screenshot): graph editor with four connected nodes, one showing a red error badge -->

## Move around the canvas

- Pan by dragging with the middle mouse button, or by holding `Space` and dragging.
- Zoom with `Ctrl / Cmd` and the mouse wheel, by pinching on a trackpad, or with `+` and `-`. The zoom ranges from 10 to 400 percent.
- Press `F` to frame the selection (or everything, if nothing is selected), or `Home` to frame everything.
- The minimap in the corner shows where you are. Click it to move.
- Grid snapping keeps nodes aligned. Press `Shift+S` to turn it on or off. Hold `Alt` while dragging to place a node freely.

## Add a node

Press `Shift+A`, or tap `Space` (press and release it without moving the mouse), to open the node search. Type part of a name, such as "mix" or "posterize". Press `Enter` to add the highlighted node at the pointer.

With the search box empty, the nodes are listed by category. The five most recently used nodes are listed first.

## Connect nodes

1. Drag from an output socket to an input socket.
2. While you drag, the sockets that can take the wire are highlighted. The others fade.
3. Release the mouse on a compatible socket to connect.

Each input takes one wire. Connecting a new wire to an input that already has one replaces the old wire, in one undo step.

If you drop a wire on an incompatible socket, nothing is connected. A tooltip explains why, such as "Can't connect vec3 to float. Use a Split node." Drop a wire on empty space to open the node search, filtered to the nodes that fit the wire.

Some connections convert a value. Converting a three-part vector to a two-part one drops the last part. The wire is drawn dashed, with a warning.

### Socket shapes

Every socket type has its own shape as well as its own color, so you can tell types apart without relying on color alone.

| Type         | Shape              |
| ------------ | ------------------ |
| float        | Circle             |
| int          | Diamond            |
| bool         | Square             |
| vec2 to vec4 | Circle with a dot  |
| color        | Half-filled circle |
| texture      | Square outline     |

## Node controls

- **Collapse** a node with `H`. A collapsed node shows only its header.
- **Show a preview** with `Shift+H`. The node shows a 64 by 64 thumbnail of its output.
- **Mute** a node with `M`. A muted node passes its input straight through, and it shows a "muted" badge.
- **Hide unused sockets** with `Ctrl / Cmd+H`. Only connected sockets stay visible.
- **Insert a reroute point** by holding `Alt` and clicking a wire.
- **Select all** nodes with `A` or `Ctrl / Cmd+A`. **Deselect all** with `Alt+A`.
- **Move** the selected nodes one grid step with `Ctrl / Cmd` and an arrow key.
- **Delete** the selection with `Delete` or `Backspace`.
- **Duplicate** the selection with `Ctrl / Cmd+D` or `Shift+D`.

## Errors and warnings

When the graph has a problem, the node turns red, shows an error badge with a count, and outlines the socket at fault. Hover over the socket to read the message.

The **Issues** panel lists every error. Select an entry to jump to its node. Warnings, such as "Time is 0 in exports", appear as yellow badges. They do not stop the graph from running.

If an edit causes an error, the character preview keeps showing the last working version and a banner tells you so.

## Undo, copy and files

- `Ctrl / Cmd+Z` undoes, and `Ctrl / Cmd+Shift+Z` or `Ctrl / Cmd+Y` redoes. A drag, a slider change or a multi-node change is one step.
- `Ctrl / Cmd+C` copies the selected nodes and `Ctrl / Cmd+X` cuts them. `Ctrl / Cmd+V` pastes them at the pointer. You can paste into another open project tab, if the graph is the same kind.
- **Export graph** saves the graph as a `<name>.csgraph.json` file. Import it from the file picker, or drop it onto the canvas.
- Importing a file that is for the other graph type offers to open it in the right editor.

## Keyboard only

Move focus between nodes with the arrow keys. Press `Enter` to enter a node and move between its sockets with `Tab`. Press `C` on a socket to connect it to another socket from a list. Press `Escape` to leave a node, and `F6` to leave the canvas.

> [!NOTE]
> **Planned.** Searching the graph with `Ctrl / Cmd+F`, the context menu, aligning nodes, cutting wires with a drag, and sharing a graph as a link are planned for a later release.

<!-- spec: REQ-EDT-004 -->
<!-- spec: REQ-EDT-008 -->
<!-- spec: REQ-EDT-014 -->
<!-- spec: REQ-EDT-015 -->
<!-- spec: REQ-EDT-016 -->
<!-- spec: REQ-EDT-022 -->
<!-- spec: REQ-EDT-037 -->
<!-- spec: REQ-EDT-046 -->
<!-- spec: REQ-EDT-049 -->
