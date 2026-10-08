---
id: EDT
title: Shader graph editor
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 003-pixel-render-pipeline, 007-shader-graph-format, 009-editor-shell-ux]
last_updated: 2026-10-08
---

# 006 – Shader graph editor

## Context

Tech artists change the look of the character (toon bands, rim, outlines, palette, dither) in a node editor that works like the Blender Shader Editor and Unity Shader Graph. Non-experts tune the same look with a few sliders in the simplified **Look** panel, which is fed by the graph's **blackboard**.

This spec covers the user-facing editor in `apps/web/src/features/shader-graph` (and the Look panel in `features/look`):

- the canvas, nodes, sockets and wires,
- the search popup, frames and groups,
- the blackboard and Look panel,
- previews, errors, editing commands, keyboard, presets and accessibility,
- the v1 node catalog.

The document format, type system, casts, compiler and error codes belong to spec 007 (SGF). This spec only cites them.

Architecture (ADR-0004): `@xyflow/react` v12 is only a **view**. The graph model in `@csg/shader-graph` is the source of truth. Every user edit is a model **command**, which keeps undo/redo, copy/paste and serialization consistent. Socket colors, shapes and cast rules come from the type registry and are never hard-coded in the view. Node and character previews are engine APIs (`CharacterRenderer.renderNodePreview`, docs/architecture.md §3.6). The shortcut registry, the single shared undo history, panel layout, persistence and the multi-tab policy belong to spec 009 (UX). Spec 009's *Default shortcuts* table is the canonical keyboard map; the Keyboard map in this spec is a copy of its `graph`-scoped rows for readers.

## Goals

- G1: An experienced Blender/Unity user can build a post effect without reading docs. The conventions, shortcuts and search behave the way they expect.
- G2: A non-expert changes the look with ≤ 10 labelled sliders and never needs to see the graph.
- G3: Errors are visible on the node that causes them, and the preview never goes blank because of a bad edit.
- G4: Every editor action works by keyboard and with assistive tech (constitution P-06).
- G5: It stays fluid at 200 nodes on the reference machine (P-07).

## Non-goals

- NG1: A text code editor for shaders (the custom function node is P3; see spec 007 open questions).
- NG2: Real-time multi-user collaboration.
- NG3: Vertex/displacement graphs (SGF NG3).
- NG4: Mobile/touch editing of graphs (000 NG4). Viewing on a tablet is not blocked, but it is not tested.
- NG5: Animated preview of time-based effects in export (time is constant in export, REQ-SGF-032).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to pick a look preset and adjust a few sliders | I get a style without touching nodes |
| US-2 | P1 | tech artist | to edit the outline/palette/dither stages as nodes | I can create my own look |
| US-3 | P1 | tech artist | Blender/Unity shortcuts and search | I'm productive immediately |
| US-4 | P1 | tech artist | per-node previews and errors on nodes | I can debug a graph visually |
| US-5 | P1 | pixel artist | to expose my own params to the Look panel | my teammates can tune my look |
| US-6 | P1 | keyboard / screen reader user | to navigate and connect nodes without a mouse | I can use the editor at all |
| US-7 | P2 | tech artist | to share a graph as a file or link | others can reuse my look |

## Requirements

### Graph kinds and opening

**REQ-EDT-001 [P1]** THE SYSTEM SHALL let the user open and edit two graph kinds, the global **material graph** (`target: "material"`) and the **post graph** (`target: "post"`), each in its own editor tab, with the active kind shown in the tab label and the canvas breadcrumb.

- **AC-EDT-001.1** Given the default project, When the user opens Look ▸ "Edit material graph", Then the editor shows `builtin:material-toon` with the breadcrumb "Material ▸ Root", and the node search lists only node types whose `targets` include `material`.
- **AC-EDT-001.2** Given the post graph is open, When the user searches "toon ramp", Then no result is shown and the empty state says "Not available in post graphs".

**REQ-EDT-002 [P2]** WHERE per-slot material overrides are enabled THE SYSTEM SHALL let the user assign a different material graph to an equipment slot, and show which slots use a non-global graph. [NEEDS CLARIFICATION: RenderSettings field, see spec 007 open questions]

- **AC-EDT-002.1** Given the `hair` slot set to graph "Shiny hair", When the preview renders, Then only hair parts use that graph, and the slot list shows a badge "custom material" on `hair`.

**REQ-EDT-003 [P1]** WHEN the user edits a built-in graph (`builtin:*`) THE SYSTEM SHALL first make a project-local copy (copy-on-write in `ProjectDocument.graphs`) and point the render settings at the copy, so built-in graphs are never modified.

- **AC-EDT-003.1** Given `postGraph = "builtin:post-default"`, When the user moves any node, Then `postGraph` becomes a new local ID, the copy contains the move, and loading `builtin:post-default` again yields the shipped document.

### Canvas

**REQ-EDT-004 [P1]** THE SYSTEM SHALL support panning (middle-mouse drag, Space+drag, two-finger trackpad scroll) and zooming (Ctrl/⌘+wheel, pinch, `+`/`-` keys) between 10 % and 400 %, centered on the pointer for pointer zoom and on the viewport center for keys.

- **AC-EDT-004.1** Given zoom 100 %, When the user presses `-` 20 times, Then zoom stops at 10 %, and the zoom level is announced in the status bar.

**REQ-EDT-005 [P1]** THE SYSTEM SHALL draw a background grid (16 px minor, 80 px major at 100 % zoom) and SHALL snap node positions to the 16 px grid while snapping is on (default on, toggle in the toolbar or `Shift+S`, held Alt/Option suspends it).

- **AC-EDT-005.1** Given snap on, When a node is dropped at (37, 70), Then its stored `pos` is (32, 64). Given Alt held, Then `pos` is (37, 70).

**REQ-EDT-006 [P1]** THE SYSTEM SHALL show a toggleable minimap (default on, bottom-right, 200×150 px) that shows nodes by category color and the viewport rectangle, and SHALL pan the canvas when the minimap is clicked or dragged.

- **AC-EDT-006.1** Given a 100-node graph, When the user clicks the minimap's top-left corner, Then the viewport centers on that region within 1 frame (no animation under `prefers-reduced-motion`).

**REQ-EDT-007 [P1]** WHEN the user presses `F` THE SYSTEM SHALL fit the selection in view (with 48 px padding), and fit all nodes WHEN nothing is selected or the user presses `Home`.

- **AC-EDT-007.1** Given 3 selected nodes off-screen, When `F` is pressed, Then all 3 bounding boxes are fully inside the viewport.

### Nodes

**REQ-EDT-008 [P1]** THE SYSTEM SHALL render each node with a header that shows its label and has a background color from its category token (Data & contracts), input sockets on the left and output sockets on the right with labels, and inline widgets for unconnected inputs (slider/number for numbers, checkbox for `bool`, color picker for `color`, select for enum fields).

- **AC-EDT-008.1** Given a `toon.ramp@1` node, When rendered, Then the header uses `--node-cat-toon` and the `steps` input shows an integer field limited to 2–4 (REQ-PIX-011).
- **AC-EDT-008.2** Given an input socket that becomes connected, Then its inline widget is hidden and the value is kept in the model for when the wire is removed.
- **AC-EDT-008.3** Header text vs header background contrast is ≥ 4.5:1 for every category token in light and dark themes (automated token check).

**REQ-EDT-009 [P1]** WHEN the user presses `H` or clicks the header chevron THE SYSTEM SHALL toggle collapse on the selected nodes. A collapsed node shows only the header with one aggregated input dot and one aggregated output dot, and keeps its wires attached to those dots.

- **AC-EDT-009.1** Given a node with 3 connected inputs, When collapsed, Then its height is the header height (28 px at 100 %), all 3 wires end at the aggregated input dot, and `collapsed: true` is stored.

**REQ-EDT-010 [P1]** WHEN the user presses `Shift+H` or clicks the preview icon THE SYSTEM SHALL toggle a 64×64 px preview thumbnail below the node's sockets, showing its first previewable output (REQ-SGF-037).

- **AC-EDT-010.1** Given a `color.ramp@1` node, When the preview is toggled on, Then a 64×64 thumbnail shows the ramp output within 500 ms, and `preview: true` is stored.

**REQ-EDT-011 [P1]** WHEN the user presses `M` THE SYSTEM SHALL toggle mute (bypass) on the selected nodes, show muted nodes at 50 % opacity with a "muted" badge and a pass-through line drawn from the bypassed input to the output, and recompile (REQ-SGF-021).

- **AC-EDT-011.1** Given a selected `post.bayerDither@1`, When `M` is pressed, Then the node shows the badge, the preview loses the dither pattern within 500 ms, and pressing `M` again restores it.

**REQ-EDT-012 [P1]** WHEN the user presses `Ctrl/⌘+H` THE SYSTEM SHALL toggle hiding of unconnected sockets on the selected nodes. Connected sockets always stay visible.

- **AC-EDT-012.1** Given `color.mix@1` with only `a` and `out` connected, When `Ctrl+H` is pressed, Then only `a` and `out` are shown, and `hideUnused: true` is stored.

**REQ-EDT-013 [P1]** IF a document contains a node type that is not registered THEN THE SYSTEM SHALL show it as a "Missing node" placeholder with the type ID, keep its sockets (inferred from its edges and inputs) and wires, and show the `SGF_UNKNOWN_NODE_TYPE` error on it (REQ-SGF-015).

- **AC-EDT-013.1** Given a file with `acme.glow@1`, When opened, Then the placeholder shows "Missing node: acme.glow@1", its 2 wires are drawn, and saving keeps it unchanged.

### Sockets and wires

**REQ-EDT-014 [P1]** THE SYSTEM SHALL draw each socket with the color **and** shape of its type from the type registry, and SHALL give each socket an accessible name "<label>, <type>, input|output, connected|unconnected", so type is not conveyed by color alone (WCAG 1.4.1).

- **AC-EDT-014.1** Given a `float` and a `color` socket, When rendered, Then they differ in shape (circle vs half-filled circle) as well as color, and each socket color has ≥ 3:1 contrast against the canvas background (WCAG 1.4.11).

**REQ-EDT-015 [P1]** WHILE the user drags a wire THE SYSTEM SHALL highlight every compatible target socket (allowed or lossy per the cast table, REQ-SGF-011) and dim incompatible ones to 30 % opacity.

- **AC-EDT-015.1** Given a drag from a `texture` output, When hovering the canvas, Then only `texture` inputs stay highlighted.

**REQ-EDT-016 [P1]** IF the user drops a wire on an incompatible socket or one that would create a cycle THEN THE SYSTEM SHALL not create the edge, shake the socket by 4 px for 200 ms (no motion under `prefers-reduced-motion`; a red outline instead), and show a tooltip for 3 s such as "Can't connect vec3 to float. Use a Split node." or "This link would create a loop."

- **AC-EDT-016.1** Given a drop of `vec3` onto a `float` input, Then no edge is added, the undo history is unchanged, and the tooltip text names both types and suggests `vector.split`.
- **AC-EDT-016.2** Given a link n2→n1 where n1→n2 exists, Then the drop is rejected with the loop message.

**REQ-EDT-017 [P2]** THE SYSTEM SHALL mark wires with an implicit cast: lossy casts with a dashed line and a "⚠ truncates" tooltip, and other casts with a gradient between the two socket colors.

- **AC-EDT-017.1** Given a `vec4 → vec3` wire, When hovered, Then the tooltip says "vec4 → vec3: w is dropped".

**REQ-EDT-018 [P1]** WHEN the user connects a wire to an input that already has one THE SYSTEM SHALL replace the existing wire in one undoable command.

- **AC-EDT-018.1** Given input `a` connected from n1, When a wire from n3 is dropped on `a`, Then `a` is connected only to n3, and one undo restores n1.

**REQ-EDT-019 [P1]** WHEN the user drags from a connected input socket THE SYSTEM SHALL detach the existing wire and carry it, so it can be dropped on another input (re-route), or dropped on empty canvas to delete it.

- **AC-EDT-019.1** Given wire n1.out→n2.a, When the user drags from n2.a and drops on n4.b, Then the edge is n1.out→n4.b in one command.

**REQ-EDT-020 [P1]** WHEN the user Alt/Option-clicks a wire THE SYSTEM SHALL insert a reroute node (`util.reroute@1`) at that point (snapped), splitting the wire in two.

- **AC-EDT-020.1** Given a wire, When Alt-clicked at (200, 100), Then a reroute exists at (208, 96) and both new wires keep the source type.

**REQ-EDT-021 [P1]** THE SYSTEM SHALL delete selected wires with `Delete`/`Backspace` and, at P2, with a cut gesture (Ctrl/⌘+right-drag) that removes every wire it crosses.

- **AC-EDT-021.1** Given a selected wire, When `Delete` is pressed, Then the edge is removed and the inline widget of its input reappears with the last value.
- **AC-EDT-021.2 [P2]** Given a cut stroke across 3 wires, Then all 3 are removed in one undoable command.

### Node search

**REQ-EDT-022 [P1]** WHEN the user presses `Shift+A`, or taps `Space` (press and release within 200 ms without pointer movement) THE SYSTEM SHALL open the node search popup at the pointer (or at the viewport center if the pointer is outside the canvas), with the text field focused.

- **AC-EDT-022.1** Given the canvas is focused, When `Shift+A` is pressed, Then the popup opens within 100 ms with focus in the field. Given `Space` is held for 300 ms and the pointer is dragged, Then the canvas pans and no popup opens.

**REQ-EDT-023 [P1]** THE SYSTEM SHALL rank results by fuzzy match on label, type ID, category and aliases (e.g. "lerp" → Mix, "toon" → Toon Ramp), and SHALL show categories as a browsable tree when the field is empty. Arrow keys move the highlight, `Enter` inserts, `Esc` closes.

- **AC-EDT-023.1** Given the query "lrp", Then "Mix" (`math.mix@1`) is among the first 3 results.
- **AC-EDT-023.2** Given an empty query, Then the categories Input, Math, Vector, Color, Toon/Post, Utility, Output, Groups are listed in that order, and recently used node types (max 5) are listed above them.

**REQ-EDT-024 [P1]** WHEN the user drops a wire on empty canvas THE SYSTEM SHALL open the search popup filtered to node types that have at least one socket compatible with the dragged socket, and SHALL connect the new node's first compatible socket on insert.

- **AC-EDT-024.1** Given a drag from a `color` output dropped on empty space, When the user picks "Posterize", Then a `post.posterize@1` node is created at the drop point with its `color` input connected, in one undoable command.
- **AC-EDT-024.2** Given the filtered popup, Then node types with no compatible socket are absent from the results.

### Frames and groups

**REQ-EDT-025 [P2]** WHEN the user presses `J` with nodes selected THE SYSTEM SHALL wrap them in a frame (label "Frame", editable by double-click, color from 8 preset tokens), stored in `ui.frames`. Moving the frame moves its nodes.

- **AC-EDT-025.1** Given 4 selected nodes, When `J` is pressed and the frame is dragged by (64, 0), Then every member's `pos.x` increases by 64, and the compiled `structureHash` is unchanged.

**REQ-EDT-026 [P1]** WHEN the user presses `Ctrl/⌘+G` with nodes selected THE SYSTEM SHALL create a group from them: wires crossing the selection boundary become interface sockets, and the selection is replaced by one `group.instance@1` node. `Ctrl/⌘+Alt+G` ungroups a selected instance in place.

- **AC-EDT-026.1** Given 3 nodes with 1 incoming and 1 outgoing boundary wire, When grouped, Then the instance has 1 input and 1 output socket with the boundary types, the preview pixels are unchanged, and ungroup restores the original 3 nodes and wires.

**REQ-EDT-027 [P1]** WHEN the user presses `Tab` on a selected group instance THE SYSTEM SHALL enter that group (showing its Group Input/Output nodes and a breadcrumb "Post ▸ Outline"), and `Tab` or `Esc` with nothing selected inside SHALL return to the parent.

- **AC-EDT-027.1** Given the default post graph, When the Outline instance is selected and `Tab` is pressed, Then the canvas shows the group's nodes and the breadcrumb, and `Tab` again returns to the root with the same viewport as before.

**REQ-EDT-028 [P1]** WHILE inside a group THE SYSTEM SHALL let the user add, rename, retype, reorder and remove interface sockets from the Group Input/Output nodes (a "+" socket accepts a dragged wire and creates a matching interface socket), and SHALL update every instance of that group.

- **AC-EDT-028.1** Given 2 instances of a group, When an interface input "Width: float" is added by dragging a wire onto Group Input's "+", Then both instances show a "Width" input.

**REQ-EDT-029 [P1]** THE SYSTEM SHALL show built-in stage groups (REQ-SGF-030) with a "built-in" badge, a "modified" badge after an edit, and a "Reset stage" action that restores the shipped version in one undoable command.

- **AC-EDT-029.1** Given the Palette stage was edited, When "Reset stage" is chosen, Then the group equals the shipped version and the "modified" badge disappears.

### Blackboard and Look panel

**REQ-EDT-030 [P1]** THE SYSTEM SHALL show a Blackboard side panel that lists the graph's params grouped by `group`, and lets the user add (`+` with a type menu), rename, reorder by drag or `Alt+↑/↓`, delete and edit each param's name, type, min, max, step, default, description and "show in Look panel".

- **AC-EDT-030.1** Given the default post graph, When the Blackboard opens, Then it lists at least "Outline width" (`outline.outer.widthPx`), "Outline color" (`outline.color`), "Darken amount" (`outline.darkenAmount`), "Dither strength" (`dither.strength`) and "Alpha cutoff" (`alpha.cutoff`), using the reserved param IDs of spec 007. The palette itself is a `builtin` binding and is chosen in the Render tab and by look presets, not in the Blackboard.

**REQ-EDT-031 [P1]** IF the user enters min > max, a default outside [min, max], an empty or duplicate name, or a name longer than 40 characters THEN THE SYSTEM SHALL keep the previous valid value and show an inline error under the field.

- **AC-EDT-031.1** Given min 0, max 4, When the user types default 7, Then the field shows "Default must be between 0 and 4" and the stored default stays the same.

**REQ-EDT-032 [P1]** WHEN the user drags a param from the Blackboard onto the canvas THE SYSTEM SHALL create a `param.get@1` node bound to it at the drop point. Deleting a param that is still referenced SHALL ask for confirmation and name the number of referencing nodes.

- **AC-EDT-032.1** Given param "Rim width", When dropped onto the canvas, Then a node "Rim width" with one `float` output exists, and its preview reflects the param value.

**REQ-EDT-033 [P1]** WHEN a param value changes in the Blackboard or Look panel THE SYSTEM SHALL update the live preview on the next frame without recompiling (REQ-SGF-022), and store the value in `RenderSettings.params` for user-declared params, or in the typed `RenderSettings` field for reserved param IDs (spec 007, *Reserved built-in param IDs*), never in the graph default.

- **AC-EDT-033.1** Given the outline width slider, When dragged from 1 to 3, Then the preview updates every frame during the drag at ≥ 55 fps and the compile counter does not increase.

**REQ-EDT-034 [P1]** THE SYSTEM SHALL show a simplified **Look** panel for non-experts with the preset picker (REQ-EDT-044) and every param marked "show in Look panel" from the active material and post graphs, as labelled sliders, color pickers or checkboxes with a reset-to-default button each, and no graph UI.

- **AC-EDT-034.1** Given the default project, When the Look panel is open, Then it shows the preset picker and ≤ 10 controls, each with a visible label and an accessible name, and no node canvas is mounted.
- **AC-EDT-034.2** Given a param with "show in Look panel" turned off in the Blackboard, Then the Look panel no longer lists it.

### Previews and errors

**REQ-EDT-035 [P1]** WHILE the graph editor is open THE SYSTEM SHALL keep a live character preview docked in the editor (resizable, default 256×256 CSS px, integer upscaled) that reflects every successful compile and param change.

- **AC-EDT-035.1** Given a structural edit, When it compiles, Then the character preview shows the new result within 500 ms of the last edit (150 ms debounce + ≤ 300 ms compile, REQ-SGF-025).

**REQ-EDT-036 [P1]** THE SYSTEM SHALL render per-node previews only for nodes that have preview on and are in the viewport, at most 4 preview renders per animation frame, and SHALL skip node previews while the canvas is being panned or zoomed.

- **AC-EDT-036.1** Given 40 nodes with preview on, 10 visible, When an upstream value changes, Then only the visible previews re-render and no frame does more than 4 preview renders (instrumented counter).

**REQ-EDT-037 [P1]** WHEN compilation returns errors THE SYSTEM SHALL turn the offending node's header red, show an error badge with the count, outline the offending socket in red, show the message in a tooltip on hover/focus, and list all errors in an Issues panel where activating an entry selects and frames that node (entering groups as needed).

- **AC-EDT-037.1** Given an `SGF_TYPE_MISMATCH` on `n5.color`, Then n5's header is red, socket `color` is outlined, and the Issues panel entry, when activated, selects n5 and frames it.
- **AC-EDT-037.2** Given an error inside group instance g1 (`innerPath: ["n3"]`), Then g1 shows the badge at the root, and activating the issue enters g1 and selects n3.
- **AC-EDT-037.3** Given a failed compile, Then the character preview keeps the last good result and shows a non-blocking banner "Showing last working version, 2 errors" (REQ-SGF-026).

**REQ-EDT-038 [P1]** THE SYSTEM SHALL show compile warnings (e.g. `SGF_TIME_IN_EXPORT`, `SGF_UNUSED_NODE`) as yellow badges on the node and in the Issues panel, without the red error styling.

- **AC-EDT-038.1** Given a graph using `input.time@1`, Then that node shows a warning badge "Time is 0 in exports".

### Editing commands

**REQ-EDT-039 [P1]** THE SYSTEM SHALL perform every graph edit as a model command recorded in the single shared editor history of spec 009 (REQ-UX-022), interleaved with composer, anatomy, render and animation edits. The graph editor SHALL NOT keep a separate undo stack. `Ctrl/⌘+Z` undoes, and `Ctrl/⌘+Shift+Z` or `Ctrl+Y` redoes (bindings `app.undo` / `app.redo` in spec 009). A node drag, a slider drag or a multi-node operation is one entry.

- **AC-EDT-039.1** Given 10 mixed edits (add, connect, move, param change, group, mute), When undone 10 times, Then the document is byte-identical (canonical) to the start, and 10 redos reproduce the end state.
- **AC-EDT-039.2** Given equip hair (composer) → add node (graph), When undo is pressed once with focus in the graph canvas, Then the node is removed and the hair stays; When undo is pressed again, Then the hair is removed (one shared history, AC-UX-022.1).

**REQ-EDT-040 [P1]** WHEN the user copies (`Ctrl/⌘+C`) or cuts (`Ctrl/⌘+X`) THE SYSTEM SHALL write the selection to the system clipboard as JSON text in the clip format (REQ-SGF-036). Paste (`Ctrl/⌘+V`) SHALL insert it at the pointer in this or another browser tab, select the pasted nodes, and drop node types that don't support the current target with a message naming how many were skipped.

- **AC-EDT-040.1** Given 3 nodes copied in tab A, When pasted in tab B's graph of the same target, Then 3 nodes with fresh IDs and their 2 internal wires appear at the pointer.
- **AC-EDT-040.2** Given `toon.ramp@1` copied from a material graph, When pasted into a post graph, Then it is skipped and a toast says "1 node skipped: not available in post graphs".
- **AC-EDT-040.3** Given clipboard text that is not valid clip JSON, When pasted, Then nothing is inserted and no error dialog appears (silent ignore, message in the status bar).

**REQ-EDT-041 [P1]** WHEN the user presses `Ctrl/⌘+D` (alias `Shift+D`) THE SYSTEM SHALL duplicate the selection with internal wires, offset by (32, 32) px, and select the copies.

- **AC-EDT-041.1** Given 2 connected nodes selected, When duplicated, Then 2 new nodes and 1 new wire exist at +32/+32.

**REQ-EDT-042 [P1]** THE SYSTEM SHALL support selecting by click, Shift/Ctrl-click to toggle, rectangle selection (Shift+drag on empty canvas, or left-drag on empty canvas when "drag selects" is on), `A` / `Ctrl/⌘+A` to select all and `Alt+A` to deselect all.

- **AC-EDT-042.1** Given 5 nodes, When a selection box covers 3 of them, Then exactly those 3 are selected.

**REQ-EDT-043 [P2]** THE SYSTEM SHALL align the selected nodes (left, right, top, bottom, center horizontal and vertical) and distribute them evenly (horizontal, vertical) from a toolbar menu and with `Alt+Shift+←/→/↑/↓` for left/right/top/bottom alignment.

- **AC-EDT-043.1** Given 3 nodes at x = 10, 50, 90, When aligned left, Then all have x = 10 (snapped to grid when snapping is on: 0).

### Presets, reset and files

**REQ-EDT-044 [P1]** THE SYSTEM SHALL ship a presets library of looks (each a material graph + post graph + param values): **Classic 16-bit** (default; the M2 look), **GameBoy 4-color** (4-shade green palette `#081820 #346856 #88c070 #e0f8d0`, Bayer 4×4, 1 px dark outline), **NES-like** (the 55-color Lospec "Nintendo Entertainment System" palette, 2-band toon, no dither) and **Hi-bit** (Endesga-32, 4-band toon, rim, inner outlines). Each has a thumbnail and a one-line description. Palette values are in Data & contracts.

- **AC-EDT-044.1** Given the Look panel, When "GameBoy 4-color" is picked, Then every opaque pixel of the 64 px preview is one of its 4 palette colors.
- **AC-EDT-044.2** Each preset has a golden image (64 px, side camera, default character) per backend, and the preset test renders with 0 differing pixels.

**REQ-EDT-045 [P1]** WHEN the user applies a preset over a modified graph, or chooses "Reset to default" THE SYSTEM SHALL ask for confirmation naming the graph that will be replaced, and SHALL perform the replacement as one undoable command.

- **AC-EDT-045.1** Given a modified post graph, When "Reset to default" is confirmed, Then the graph equals `builtin:post-default`, and one undo restores the modified graph.

**REQ-EDT-046 [P1]** THE SYSTEM SHALL export the active graph as `<name>.csgraph.json` (canonical serialization, REQ-SGF-005) and import such a file through a file picker or by dropping it on the canvas, validating and migrating it (REQ-SGF-002, -006) and showing errors in a dialog that names the file and the first 5 issues.

- **AC-EDT-046.1** Given an exported graph, When imported into a fresh project, Then the preview pixels equal the source project's preview.
- **AC-EDT-046.2** Given a file of the wrong target (post file into the material editor), Then the import dialog says "This is a post graph" and offers to open it as the post graph instead.

**REQ-EDT-047 [P2]** THE SYSTEM SHALL offer "Copy share link" for a graph, using the `#g=` URL format and limits of REQ-SGF-035, and opening such a link SHALL show a confirmation "Load shared graph '<name>'?" before replacing anything.

- **AC-EDT-047.1** Given a share link opened in a new tab, When confirmed, Then the graph loads. When cancelled, Then the project is unchanged.

### Keyboard, accessibility and performance

**REQ-EDT-048 [P1]** THE SYSTEM SHALL register every graph editor shortcut in the shell shortcut registry (spec 009, REQ-UX-011) in scope `graph`, using the bindings of spec 009's canonical *Default shortcuts* table, so the help overlay, the user guide and the Keyboard map in this spec list the same keys. A binding change is made in spec 009 first and copied here.

- **AC-EDT-048.1** Given the shortcut registry, When the test compares its `graph`-scoped bindings (plus the `global` `app.undo`/`app.redo` and `app.focusNextRegion`/`app.focusPrevRegion` rows) with the Keyboard map table in this spec, Then every row with a command id is registered with the same keys, rows marked gesture or component-local are listed in the help overlay, and no graph shortcut fires while a text field has focus.

**REQ-EDT-049 [P1]** THE SYSTEM SHALL let the user operate the graph by keyboard alone: arrow keys move focus to the nearest node in that direction, `Ctrl/⌘+arrow` moves the focused/selected nodes by one grid step (16 px), `Enter` enters a node to cycle its sockets and widgets with `Tab`, and `C` on a focused socket opens a "Connect to…" list of compatible sockets in the graph (searchable). `Esc` leaves a node, and `F6` moves focus out of the canvas, so focus is never trapped (WCAG 2.1.2).

- **AC-EDT-049.1** Given only a keyboard, When the user adds "Posterize" via `Shift+A`, connects its input from "Sample Color" via `C`, and connects its output to "Post Output", Then the graph compiles and the preview shows posterization (Playwright, no pointer events).
- **AC-EDT-049.2** Given focus inside a node, When `Esc` then `F6` are pressed, Then focus moves to the next shell panel (no keyboard trap).

**REQ-EDT-050 [P1]** THE SYSTEM SHALL announce through a polite ARIA live region: node added/deleted (with label), connection made/rejected (with both socket names and the reason), compile result ("Compiled" / "2 errors"), group entered/exited, and undo/redo (with the command name).

- **AC-EDT-050.1** Given a screen reader test harness, When a connection is rejected, Then the live region text is "Not connected: vec3 Normal cannot connect to float Factor".

**REQ-EDT-051 [P1]** THE SYSTEM SHALL provide a "List view" of the current graph level as an accessible tree/table (node label, category, inputs with their sources, outputs with their targets, errors), synchronized with the canvas selection (constitution P-06).

- **AC-EDT-051.1** Given the default post graph, When List view is opened, Then axe-core reports 0 violations, and selecting a row selects the node on the canvas.

**REQ-EDT-052 [P1]** THE SYSTEM SHALL keep all focus indicators visible (≥ 2 px, ≥ 3:1 contrast) on nodes, sockets, wires and panels, and SHALL disable non-essential motion (minimap pan animation, rejection shake, frame-to-selection animation) under `prefers-reduced-motion: reduce`.

- **AC-EDT-052.1** Given reduced motion, When `F` is pressed, Then the viewport jumps without interpolation.

**REQ-EDT-053 [P1]** WHILE a graph of 200 nodes and 300 wires is open THE SYSTEM SHALL keep panning, zooming and dragging a node at p95 frame time ≤ 16.7 ms on the reference machine with the character preview running, and opening the graph SHALL take ≤ 1 s.

- **AC-EDT-053.1** Given `fixtures/graph-200.csgraph.json`, When a scripted 5 s pan/zoom/drag runs in Chromium with 4× CPU throttling, Then p95 frame time ≤ 16.7 ms and no long task exceeds 50 ms.
- **AC-EDT-053.2** Given the same fixture, When opened, Then the canvas is interactive within 1 s.

**REQ-EDT-054 [P2]** IF a graph exceeds 500 nodes at one level THEN THE SYSTEM SHALL show a non-blocking hint suggesting groups, and SHALL turn off per-node previews by default for that level.

- **AC-EDT-054.1** Given a 600-node graph, When opened, Then the hint appears once and no node previews render until the user turns them back on.

**REQ-EDT-055 [P2]** WHEN the user presses `Ctrl/⌘+F` in the canvas THE SYSTEM SHALL open a find box that matches node labels, types and param names across the current graph and its groups, and frames each match in turn with `Enter`/`Shift+Enter`.

- **AC-EDT-055.1** Given "dither", Then matches include the Dither stage instance and the `post.bayerDither@1` inside it (entering the group to frame it).

**REQ-EDT-056 [P2]** THE SYSTEM SHALL open a context menu on right-click or `Shift+F10`/Menu key on a node, wire, socket or empty canvas that lists the actions available there, each showing its shortcut.

- **AC-EDT-056.1** Given right-click on a node, Then the menu contains Collapse (H), Preview (Shift+H), Mute (M), Duplicate (Ctrl+D), Group (Ctrl+G) and Delete (Del).

## Keyboard map

`Ctrl` means `⌘` on macOS. Scope: graph canvas focused, not in a text field. This table is a copy of the `graph` rows of spec 009 *Default shortcuts* (canonical, REQ-UX-011); the command id column names the registry entry. Single keys follow REQ-UX-016 (focus-scoped, can be turned off).

| Action | Keys | REQ | Command id (spec 009) |
|--------|------|-----|------|
| Add node (search) | `Shift+A`, tap `Space` | 022 | `graph.search` |
| Pan | Space+drag, middle-drag | 004 | gesture (help overlay) |
| Zoom in / out | `Ctrl+wheel`, `+` / `-` | 004 | `graph.zoomIn` / `graph.zoomOut` (wheel is a gesture) |
| Frame selected / all | `F` / `Home` | 007 | `graph.frameSelection` / `graph.frameAll` |
| Collapse | `H` | 009 | `graph.collapse` |
| Toggle node preview | `Shift+H` | 010 | `graph.togglePreview` |
| Mute / bypass | `M` | 011 | `graph.mute` |
| Hide unused sockets | `Ctrl+H` | 012 | `graph.hideUnused` |
| Insert reroute | `Alt+click` wire | 020 | gesture (help overlay) |
| Cut wires (P2) | `Ctrl+right-drag` | 021 | gesture (help overlay) |
| Delete | `Delete`, `Backspace` | 021 | `graph.delete` |
| Frame (box) selection (P2) | `J` | 025 | `graph.frameBox` |
| Group / ungroup | `Ctrl+G` / `Ctrl+Alt+G` | 026 | `graph.group` / `graph.ungroup` |
| Enter / exit group | `Tab` / `Tab`, `Esc` | 027 | `graph.toggleSubgraph` / `graph.exitSubgraph` |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y` | 039 | `app.undo` / `app.redo` (global) |
| Copy / cut / paste | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | 040 | `graph.copy` / `graph.cut` / `graph.paste` |
| Duplicate | `Ctrl+D`, `Shift+D` | 041 | `graph.duplicate` |
| Select all / none | `A`, `Ctrl+A` / `Alt+A` | 042 | `graph.selectAll` / `graph.deselectAll` |
| Align left/right/top/bottom (P2) | `Alt+Shift+←/→/↑/↓` | 043 | `graph.alignLeft` / `alignRight` / `alignTop` / `alignBottom` |
| Move focus between nodes | `←` `→` `↑` `↓` | 049 | component-local (spec 009, after the table) |
| Nudge selection one grid step | `Ctrl+←/→/↑/↓` | 049 | `graph.nudge` |
| Enter node / next socket | `Enter` / `Tab` | 049 | component-local (spec 009, after the table) |
| Leave node | `Esc` | 049 | component-local (spec 009, after the table) |
| Connect focused socket | `C` | 049 | `graph.connect` |
| Find in graph (P2) | `Ctrl+F` | 055 | `graph.find` |
| Context menu (P2) | `Shift+F10`, Menu key | 056 | `graph.contextMenu` |
| Toggle snapping | `Shift+S` | 005 | `graph.toggleSnap` |
| Move focus to next / previous panel (leave canvas) | `F6` / `Shift+F6` | 049 | `app.focusNextRegion` / `app.focusPrevRegion` (global) |

## Node catalog (v1)

Socket notation: `id: type [= default]`. All IDs are stable (REQ-SGF-004). `gen` = `genType`. Targets: **M** material, **P** post. All nodes are version `@1` and P1 unless marked otherwise.

### Input

| Type | T | Inputs | Outputs | Notes |
|------|---|--------|---------|-------|
| `input.uv` | M P | – | `uv: vec2` | Mesh UV (M) / screen UV (P) |
| `input.normal` | M | – | `normal: vec3` | World-space, normalized |
| `input.viewDir` | M | – | `dir: vec3` | Surface → camera, world |
| `input.lightDir` | M | – | `dir: vec3` | Surface → key light (`light.dir`) |
| `input.partId` | M | – | `id: int` | Equipped part index |
| `input.time` | M P | – | `t: float` | Seconds in preview, **0 in export** (REQ-SGF-032), warning badge |
| `input.screenPos` | M P | – | `px: vec2`, `uv: vec2` | Low-res pixel coordinates (pixel centers) and 0..1 |
| `input.texelSize` | M P | – | `texel: vec2`, `resolution: vec2` | `1/resolution` and resolution in px |
| `input.tint` | M | field `slot` (enum of tint slots) | `color: color` | `tint.<slot>` uniform |
| `input.partAlbedo` | M | – | `color: color`, `alpha: float` | Part base texture × vertex color |
| `input.float` / `input.vec2` / `input.vec3` / `input.color` | M P | `value` | `out` | Constants (inline uniforms) |
| `param.get` | M P | field `param` | `value: <param type>` | Created by dragging from the Blackboard |

### Math (`gen` resolves per REQ-SGF-013)

| Type | Inputs | Outputs |
|------|--------|---------|
| `math.add`, `math.subtract`, `math.multiply`, `math.divide`, `math.min`, `math.max`, `math.power` | `a: gen = 0`, `b: gen = 0` (`multiply`/`divide`/`power` b = 1) | `out: gen` |
| `math.abs`, `math.floor`, `math.ceil`, `math.round`, `math.fract`, `math.sin`, `math.cos`, `math.oneMinus`, `math.saturate` | `x: gen` | `out: gen` |
| `math.clamp` | `x: gen`, `min: gen = 0`, `max: gen = 1` | `out: gen` |
| `math.mix` | `a: gen`, `b: gen = 1`, `t: float = 0.5` | `out: gen` |
| `math.step` | `edge: gen = 0.5`, `x: gen` | `out: gen` |
| `math.smoothstep` | `e0: gen = 0`, `e1: gen = 1`, `x: gen` | `out: gen` |
| `math.remap` | `x: gen`, `inMin`, `inMax = 1`, `outMin`, `outMax = 1` (gen) | `out: gen` |
| `math.compare` | `a: float`, `b: float`, field `op` (<, ≤, =, ≥, >) | `out: bool` |
| `math.select` | `cond: bool`, `a: gen`, `b: gen` | `out: gen` |

### Vector

| Type | Inputs | Outputs |
|------|--------|---------|
| `vector.split` | `v: vec4` | `x`, `y`, `z`, `w: float` |
| `vector.combine` | `x`, `y`, `z`, `w: float = 0` | `vec2: vec2`, `vec3: vec3`, `vec4: vec4` |
| `vector.dot` | `a: vec3`, `b: vec3` | `out: float` |
| `vector.cross` | `a: vec3`, `b: vec3` | `out: vec3` |
| `vector.normalize` | `v: gen` | `out: gen` |
| `vector.length` | `v: gen` | `out: float` |
| `vector.distance` | `a: gen`, `b: gen` | `out: float` |
| `vector.reflect` | `i: vec3`, `n: vec3` | `out: vec3` |

### Color

| Type | Inputs | Outputs |
|------|--------|---------|
| `color.mix` | `a: color`, `b: color`, `t: float = 0.5`, field `mode` (mix, multiply, screen, overlay, add) | `out: color` |
| `color.hsv` | `color: color`, `hue: float = 0` (−0.5..0.5 shift), `sat: float = 1`, `val: float = 1` | `out: color` |
| `color.ramp` | `t: float`, field `stops` (2–16 color stops), field `interp` (constant, linear) | `color: color`, `alpha: float` |
| `color.luminance` | `color: color` | `out: float` (Rec. 709) |
| `color.linearToSrgb` / `color.srgbToLinear` | `color: color` | `out: color` (alpha unchanged) |

### Toon (material)

| Type | Inputs | Outputs | Notes |
|------|--------|---------|-------|
| `toon.ramp` | `normal: vec3 ← normal`, `lightDir: vec3 ← light.dir`, `base: color ← tint×albedo`, `steps: int = 3` (2–4), `t1`, `t2`, `t3: float` (ascending thresholds in (0, 1); default `k / steps`), `ambient: float = 0` (0..1) | `color: color`, `light: float` (banded Lambert, 0..1) | Band rule of REQ-PIX-011 |
| `toon.rim` | `normal: vec3 ← normal`, `viewDir: vec3 ← viewDir`, `lightDir: vec3 ← light.dir`, `width: float = 0.2` (0..1), `strength: float = 0.5` (0..1) | `rim: float` (0 or `strength`) | Formula of REQ-PIX-012, lit side only |
| `toon.specularSteps` **[P2]** | `normal`, `viewDir`, `lightDir: vec3` (built-in defaults), `shininess: float = 32`, `steps: int = 1` (1–4), `color: color = #ffffff` | `spec: float`, `color: color` | Not part of the default look |

### Post

| Type | Inputs | Outputs |
|------|--------|---------|
| `post.sampleColor` | `offset: vec2 = 0,0` (texels) | `color: color` |
| `post.sampleNormal` | `offset: vec2` | `normal: vec3` |
| `post.sampleDepth` | `offset: vec2` | `depth: float` (linear 0..1) |
| `post.sampleId` | `offset: vec2` | `id: int`, `isBackground: bool` |
| `post.edgeDetect` | `alpha: float` (coverage source), `cutoff: float ← render.alphaCutoff`, field `sources` (depth, normal, id; multi), `depthThresholdPx: float = 1`, `normalThresholdDeg: float = 45`, `width: int = 1` (1–3, outer) | `outer: float`, `inner: float` (REQ-PIX-015, -016) |
| `post.outline` | `color: color`, `outer: float`, `inner: float`, field `mode` (black, darken, custom), `darkenAmount: float = 0.5`, `customColor: color = #000000` | `color: color` (REQ-PIX-017) |
| `post.paletteQuantize` | `color: color` (sRGB), `lut: texture ← render.paletteLut` (64³ LUT, REQ-PIX-021) | `color: color` |
| `post.bayerDither` | `color: color` (sRGB), `px: vec2 ← cell-local pixel coords`, field `matrix` (2, 4, 8; default ← `render.ditherMode`), `strength: float ← render.ditherStrength`, `spread: float = 0.25` (`DITHER_SPREAD`) | `color: color` (offset applied, REQ-PIX-022), `threshold: float` |
| `post.posterize` | `color: color`, `levels: int = 8` (2–256) | `color: color` |
| `post.alphaCutoff` | `color: color`, `cutoff: float ← render.alphaCutoff` | `color: color` (alpha ∈ {0, 1}) |

### Utility, groups and output

| Type | T | Inputs | Outputs | Notes |
|------|---|--------|---------|-------|
| `util.reroute` | M P | `in: any` | `out: any` | Type follows its source (spec 007) |
| `util.customFunction` **[P3]** | M P | declared per instance | declared per instance | Hand-written built-in functions only until the spec 007 question is resolved |
| `group.instance` | M P | interface inputs | interface outputs | `group` field |
| `group.input` / `group.output` | M P | – / interface | interface / – | Only inside groups |
| `output.material` | M | `color: color ← tint×albedo`, `alpha: float = 1` | – | Exactly one per material graph. Normal and part ID for MRT are written by the engine. |
| `output.post` | P | `color: color ← scene.color` | – | Exactly one per post graph |

The default post graph chains its stages in the fixed order of REQ-PIX-025: alpha cutoff → outline → `color.linearToSrgb` → dither → palette quantize → final alpha.

`←` means the socket uses that built-in (`NodeTypeSpec.inputs[].defaultBuiltin`) while unconnected.

## Edge cases

- Space conflicts with pan → tap vs hold (REQ-EDT-022, AC-EDT-022.1). Space in the `graph` scope never toggles animation playback (AC-UX-012.1).
- Paste across targets → incompatible nodes are skipped (AC-EDT-040.2). Invalid clipboard → ignored (AC-EDT-040.3).
- Paste whose IDs collide → re-IDed (AC-SGF-036.2).
- Connecting that would create a loop → rejected (AC-EDT-016.2). Cycles in imported files → `SGF_CYCLE` shown on the nodes (REQ-EDT-037).
- Unknown/plugin node → placeholder (REQ-EDT-013).
- Editing a built-in → copy-on-write (REQ-EDT-003).
- Deleting a referenced param → confirmation (REQ-EDT-032).
- Compile failure → last good preview kept (AC-EDT-037.3).
- Very large graphs → previews off, hint (REQ-EDT-054). Performance (REQ-EDT-053).
- Group edited while 2 instances exist → all instances updated (AC-EDT-028.1).
- Undo across a recompile → the restored structure recompiles after debounce. Param undo needs no recompile (REQ-EDT-039, REQ-SGF-022).
- WebGL2 fallback → previews and presets have per-backend goldens (AC-EDT-044.2). A WebGPU-only node shows an error on WebGL2 (spec 007 edge cases).
- Two tabs editing the same project → spec 009 REQ-UX-029: the second tab opens read-only with a "Take over editing" banner, so graph edits never race. Copy/paste between tabs (AC-EDT-040.1) still works because it goes through the system clipboard.
- Time node in export → constant 0 plus a warning (REQ-EDT-038).

## Data & contracts

The graph document, clip format, node type contract and errors are defined in spec 007. Editor-specific contracts:

```ts
/** Design tokens consumed by the view; values live in apps/web/src/shared/theme. */
export const NODE_CATEGORY_TOKENS = {
  input: '--node-cat-input',      // red-ish, Blender "Input"
  math: '--node-cat-math',        // blue, "Converter"
  vector: '--node-cat-vector',    // purple
  color: '--node-cat-color',      // yellow
  toon: '--node-cat-toon',        // green, "Shader"
  post: '--node-cat-post',        // teal
  utility: '--node-cat-utility',  // gray
  group: '--node-cat-group',      // dark green
  output: '--node-cat-output',    // dark red
} as const;

/** Socket visuals come from the @csg/shader-graph type registry. */
export interface SocketVisual {
  type: SocketType;
  colorToken: string;   // e.g. '--socket-float'
  shape: 'circle' | 'diamond' | 'square' | 'circle-dot' | 'circle-half' | 'square-outline';
}
// Proposed: float circle #A1A1A1, int diamond #598C5C, bool square #CCA6D6,
// vec2/vec3/vec4 circle-dot #8C8CE6/#6363C7/#4A4AA8, color circle-half #C7C729,
// texture square-outline #E68A4D. Final values must pass AC-EDT-014.1 in both themes.

/** A look preset bundles graphs and param values. Built-ins live in assets/presets/. */
export interface LookPreset {
  format: 'sprite-look-preset';
  version: 1;
  id: string;                         // 'classic-16bit' | 'gameboy-4' | 'nes-like' | 'hi-bit' | user id
  name: string;
  description: string;
  thumbnail: string;                  // relative path to a 64×64 PNG
  materialGraph: ShaderGraphDocument | `builtin:${string}`;
  postGraph: ShaderGraphDocument | `builtin:${string}`;
  params: Record<string, number | boolean | HexColor | [number, number, number]>;
  /** Same shape and ids as RenderSettings.palette (spec 003). GameBoy and NES presets use id 'custom' with colors. */
  palette?: { id: 'none' | 'pico-8' | 'endesga-32' | 'custom'; colors?: HexColor[] };
}

/** Editor commands (model side, @csg/shader-graph/commands). Each is one undo entry. */
export type GraphCommand =
  | { kind: 'addNode'; node: GraphNode }
  | { kind: 'removeNodes'; ids: string[] }
  | { kind: 'moveNodes'; moves: Array<{ id: string; pos: [number, number] }> }
  | { kind: 'connect'; edge: GraphEdge; replaces?: GraphEdge }
  | { kind: 'disconnect'; edges: GraphEdge[] }
  | { kind: 'setInput'; nodeId: string; socketId: string; value: unknown }
  | { kind: 'setNodeFlags'; ids: string[]; flags: Partial<Pick<GraphNode, 'collapsed' | 'muted' | 'preview' | 'hideUnused'>> }
  | { kind: 'insertReroute'; edge: GraphEdge; pos: [number, number] }
  | { kind: 'group'; ids: string[]; groupKey: string }
  | { kind: 'ungroup'; instanceId: string }
  | { kind: 'editGroupInterface'; groupKey: string; interface: GraphGroup['interface'] }
  | { kind: 'resetGroup'; groupKey: string }
  | { kind: 'paste'; clip: ShaderGraphClip; at: [number, number] }
  | { kind: 'upsertParam'; param: GraphParam }
  | { kind: 'removeParam'; id: string }
  | { kind: 'setFrames'; frames: GraphFrame[] }
  | { kind: 'replaceDocument'; doc: ShaderGraphDocument; reason: 'preset' | 'reset' | 'import' };
```

**Preset palettes** (lowercase hex, source order; verified 2026-10-08 against the Lospec `.hex` downloads):

- `gameboy-4` → `custom`, Lospec `nintendo-gameboy-bgb` (4): `#081820 #346856 #88c070 #e0f8d0`.
- `nes-like` → `custom`, Lospec `nintendo-entertainment-system` (55): `#000000 #fcfcfc #f8f8f8 #bcbcbc #7c7c7c #a4e4fc #3cbcfc #0078f8 #0000fc #b8b8f8 #6888fc #0058f8 #0000bc #d8b8f8 #9878f8 #6844fc #4428bc #f8b8f8 #f878f8 #d800cc #940084 #f8a4c0 #f85898 #e40058 #a80020 #f0d0b0 #f87858 #f83800 #a81000 #fce0a8 #fca044 #e45c10 #881400 #f8d878 #f8b800 #ac7c00 #503000 #d8f878 #b8f818 #00b800 #007800 #b8f8b8 #58d854 #00a800 #006800 #b8f8d8 #58f898 #00a844 #005800 #00fcfc #00e8d8 #008888 #004058 #f8d8f8 #787878`.
- `hi-bit` → `endesga-32`; `classic-16bit` → `none` (spec 003 defaults).

## Non-functional

- NFR-1 Performance: REQ-EDT-053 (200 nodes, p95 ≤ 16.7 ms), REQ-EDT-036 (≤ 4 previews per frame), search popup opens ≤ 100 ms, param change applies next frame (P-07). Graph editor code is lazy-loaded and not part of the initial 400 KB budget (REQ-GEN-007).
- NFR-2 Accessibility: WCAG 2.2 AA (P-06). Keyboard-only flow (AC-EDT-049.1), list view (REQ-EDT-051), live announcements (REQ-EDT-050), shape+color sockets (REQ-EDT-014), reduced motion (REQ-EDT-052). axe-core runs on the editor, list view, Blackboard and Look panel with 0 violations.
- NFR-3 Privacy: graphs stay local. Share links carry the data in the fragment only (P-03, REQ-SGF-035).
- NFR-4 Determinism: presets and default graphs have per-backend goldens (P-04, AC-EDT-044.2, AC-SGF-033.1).
- NFR-5 Architecture: React Flow state is a projection of the model. A mapping test asserts model → view → command → model round trips for every command kind (ADR-0004).

## Open questions

- [NEEDS CLARIFICATION: Per-slot material graph overrides need a RenderSettings field (spec 007 open questions). Blocks REQ-EDT-002 (P2) only.]
- ~~Exact palettes for presets.~~ Resolved 2026-10-08: GameBoy = Lospec `nintendo-gameboy-bgb` (4 colors), NES = Lospec `nintendo-entertainment-system` (55 colors), values in Data & contracts, verified against the Lospec `.hex` downloads.
- [NEEDS CLARIFICATION: Palette licensing for `ASSETS_LICENSE.md` (P-02). The Lospec pages for both preset palettes state no license and name no author (the GameBoy list is the bgb emulator's default palette). Same proposal as spec 003 open questions: record source URL and "color list, no license stated". Owner: maintainers. Does not block AC-EDT-044.1/.2.]
- ~~Should the `A` key select all?~~ Resolved 2026-10-08: yes, `A` (single key, REQ-UX-016) and `Ctrl+A` select all, `Alt+A` deselects, as in Blender; registered in spec 009 (`graph.selectAll`, `graph.deselectAll`).
- ~~Multi-tab editing of the same project.~~ Resolved by spec 009 REQ-UX-029 (read-only second tab with take-over).
- [NEEDS CLARIFICATION: Should user-saved look presets (P2) live in IndexedDB beside projects, and be exportable as `.csglook.json`? Owner: spec 009 author.]

## References

- spec 007 (SGF), spec 003 (PIX), spec 009 (UX), docs/architecture.md §3.5–3.6, ADR-0003, ADR-0004.
- `.tagconn/work/research.md` §Shader graph editor (2026-10-08).
- React Flow v12 docs (`isValidConnection`, `onConnectEnd`, MiniMap): https://reactflow.dev/api-reference (accessed 2026-10-08).
- Blender Manual, Node Editor (shortcuts, frames, reroute, mute, hide sockets): https://docs.blender.org/manual/en/latest/interface/controls/nodes/index.html (accessed 2026-10-08).
- Unity Shader Graph manual (Blackboard, Create Node menu, node previews): https://docs.unity3d.com/Packages/com.unity.shadergraph@17.0/manual/index.html (accessed 2026-10-08).
- Lospec palettes (accessed and verified 2026-10-08; no license stated on the pages): GameBoy https://lospec.com/palette-list/nintendo-gameboy-bgb (data: https://lospec.com/palette-list/nintendo-gameboy-bgb.hex), NES https://lospec.com/palette-list/nintendo-entertainment-system (data: https://lospec.com/palette-list/nintendo-entertainment-system.hex), Endesga-32 (see spec 003).
- WCAG 2.2 (1.4.1 Use of Color, 1.4.11 Non-text Contrast, 2.1.1 Keyboard, 2.4.7/2.4.11 Focus): https://www.w3.org/TR/WCAG22/ (accessed 2026-10-08).
- React Flow accessibility guide: https://reactflow.dev/learn/advanced-use/accessibility (accessed 2026-10-08).
