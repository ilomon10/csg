---
id: UX
title: Editor shell UX
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 003-pixel-render-pipeline, 004-animation, 005-export, 006-shader-graph-editor, 008-custom-model-upload, 011-asset-pipeline]
last_updated: 2026-10-09
---

# 009 – Editor shell UX

## Context

The editor (`apps/web`) hosts every feature: composer (001), anatomy (002), render settings (003),
animation (004), export (005), shader graph (006) and upload (008). This spec owns what is shared
between them: layout, responsive behavior, onboarding, the **central keyboard shortcut registry**,
the command palette, the undo/redo history, local project save and autosave, notifications,
theming, accessibility, i18n readiness, the renderer status indicator, and crash recovery.
Feature specs define *what* a command does; this spec defines *how* it is reached and how the shell
behaves around it. Architecture: `apps/web/src/app/` (shell) and `apps/web/src/shared/` (UI
primitives); features never import each other (architecture §4.8, editor-ux-engineer rules).

M3 scope decision (user, 2026-10-09): the editor has two **workspaces**, *Easy* (a character creator in
the style of a life-sim game, tiles and swatches, no sliders) and *Pro* (the multi-panel layout of
REQ-UX-001 to REQ-UX-006). Both are views of one project document. Before the editor, a **home
screen** shows saved characters and presets as a lineup, and a **new-character wizard** builds a
character in eight steps. Home, wizard and editor are in-app views addressed by the URL fragment
(REQ-UX-048 still holds). Since 2026-10-09 the Easy workspace, the home screen and the wizard are
specified in [spec 014](./014-easy-home-wizard.md) (REQ-UX-051 to REQ-UX-103, same UX prefix);
this spec keeps the shell that all views share.

## Goals

- G1: One predictable layout where every feature has a home and the preview is always visible.
- G2: Every action reachable by keyboard, palette and pointer; shortcuts defined once and documented from the same source.
- G3: Never lose work: autosave, crash recovery, clear save status.
- G4: WCAG 2.2 AA (constitution P-06) and readiness for translation.
- G5: ~~A beginner makes a good-looking character without touching a slider, and can move to Pro at any time without losing anything (added 2026-10-09).~~ Moved to spec 014 G1 (2026-10-09 split).

## Non-goals

- NG1: Editing on phones (mobile is view-only, P3; overview NG4).
- NG2: Multi-user collaboration, cloud sync or accounts (P-03).
- NG3: Fully dockable/floating window management (fixed regions with resize/collapse only).
- NG4: Shipping translations other than English in v1 (only readiness).
- NG5, NG6: moved to spec 014 NG1 and NG2 (2026-10-09 split).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | indie game dev | to open the editor and see a sample character I can change at once | I understand the tool in under a minute |
| US-2 | P1 | any user | my work saved automatically and restored after a crash | I never lose a character |
| US-3 | P1 | keyboard / screen-reader user | to do everything without a mouse | the tool is usable for me |
| US-4 | P1 | tech artist | Blender/Unity-like shortcuts in the graph and a command palette | I work fast |
| US-5 | P2 | pixel artist | light theme and panel sizes that stick | the editor fits my setup |
| US-6 | P3 | anyone on a phone | to open a shared character and watch it animate | I can preview links on the go |

US-7 to US-10 (Easy, home, wizard, workspace switch) moved to spec 014 as US-1 to US-4.

## Layout

Views (spec 014 REQ-UX-069): home screen (`#home`), wizard (`#new`), and the editor (`#p=<id>`) in
the Easy or Pro workspace. The Easy, home and wizard layouts are in spec 014.

**Pro workspace** (REQ-UX-001 to REQ-UX-006):

```
┌───────────────────────── Top bar (48 px) ─────────────────────────────────────────┐
│ Logo · Project name · Save status · Undo/Redo · ⌘K · Renderer badge · Help · ⚙ · Export │
├──────────────┬───────────────────────────────────────────┬────────────────────────┤
│ Part library │ Viewport  [3D | Pixel]  dir ◀▶  zoom  frame │ Inspector tabs:        │
│ (280 px)     │                                           │ Parts · Colors ·       │
│ search, slot │                                           │ Anatomy · Render ·     │
│ filter, grid,│                                           │ Animation  (320 px)    │
│ Upload       │                                           │                        │
├──────────────┴───────────── Bottom dock (240 px) ──────────┴────────────────────────┤
│ [Timeline | Material graph | Post graph]                                             │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

The Pro top bar also holds the workspace toggle `[Easy | Pro]` and a Home button (spec 014
REQ-UX-053).

## Requirements

### Layout and panels

REQ-UX-001 to REQ-UX-008 describe the **Pro workspace** (spec 014 REQ-UX-051). They are unchanged in
substance; the Easy workspace layout is spec 014 REQ-UX-056 to REQ-UX-068. *(Note added 2026-10-09
(M3 workspaces); spec reference updated 2026-10-09 after the split.)*

**REQ-UX-001 [P1]** THE SYSTEM SHALL lay out the editor as a top bar (48 px), a left part library (default 280 px), a center viewport, a right inspector (default 320 px) and a bottom dock (default 240 px), each region being an ARIA landmark with a name (`banner`, "Part library", "Viewport", "Inspector", "Dock").

- **AC-UX-001.1** Given a 1440×900 window and default panel sizes (no stored layout prefs), When a project opens in the Pro workspace, Then *(amended 2026-10-09: was "on first run, When the editor loads"; first run now shows the home screen and Easy)* the regions have the default sizes ± 1 px and the viewport is at least 760×560 px.
- **AC-UX-001.2** Given a screen reader landmark list, When read, Then the five named regions are listed.

**REQ-UX-002 [P1]** THE SYSTEM SHALL let the user resize the library (200–480 px), inspector (280–560 px) and dock (120 px to 60 % of window height) with splitters that work by pointer and by keyboard (`role="separator"`, focusable, arrows ±16 px, Home/End to min/max), collapse/expand each side region and the dock, and persist sizes and collapsed state across reloads.

- **AC-UX-002.1** Given focus on the library splitter, When the user presses → 3 times, Then the library is 328 px and `aria-valuenow` is 328.
- **AC-UX-002.2** Given a collapsed inspector and a resized dock, When the page reloads, Then both states are restored.

**REQ-UX-003 [P1]** THE SYSTEM SHALL show a viewport toolbar with a 3D/Pixel segmented toggle (shortcut V), direction previous/next (`[` / `]`), integer zoom in Pixel mode (1×–16×, `+` / `-`, never fractional), "Frame character" (F) and a background toggle (checker / solid / transparent), where Pixel mode shows the low-res pipeline output upscaled with `image-rendering: pixelated` (P-05) and 3D mode shows an orbitable full-resolution view.

- **AC-UX-003.1** Given Pixel mode at 64 px output and zoom 6×, When the canvas is inspected, Then its backing store is 64×64 per frame and its CSS size is 384×384 px.
- **AC-UX-003.2** Given focus in the viewport, When the user presses V, Then the mode toggles and the toggle button's `aria-pressed` updates.

**REQ-UX-004 [P1]** THE SYSTEM SHALL provide the inspector as tabs Parts, Colors, Anatomy, Render and Animation (ARIA tabs pattern: arrow keys move between tabs, Tab moves into the panel), remembering the last active tab across reloads.

- **AC-UX-004.1** Given focus on the Parts tab, When the user presses → twice and Enter/Space (or automatic activation), Then the Anatomy panel is shown and announced.

**REQ-UX-005 [P1]** THE SYSTEM SHALL let the bottom dock switch between Timeline, Material graph and Post graph (spec 006), maximize the dock to the full area below the top bar and restore it (Ctrl+Shift+M), and keep the viewport preview visible (min 240×240 px) whenever the dock is not maximized.

- **AC-UX-005.1** Given the dock on Timeline, When the user presses Ctrl+Shift+G, Then the Material graph tab is active and focused.
- **AC-UX-005.2** Given the dock maximized, When Escape is pressed with focus on the dock tab list, Then the dock restores its previous height.

**REQ-UX-006 [P1]** THE SYSTEM SHALL adapt the layout at these widths: ≥ 1280 px all regions docked; 1024–1279 px the library becomes an overlay drawer (toggle button in top bar); 768–1023 px (tablet) both library and inspector become drawers, the dock defaults to collapsed, and touch targets are ≥ 44×44 px; < 768 px the view-only mode of REQ-UX-008 applies. No horizontal page scroll at any width ≥ 320 px.

- **AC-UX-006.1** Given a 1100×800 window, When the editor loads, Then the library is hidden behind a drawer toggle and the inspector is docked.
- **AC-UX-006.2** Given an 834×1112 touch viewport (tablet), When a part is equipped via the drawer, Then it succeeds with touch only and every interactive target is ≥ 44×44 px.

**REQ-UX-007 [P2]** WHILE the viewport is touch-driven THE SYSTEM SHALL support one-finger orbit (3D), two-finger pan and pinch zoom (snapped to integer zoom in Pixel mode).

- **AC-UX-007.1** Given Pixel mode on a tablet, When the user pinches from 4× outward, Then zoom snaps to 5×, 6× … and never shows a fractional scale.

**REQ-UX-008 [P3]** WHILE the window is narrower than 768 px THE SYSTEM SHALL show a view-only layout: the viewport, play/pause, clip and direction pickers, Pixel/3D toggle, open shared link/project, and the message "Editing works best on a larger screen" — no editing panels.

- **AC-UX-008.1** Given a 390×844 viewport and a share link, When opened, Then the character renders and animates, and no inspector or library controls are present.

### Onboarding

**~~REQ-UX-009~~ [P1]** ~~WHEN the editor opens with no saved projects (or the user chooses File › New) THE SYSTEM SHALL show a Welcome dialog offering "Start from a sample" (≥ 6 sample characters using only built-in assets, covering side-view and top-down/isometric presets), "Blank character" and "Open project…", with "Don't show this on startup" for returning users.~~ (deprecated 2026-10-09: replaced by the home screen REQ-UX-069 to REQ-UX-088 and the wizard REQ-UX-089 to REQ-UX-100; the sample idea lives on in REQ-UX-072, "Don't show on startup" in REQ-UX-087)

- **~~AC-UX-009.1~~** ~~Given a fresh profile, When the editor loads, Then the Welcome dialog shows ≥ 6 sample thumbnails, and choosing one renders that character within 5 s on the reference machine (P-07).~~ (deprecated 2026-10-09: replaced by AC-UX-072.1 and AC-UX-078.2)
- **~~AC-UX-009.2~~** ~~Given the default first run with no interaction, When 5 s pass after load, Then a default character is already rendered behind the dialog (the user never sees an empty viewport).~~ (deprecated 2026-10-09: intent kept by AC-UX-081.1 and AC-UX-097.1)

**REQ-UX-010 [P2]** WHEN a sample or blank character is opened for the first time in a profile THE SYSTEM SHALL offer a skippable 6-step tour (library → viewport → inspector → dock/timeline → export → help/palette) with "Step n of 6", Next/Back/Skip, Escape to close, focus moved into each step card and returned to the previously focused element on close; the tour can be restarted from Help.

*(Note 2026-10-09, PM decision.)* In M3 the tour is Pro-only: "opened for the first time" means the
first time a project opens in the Pro workspace in that profile, and the tour is not offered in
Easy, on home or in the wizard. An Easy tour variant is deferred to the P3 backlog.

- **AC-UX-010.1** Given the tour on step 3, When Escape is pressed, Then the tour closes, focus returns to the element focused before the tour, and the tour does not auto-start again.
- **AC-UX-010.2** Given `prefers-reduced-motion: reduce`, When the tour moves between steps, Then the highlight changes without animated transitions.

### Shortcut registry

**REQ-UX-011 [P1]** THE SYSTEM SHALL define every keyboard shortcut, across all features, in one typed registry (`apps/web/src/shared/shortcuts/registry.ts`) that maps a key chord and scope to a command id; feature code SHALL NOT attach its own global `keydown` handlers for shortcuts.

- **AC-UX-011.1** Given the `apps/web` source, When the lint rule runs, Then any `addEventListener('keydown'…)` or `onKeyDown` that dispatches a registered command outside `shared/shortcuts/` fails (component-local keys for widgets such as sliders, grids and tabs are allowed).
- **AC-UX-011.2** Given every row of the *Default shortcuts* table, When the registry test runs, Then the registry contains exactly those bindings (table is the source; the test diffs both).

**REQ-UX-012 [P1]** THE SYSTEM SHALL resolve a key press by scope precedence: active modal scope (dialogs, command palette, help overlay, `prop-fitting`, tour) > focused region scope (`library`, `viewport`, `inspector`, `timeline`, `graph`, and since 2026-10-09 `easy-preview`, `easy-panel`, `home`, `wizard`) > `global`; only the highest-precedence matching binding fires, and a key with no binding in the active scopes is left to the browser.

- **AC-UX-012.1** Given focus in the graph canvas, When Space is pressed, Then the node search opens and animation playback does not toggle; Given focus in the timeline, When Space is pressed, Then playback toggles.
- **AC-UX-012.2** Given the `prop-fitting` scope active (spec 008), When R is pressed, Then the gizmo switches to scale and Randomize does not run.

**REQ-UX-013 [P1]** THE SYSTEM SHALL reject, in a CI test, any registry where the same chord is bound twice in one scope, or bound in `global` and in a region/modal scope without that binding declaring `shadows: '<global command id>'`; every declared shadow is listed in the help overlay under its scope.

- **AC-UX-013.1** Given a test registry binding `F` twice in `graph`, When the conflict check runs, Then it fails naming both command ids.
- **AC-UX-013.2** Given a test registry binding `Mod+J` in `global` (`dock.toggle`) and in `graph` without `shadows`, When the check runs, Then it fails; with `shadows: 'dock.toggle'` it passes.

**REQ-UX-014 [P1]** WHILE focus is in an editable field (`input`, `textarea`, `select`, `contenteditable`, or role `textbox`/`combobox`/`spinbutton`) THE SYSTEM SHALL fire only bindings flagged `allowInInput` (Ctrl+S, Ctrl+K, Ctrl+Shift+P, F1, Escape) and leave all other keys, including Ctrl+Z/Ctrl+C/Ctrl+V, to the field.

- **AC-UX-014.1** Given focus in the project-name field, When the user types "mr", Then the text is "mr", Mute and Randomize do not run, and Ctrl+Z undoes the typing in the field, not an editor command.

**REQ-UX-015 [P1]** THE SYSTEM SHALL NOT bind chords the browser or OS reserves or users rely on: Ctrl+N/T/W, Ctrl+Shift+N/T/W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1…9, Ctrl+L, Ctrl+R, F5, F11, F12, Ctrl+Shift+I/J/C, Ctrl+P, browser zoom (Ctrl+= / Ctrl+- / Ctrl+0), Alt+F4, Alt+← / Alt+→, and macOS Cmd+Q/H/M and Cmd+Option+H ("Hide Others"; added 2026-10-09, PM, written `Mod+Alt+H` in the registry); the CI conflict check (REQ-UX-013) fails on any of them.

- **AC-UX-015.1** Given a registry entry `Mod+=`, When the check runs, Then it fails with "Reserved chord: browser zoom".

**REQ-UX-016 [P1]** THE SYSTEM SHALL activate single-character shortcuts (no modifier, e.g. M, F, J, R, V, W/E) only while the region they belong to has focus, and SHALL provide a setting "Single-key shortcuts" (default on) that disables all of them (WCAG 2.2 SC 2.1.4).

- **AC-UX-016.1** Given focus on the top-bar Export button, When M is pressed, Then nothing happens.
- **AC-UX-016.2** Given "Single-key shortcuts" off, When F is pressed in the viewport, Then the camera does not move, and Ctrl+Z still works.

*(Clarified 2026-10-09 (M3-00), PM decision.)* "Single-character shortcut" means any binding whose chord holds none of Ctrl, Alt and Meta (Cmd) and whose key produces a printable character, Shift included (WCAG 2.1.4 counts Shift+letter as a character key): `M`, `?`, `+`, `,`, `Space`, and also `Shift+A`, `Shift+D`, `Shift+H`, `Shift+R` and `Shift+S` are single-key; `Delete`, `Backspace`, `Home`, `End`, `Enter`, `Escape`, `Tab`, arrow keys and F-keys (with or without Shift) are not. The classification is derived from the chord (no per-binding flag), applies to remapped chords too (REQ-UX-017), and every single-key default binding is marked † in the Default shortcuts table.

- **AC-UX-016.3** Given "Single-key shortcuts" off and focus on the graph canvas with one node selected, When Shift+D, then Shift+H, then Shift+A is pressed, Then no node is duplicated, the node's preview does not toggle and no node search opens; When Mod+D is pressed, Then the node is duplicated. Given the chord classifier, When `Shift+D`, `?`, `Space` and `,` are classified, Then each is single-key; When `Shift+F6`, `Delete`, `Mod+D`, `Alt+A` and `Alt+Shift+H` are classified, Then none is. *(Added 2026-10-09 (M3-00).)*

**REQ-UX-017 [P2]** THE SYSTEM SHALL let the user remap any binding in Settings › Keyboard, validate remaps with the same conflict and reserved-chord rules, store them locally, and offer "Reset to defaults".

- **AC-UX-017.1** Given the user remaps Mute from M to Shift+M, When the help overlay opens, Then Mute shows Shift+M; When M is pressed in the graph, Then nothing happens.
- **AC-UX-017.2** Given the user tries to remap Undo to Ctrl+W, Then the remap is refused with the reserved-chord message.

**REQ-UX-018 [P1]** THE SYSTEM SHALL write chords platform-neutrally (`Mod` = Ctrl on Windows/Linux, Cmd on macOS; `Alt` = Option) and display them per platform (`Ctrl+Shift+Z` vs `⇧⌘Z`), matching on `KeyboardEvent.key` for characters and `code` only for layout-independent keys (Space, digits on numpad, F-keys).

- **AC-UX-018.1** Given macOS (mocked `navigator.userAgentData.platform`), When the help overlay opens, Then Redo shows `⇧⌘Z`; When Cmd+Shift+Z is pressed, Then redo runs.
- **AC-UX-018.2** Given an AZERTY layout, When the user presses the key producing `?`, Then the help overlay opens.

#### Default shortcuts

`Mod` = Ctrl / Cmd. Scope names as in REQ-UX-012. "Owner" is the spec defining the command's
behavior; this table owns the binding. Bindings marked † are single-key (REQ-UX-016, including Shift+printable key per its 2026-10-09 clarification).

| Command id | Keys | Scope | Action | Owner |
|------------|------|-------|--------|-------|
| `app.commandPalette` | Mod+K, Mod+Shift+P | global (allowInInput) | Open command palette | 009 |
| `app.help` | ? †, F1 | ? in all regions; F1 global (allowInInput) | Open shortcut help overlay | 009 |
| `app.undo` | Mod+Z | global | Undo | 009 |
| `app.redo` | Mod+Shift+Z, Mod+Y | global | Redo | 009 |
| `project.save` | Mod+S | global (allowInInput) | Save project now | 009 |
| `project.exportFile` | Mod+Shift+S | global | Download project file | 009 |
| `project.open` | Mod+O | global | Open project… | 009 |
| `project.new` | Mod+Alt+N | global | New character: opens the wizard, `#new` (amended 2026-10-09: was the Welcome dialog) | 009 |
| `app.toggleWorkspace` | Mod+Alt+P | global | Switch workspace Easy ⇄ Pro (added 2026-10-09, REQ-UX-053) | 009 |
| `wizard.exit` | Escape | wizard (allowInInput) | Leave the wizard, confirm discard if changed (added 2026-10-09, REQ-UX-098) | 009 |
| `export.open` | Mod+E | global | Open export dialog | 005 |
| `app.focusNextRegion` / `app.focusPrevRegion` | F6 / Shift+F6 | global | Cycle focus between regions | 009 |
| `app.closeOverlay` | Escape | modal (allowInInput) | Close dialog/overlay/palette, cancel drag | 009 |
| `dock.toggle` | Mod+J | global | Show/hide bottom dock | 009 |
| `dock.timeline` | Mod+Shift+L | global | Dock: Timeline | 009 |
| `dock.materialGraph` | Mod+Shift+G | global | Dock: Material graph | 009 / 006 |
| `dock.postGraph` | Mod+Shift+O | global | Dock: Post graph | 009 / 006 |
| `dock.maximize` | Mod+Shift+M | global | Maximize/restore dock | 009 |
| `inspector.tab1..5` | Alt+Shift+1…5 | global | Inspector: Parts / Colors / Anatomy / Render / Animation | 009 |
| `composer.randomize` | R † | library, viewport, inspector | Randomize (seeded, respects locks) | 001 |
| `composer.randomizeReroll` | Shift+R † | library, viewport, inspector | Randomize with a new seed | 001 |
| `composer.clearSlot` | Delete, Backspace | library (slot/tile focused) | Clear focused slot | 001 |
| `animation.togglePlay` | Space † | viewport, timeline | Play/pause preview | 004 |
| `animation.prevFrame` / `nextFrame` | ← / →, `,` / `.` † | timeline, viewport | Step one sampled frame (pauses playback) | 004 |
| `animation.firstFrame` / `lastFrame` | Home / End | timeline | Jump to first/last frame | 004 |
| `viewport.toggleMode` | V † | viewport | Toggle 3D / Pixel | 009 |
| `viewport.frame` | F † | viewport | Frame character | 009 |
| `viewport.prevDir` / `nextDir` | [ / ] † | viewport | Previous/next direction | 003 |
| `viewport.zoomIn` / `zoomOut` | + / - † | viewport | Integer zoom in/out (Pixel) | 009 |
| `graph.search` | Shift+A †, Space † (tap: press and release < 200 ms without pointer movement) | graph | Open node search | 006 |
| `graph.zoomIn` / `zoomOut` | + / - † | graph | Zoom canvas in/out (10–400 %) | 006 |
| `graph.mute` | M † | graph | Mute/bypass selected nodes | 006 |
| `graph.hideUnused` | ~~Mod+H~~ Alt+Shift+H | graph | Hide unused sockets (amended 2026-10-09, PM: Mod+H is macOS Cmd+H, reserved by REQ-UX-015; Mod+Alt+H is macOS "Hide Others" (⌥⌘H), so Alt+Shift+H is used, matched on `code` `KeyH` because Alt is held) | 006 |
| `graph.frameSelection` | F † | graph | Frame selection (all if none) | 006 |
| `graph.frameAll` | Home | graph | Frame all nodes | 006 |
| `graph.frameBox` | J † | graph | Add frame (box) around selection | 006 |
| `graph.toggleSubgraph` | Tab | graph (`when`: a group instance is selected → enter; or inside a group with nothing selected → exit; otherwise Tab moves focus normally, AC-UX-037.2) | Enter/exit subgraph | 006 |
| `graph.exitSubgraph` | Escape | graph (`when`: inside a group, nothing selected, focus not inside a node) | Exit subgraph | 006 |
| `graph.copy` / `cut` / `paste` | Mod+C / Mod+X / Mod+V | graph | Copy/cut/paste nodes as JSON | 006 |
| `graph.duplicate` | Mod+D, Shift+D † | graph | Duplicate selection | 006 |
| `graph.delete` | Delete, Backspace | graph | Delete selection | 006 |
| `graph.selectAll` | A †, Mod+A | graph | Select all nodes | 006 |
| `graph.deselectAll` | Alt+A | graph | Deselect all | 006 |
| `graph.group` / `ungroup` | Mod+G / Mod+Alt+G | graph | Group into subgraph / ungroup | 006 |
| `graph.togglePreview` | Shift+H † | graph | Toggle preview on selected nodes | 006 |
| `graph.collapse` | H † | graph | Collapse/expand selected nodes | 006 |
| `graph.nudge` | Mod+← / → / ↑ / ↓ | graph | Move selected nodes one grid step (16 px) | 006 |
| `graph.connect` | C † | graph (socket focused) | Open "Connect to…" list | 006 |
| `graph.toggleSnap` | Shift+S † | graph | Toggle grid snapping | 006 |
| `graph.alignLeft` / `alignRight` / `alignTop` / `alignBottom` (P2) | Alt+Shift+← / → / ↑ / ↓ | graph | Align selected nodes | 006 |
| `graph.find` (P2) | Mod+F | graph | Find in graph | 006 |
| `graph.contextMenu` (P2) | Shift+F10, ContextMenu | graph | Open context menu | 006 |
| `fit.translate` / `rotate` / `scale` | W / E / R † | prop-fitting (shadows `composer.randomize`) | Gizmo mode | 008 |
| `fit.confirm` / `fit.cancel` | Enter / Escape | prop-fitting | Apply / cancel fitting | 008 |

Component-local keys of the graph canvas (a composite widget, allowed by AC-UX-011.1, listed in the
help overlay under `graph`, not registry chords): arrow keys move focus between nodes, Enter enters
the focused node, Tab / Shift+Tab cycle its sockets and widgets, Escape leaves the node (spec 006
REQ-EDT-049).

Component-local keys of the Easy workspace, home screen and wizard (composite widgets, allowed by
AC-UX-011.1, listed in the help overlay under their scope; added 2026-10-09): in `easy-preview`, ← / →
rotate the preview one 45° step (REQ-UX-058); in option-tile grids, arrows move focus, Home/End jump,
Enter/Space select (REQ-UX-061); in swatch rows and wizard option cards, arrows move and check
(REQ-UX-062, REQ-UX-092); in the home avatar strip, ← / → / Home / End change the selection and Enter
runs the primary action (REQ-UX-075). Those requirements are in spec 014.

List-local reordering keys (added 2026-10-09, PM decision): WHILE focus is on an item of a
reorderable list, Alt+↑ / Alt+↓ move that item one position up or down. They are widget-local keys,
handled inside the list widget and allowed by AC-UX-011.1 the same way as arrows in grids; they are
not registry chords, so they are not rows of the table above and the REQ-UX-013 conflict check does
not see them. They do not clash with `graph.alignTop` / `alignBottom` (Alt+Shift+↑ / ↓) and are not
in the REQ-UX-015 reserved list (only Alt+← / → are). The help overlay lists them under the scope
of the region that holds the list:

| Keys | Where (widget) | Scope listed in help overlay | Action | Owner |
|------|----------------|------------------------------|--------|-------|
| Alt+↑ / Alt+↓ | Clip selection list of the Animation inspector tab (AC-ANM-004.3) | inspector | Move the focused clip up / down (one undo step) | 004 |
| Alt+↑ / Alt+↓ | Blackboard param list (spec 006 REQ-EDT-030; `docs/guide/shader-graph/blackboard.md`) | graph | Move the focused param up / down | 006 |

`Mod+Alt+P` was chosen for `app.toggleWorkspace` because it is not in the REQ-UX-015 list and no
documented default exists for it in Chrome, Firefox or Safari (checked 2026-10-09, References).

Mouse-only gestures (documented in the help overlay, not chords): hold Space and drag or
middle-drag to pan, Ctrl/Cmd+wheel or pinch to zoom, Alt+click a wire to add a reroute,
Ctrl/Cmd+right-drag to cut wires (P2), hold Alt while dragging to suspend snapping, drag a wire into
empty space to open filtered search (006); each has a keyboard alternative listed in spec 006.

This table is canonical for every binding (reconciled with spec 006 on 2026-10-08). Spec 006's
Keyboard map is a copy of the `graph` rows; a change is made here first.

### Command palette and help

**REQ-UX-019 [P1]** WHEN the user presses Mod+K (or Mod+Shift+P, or the top-bar button) THE SYSTEM SHALL open a command palette (ARIA combobox + listbox) within 100 ms that fuzzy-searches every registry command by title, category and synonyms, shows each command's shortcut, lists the 5 most recent commands first when the query is empty, shows disabled commands greyed with their reason, and runs the chosen command on Enter.

- **AC-UX-019.1** Given 1,000 registered commands, When the user types "rand", Then "Randomize" is the first result within 50 ms of the keystroke and shows "R".
- **AC-UX-019.2** Given no export possible (missing asset, spec 008), When "Export" is searched, Then the command is listed disabled with the reason and Enter does nothing.
- **AC-UX-019.3** Given the palette closes, Then focus returns to the element focused before it opened.

**REQ-UX-020 [P1]** WHEN the user presses ? or F1 THE SYSTEM SHALL open a help overlay generated from the registry at runtime, grouped by scope, showing current (including remapped) bindings in platform notation, with a filter field, the mouse gestures list, and links to the user guide.

- **AC-UX-020.1** Given the default registry, When the overlay opens, Then every registry entry appears exactly once in its scope group, and the count equals the registry length.

**REQ-UX-021 [P2]** THE SYSTEM SHALL generate `docs/guide/getting-started/keyboard-shortcuts.md` (the path in spec 010's docs information architecture; amended 2026-10-08, was `docs/guide/reference/keyboard-shortcuts.md`) from the registry with a tool (`pnpm docs:shortcuts`, a root package script; consistency review 2026-10-08), and CI SHALL fail if the committed file differs from the generated one.

- **AC-UX-021.1** Given a registry change without regenerating the doc, When CI runs, Then the docs-sync check fails naming the file.

### Undo/redo

**REQ-UX-022 [P1]** THE SYSTEM SHALL keep one editor history for the open project (no feature keeps its own undo stack) that records every document-changing command from all features (composer, anatomy, colors, render, animation settings, shader graph edits) as a labelled entry, with at least 200 entries, where Mod+Z undoes and Mod+Shift+Z / Mod+Y redoes regardless of which region has focus (except inside text fields, REQ-UX-014).

- **AC-UX-022.1** Given equip hair (composer) → add node (graph) → set anatomy head 1.2, When undo is pressed 3 times from the viewport, Then all three are reverted in reverse order.
- **AC-UX-022.2** Given 250 commands, When undo is pressed 250 times, Then the first 200 undos succeed and further undos are no-ops with the Undo button disabled.
- **AC-UX-022.3** Given an undo that reverts a change in a region not visible (e.g. graph while the dock is collapsed), When undone, Then a polite toast says "Undid: Add node Toon Ramp".

**REQ-UX-023 [P1]** THE SYSTEM SHALL coalesce continuous edits into one history entry: one per pointer drag (pointerdown → pointerup) and one per keyboard burst on the same control (consecutive changes < 500 ms apart).

- **AC-UX-023.1** Given a slider dragged through 40 values, When undo is pressed once, Then the value returns to before the drag.
- **AC-UX-023.2** Given 5 ArrowRight presses 100 ms apart on a slider, When undo is pressed once, Then all 5 steps are reverted.

**REQ-UX-024 [P1]** THE SYSTEM SHALL clear the redo branch when a new command is recorded after an undo, restore selection and active tab/dock with each undo/redo, and exclude non-document actions (camera orbit, zoom, panel sizes, library save/delete) from history.

- **AC-UX-024.1** Given undo of a tint change made in the Colors tab while Anatomy is active, When undone, Then the Colors tab becomes active and the changed swatch is focused.

### Projects, save and autosave

**REQ-UX-025 [P1]** THE SYSTEM SHALL store projects (`ProjectDocument`, architecture §3.3) locally in IndexedDB only, with a project list (name, 64 px thumbnail of direction 0 frame 0, last modified) in File › Open, and Mod+S saving the current project immediately.

- **AC-UX-025.1** Given an edited project, When Mod+S is pressed, Then within 500 ms the status shows "Saved" and the IndexedDB record equals the serialized document.
- **AC-UX-025.2** Given an E2E session saving a project, When network requests are recorded, Then none carry project data (REQ-GEN-003).

**REQ-UX-026 [P1]** WHILE a project has unsaved changes THE SYSTEM SHALL autosave it 2 s after the last change, and at most 10 s after the first unsaved change during continuous editing, keeping the last 10 autosave snapshots per project in addition to the current state.

- **AC-UX-026.1** Given a change at t = 0 and no further edits, When t = 2.5 s, Then the stored project includes the change.
- **AC-UX-026.2** Given an edit every 500 ms for 30 s, When stored versions are inspected, Then an autosave happened at least every 10 s.
- **AC-UX-026.3** Given 12 autosaves, When snapshots are listed (File › Restore version), Then exactly the 10 newest are kept.

**REQ-UX-027 [P1]** THE SYSTEM SHALL show the save state in the top bar as text with icon — "Saved", "Saving…", "Unsaved changes" or "Save failed — Retry" — announced politely on change to "Save failed" only.

- **AC-UX-027.1** Given IndexedDB writes failing (mock), When autosave runs, Then the status shows "Save failed — Retry", an error toast appears once, and "Download project file" is offered as a fallback.

**REQ-UX-028 [P1]** THE SYSTEM SHALL let the user download the project as `<name>.csgproj.json` (Mod+Shift+S) and open such a file (Mod+O or drop), running migrations and validation (architecture §4.5) and reporting invalid files with code `UX_PROJECT_INVALID`; projects using user assets can instead be exported as a bundle (REQ-UPL-050).

- **AC-UX-028.1** Given a downloaded project file, When opened in a fresh profile, Then the character, render settings and graphs are deep-equal to the original.
- **AC-UX-028.2** Given a malformed JSON file, When opened, Then `UX_PROJECT_INVALID` is shown with the first schema error path and the current project is unchanged.

**REQ-UX-029 [P2]** IF the same project is open in a second tab THEN THE SYSTEM SHALL open it read-only there, with a banner "Open in another tab — Take over editing"; taking over makes the other tab read-only (Web Locks / BroadcastChannel). Every received BroadcastChannel message SHALL be validated against a Zod schema (`TabMessage`, Data & contracts) and ignored if invalid; messages never carry project content, only project IDs and lock events. (Message validation added by security review 2026-10-08.)

- **AC-UX-029.1** Given tab A editing project P, When tab B opens P, Then B shows the banner and editing controls are disabled; When B takes over, Then A shows the banner within 1 s.
- **AC-UX-029.2** Given tab A editing P, When a test posts `{ type: 'takeover', projectId: 42 }` (number instead of string), a message with an unknown `type`, and a 5 MB string message on the channel, Then tab A ignores both (state unchanged, no error toast) and a dev-mode console warning names the schema failure.

**REQ-UX-030 [P1]** WHEN the user tries to close or reload the tab while an autosave is pending or failed THE SYSTEM SHALL trigger the browser's `beforeunload` confirmation; otherwise it SHALL NOT.

- **AC-UX-030.1** Given all changes saved, When the tab is closed, Then no confirmation appears.

### Notifications

**REQ-UX-031 [P1]** THE SYSTEM SHALL show transient notifications as toasts in a fixed region at the bottom of the viewport area that never covers the inspector, the dock or the focused element (WCAG 2.2 SC 2.4.11), with at most 3 visible (others queued), identical messages within 2 s merged, and these timings: info 5 s, success 4 s, warning 8 s, with-action (e.g. Undo) 10 s, error until dismissed; timers pause on hover and focus.

- **AC-UX-031.1** Given 5 info toasts in 1 s, When rendered, Then 3 are visible and the other 2 appear as earlier ones expire.
- **AC-UX-031.2** Given an error toast, When 60 s pass, Then it is still visible until the user dismisses it.

**REQ-UX-032 [P1]** THE SYSTEM SHALL announce info/success/warning toasts through a polite live region and errors through an assertive one, never move focus to a toast, include the error code (e.g. `UPL_TIMEOUT`) on error toasts, and make every toast action reachable by keyboard (F6 cycles into the toast region when one is visible).

- **AC-UX-032.1** Given a screen reader, When an error toast appears, Then its text including the code is announced once and focus stays where it was.

**REQ-UX-033 [P2]** THE SYSTEM SHALL keep the last 50 notifications of the session in a notification center (bell icon in the top bar, unread count) so that expired toasts and their actions remain available.

- **AC-UX-033.1** Given an expired "Undo" toast, When the notification center opens, Then the entry is listed with its action (enabled while still applicable).

### Theming

**REQ-UX-034 [P1]** THE SYSTEM SHALL offer Dark (default), Light and System themes, applied before first paint (no flash of the wrong theme), defined as CSS custom-property design tokens, persisted locally.

- **AC-UX-034.1** Given Light chosen, When the page reloads, Then the first painted frame uses the light background (Playwright screenshot at first paint).

**REQ-UX-035 [P1]** THE SYSTEM SHALL meet, in both themes, text contrast ≥ 4.5:1 (≥ 3:1 for ≥ 24 px or 18.7 px bold), ≥ 3:1 for UI component boundaries, focus indicators and graph socket colors against their background, and SHALL never convey state by color alone (socket type also by shape or label; confidence, license and error states by text/icon).

- **AC-UX-035.1** Given the token set, When the contrast test computes every text/background and indicator/background pair, Then all meet the thresholds in both themes.

### Accessibility

**REQ-UX-036 [P1]** THE SYSTEM SHALL make every action keyboard-operable with a visible focus indicator (≥ 2 px outline, ≥ 3:1 contrast) and a logical focus order, and SHALL have zero axe-core violations at levels A/AA on the main editor states (default, each inspector tab, graph dock open, export dialog, upload wizard, palette, help overlay).

- **AC-UX-036.1** Given each listed state, When axe-core runs in Playwright, Then 0 violations are reported.
- **AC-UX-036.2** Given keyboard-only use, When the user composes a character, changes a tint, adjusts anatomy, picks a clip and exports, Then the flow completes without a pointer (E2E).

**REQ-UX-037 [P1]** THE SYSTEM SHALL manage focus for overlays: dialogs trap focus, label themselves (`aria-labelledby`), close on Escape and return focus to the invoking element; no region is a keyboard trap (graph Tab handling per the shortcut table; Escape or F6 always leaves).

- **AC-UX-037.1** Given the export dialog opened from the top bar, When Escape is pressed, Then the dialog closes and focus is on the Export button.
- **AC-UX-037.2** Given focus in the graph canvas with no group node selected, When Tab is pressed, Then focus leaves the canvas to the next focusable element. *(Note 2026-10-09 (PM): not testable in M3; verification lands in M4 with the shader graph editor (spec 006), when a graph canvas exists. Until then the dock graph tabs show the "arrives with the shader graph editor" notice. Meaning unchanged.)*

**REQ-UX-038 [P1]** WHERE `prefers-reduced-motion: reduce` is set (or the in-app "Reduce motion" setting is on) THE SYSTEM SHALL disable non-essential UI motion (panel slides, toast slides, tour highlights, auto-orbit) and start the viewport animation paused; otherwise UI transitions SHALL last ≤ 200 ms.

- **AC-UX-038.1** Given reduced motion, When a drawer opens, Then no CSS transition or animation with duration > 0 runs on it, and the preview shows a Play button instead of playing.

**REQ-UX-039 [P1]** THE SYSTEM SHALL give the viewport canvas an accessible name and a live text summary (e.g. "Knight: 8 parts, walk, frame 3 of 8, direction 2 of 8, 64 px, Pixel view") updated politely at most once per second, and SHALL keep the anatomy, parts and graph state available in non-canvas form (lists, labelled controls; graph node list view per spec 006, P-06).

- **AC-UX-039.1** Given a screen reader on the viewport, When the clip changes to `run`, Then the summary updates within 1 s and contains "run".

**REQ-UX-040 [P1]** THE SYSTEM SHALL make interactive targets at least 24×24 CSS px (WCAG 2.2 SC 2.5.8) and provide a non-drag alternative for every drag interaction — splitters, sliders, gizmos, node moves and wiring, drag-drop upload, timeline scrubbing (SC 2.5.7).

- **AC-UX-040.1** Given the automated target-size check, When it scans the editor, Then no interactive element is smaller than 24×24 px unless it is inline text.
- **AC-UX-040.2** Given the timeline, When the user focuses the playhead and presses →, Then it advances one frame without dragging.

### Internationalization readiness

**REQ-UX-041 [P2]** THE SYSTEM SHALL load UI strings from ICU MessageFormat catalogs (REQ-GEN-006) with keys per feature (`ux.*`, `upl.error.*` …), format numbers, sizes and dates with `Intl` for the active locale, map every error code to a catalog message, and use CSS logical properties so an RTL locale can be added without layout code changes.

- **AC-UX-041.1** Given the `de` pseudo-catalog, When storage usage is shown, Then "1,5 GB" uses the German decimal separator.
- **AC-UX-041.2** Given `dir="rtl"` on the root with the pseudo-locale, When the editor renders at 1280×800, Then the library is on the right and no control overlaps (P3 visual check, non-blocking).

### Renderer status and diagnostics

**REQ-UX-042 [P1]** THE SYSTEM SHALL show a renderer status badge in the top bar — "WebGPU", "WebGL2" (with info icon: "Fallback renderer — exports may differ slightly from WebGPU") or "No GPU" — that opens the diagnostics view required by REQ-GEN-002 (backend, three.js version r186, adapter info where available, app version, storage persistence state, last 20 error codes).

- **AC-UX-042.1** Given `forceWebGL: true`, When the editor loads, Then the badge reads "WebGL2" and diagnostics show backend `webgl2` and three `r186`.
- **AC-UX-042.2** Given diagnostics open, When "Copy report" is pressed, Then a plain-text report (no user file bytes, no project content beyond counts) is copied to the clipboard and nothing is sent over the network.

### Error boundaries and crash recovery

**REQ-UX-043 [P1]** THE SYSTEM SHALL wrap each region (library, viewport, inspector, dock, each dialog) in an error boundary that, on a render error, replaces only that region with a fallback ("This panel stopped working" + error code `UX_PANEL_CRASHED`, "Reload panel" and "Copy diagnostic report"), keeps other regions working and never shows a stack trace.

- **AC-UX-043.1** Given a test hook that throws in the inspector render, When triggered, Then the inspector shows the fallback, the viewport keeps rendering, and "Reload panel" restores the inspector with the current project.

**REQ-UX-044 [P1]** IF an error escapes all region boundaries THEN THE SYSTEM SHALL show a full-window fallback with "Reload editor" and "Download project backup" (the last in-memory `ProjectDocument`, or the latest autosave if memory is unusable).

- **AC-UX-044.1** Given a test hook that throws in the shell root, When triggered, Then the fallback is shown and the downloaded backup validates and opens to the same character.

**REQ-UX-045 [P1]** WHEN the editor starts after an unclean shutdown (crash or tab killed while a project had changes newer than its last explicit save) THE SYSTEM SHALL offer "Restore your last session?" with the project name and autosave time, restoring or discarding (discard keeps the autosave available under File › Restore version). THE SYSTEM SHALL never restore automatically without that choice; SHALL validate restored data with the same schema, limits and migrations as an imported project file (REQ-UX-028, spec 000 GEN rules for persisted data); and IF a restore fails validation, or the previous start crashed during a restore THEN THE SYSTEM SHALL offer "Start without restoring", which opens the home screen (spec 014 REQ-UX-086; amended 2026-10-09, was the Welcome dialog) and leaves the autosave untouched under File › Restore version. (Amended by security review 2026-10-08.)

- **AC-UX-045.1** Given an edited project and the page process killed (E2E), When the editor reopens, Then the restore prompt appears and "Restore" yields a document deep-equal to the last autosave.
- **AC-UX-045.2** Given an unclean shutdown, When the editor reopens and the user does not answer the prompt, Then after 60 s no project data has been loaded into the engine (no part load, no graph compile).
- **AC-UX-045.3** Given an autosave tampered in IndexedDB so it fails schema validation, When "Restore" is chosen, Then `UX_PROJECT_INVALID` is shown with the first failing path, "Start without restoring" is offered, and the stored autosave is not modified.
- **AC-UX-045.4** Given a restore during which the tab was killed (a "restore in progress" marker is still set at next start), When the editor reopens, Then the prompt offers "Start without restoring" as the default-focused action.

**REQ-UX-046 [P1]** IF the GPU device is lost THEN THE SYSTEM SHALL show "Renderer restarting…" in the viewport, recreate the renderer (spec 003), keep the project and history unchanged, and IF recreation fails twice THEN THE SYSTEM SHALL show the `PIX_BACKEND_UNAVAILABLE` fallback while keeping the inspector editable and saving possible.

- **AC-UX-046.1** Given a simulated device loss, When recovery succeeds, Then within 2 s the preview renders again and the undo history length is unchanged.

### Settings and routing

**REQ-UX-047 [P2]** THE SYSTEM SHALL keep UI preferences (theme, panel sizes, dock tab, inspector tab, single-key shortcuts, reduce motion, shortcut remaps, tour dismissal, and since 2026-10-09 the workspace, the active Easy category and "Show home screen on startup", which replaces the Welcome dismissal) in local storage under one versioned key, falling back to defaults if storage is unavailable or the value is invalid.

- **AC-UX-047.1** Given a corrupt preferences value, When the editor loads, Then defaults are used, no error is shown, and the value is rewritten valid on the next change.

**REQ-UX-048 [P1]** THE SYSTEM SHALL serve the editor as a single route at `<basePath>/app/` with no path-based client routing in v1; deep state (share links, REQ-CMP-025 `#c=`) is carried only in the URL fragment, so static hosting needs no rewrites or `404.html` redirect.

Note (2026-10-09): the home screen, the wizard and the editor are in-app views of this one route,
selected by the fragment (`#home`, `#new`, `#p=<id>`, `#c=…`; REQ-UX-069). This adds no client
router and no path segments.

- **AC-UX-048.1** Given the editor on GitHub Pages under a base path, When a share link `<basePath>/app/#c=…` is opened directly, Then the editor loads and the character renders, with no 404.

### Hardening (security review 2026-10-08)

**REQ-UX-049 [P1]** IF the GPU device is lost twice within 30 s after a shader graph change or a session/project restore THEN THE SYSTEM SHALL revert that graph to its last successfully rendered version (or to the built-in default graph for its target if none rendered in this session), recording the revert as one undoable history entry, SHALL show a warning toast with code `UX_GRAPH_REVERTED`, and SHALL offer "Start in safe mode" on the next launch, which opens the project with built-in graphs only and no user assets loaded. (security review 2026-10-08)

- **AC-UX-049.1** Given a post graph edit followed by two simulated device losses 5 s and 12 s later, When the second loss is handled, Then the post graph equals the last graph that produced a rendered frame, the toast shows `UX_GRAPH_REVERTED`, and the history has exactly one new entry labelled "Revert graph after GPU crash". *(Note 2026-10-09 (PM): AC-UX-049.1 to .4 are not testable in M3; verification lands in M4 with the shader graph editor (spec 006), when user graphs can be edited, compiled and reverted. Until then the dock graph tabs show the "arrives with the shader graph editor" notice. Meaning unchanged.)*
- **AC-UX-049.2** Given a restored project whose graph causes two device losses within 30 s and no earlier successful render, When handled, Then the graph is replaced by `builtin:post-default` (or `builtin:material-toon`) and the renderer recovers within 2 s. *(Note 2026-10-09 (PM): verification lands in M4; see AC-UX-049.1. Meaning unchanged.)*
- **AC-UX-049.3** Given a reverted graph in the previous session, When the editor next starts, Then the start prompt offers "Start in safe mode"; When chosen, Then no user graph is compiled, no `user:` asset is read from OPFS (spec 008), user parts show "Missing asset" placeholders, and a banner "Safe mode — Exit safe mode" is shown. *(Note 2026-10-09 (PM): verification lands in M4; see AC-UX-049.1. Meaning unchanged.)*
- **AC-UX-049.4** Given two device losses 31 s apart, or two losses with no graph change or restore in the preceding 30 s, When handled, Then REQ-UX-046 applies only and no graph is reverted. *(Note 2026-10-09 (PM): verification lands in M4; see AC-UX-049.1. Meaning unchanged.)*

**REQ-UX-050 [P1]** THE SYSTEM SHALL count the bytes of the current projects and of every autosave snapshot (`project-snapshots`) in the storage usage display (spec 008, REQ-UPL-038) as a separate "Projects and autosaves" line, and SHALL apply the same free-space check before an autosave write; IF the check fails THEN autosave follows the REQ-UX-027 "Save failed" path. (security review 2026-10-08)

- **AC-UX-050.1** Given 3 projects with 10 autosave snapshots each totalling 24 MB, When the storage usage view opens, Then "Projects and autosaves" shows 24 MB (± 1 MB) and the total includes it.
- **AC-UX-050.2** Given a mocked `navigator.storage.estimate()` with 2 MB free and a 4 MB autosave pending, When autosave runs, Then no write is attempted, the status shows "Save failed — Retry" and the existing snapshots are unchanged.

### Easy workspace, home screen and wizard: see spec 014 (REQ-UX-051…102)

Split 2026-10-09: the workspaces, the Easy workspace, the home screen and view routing, the
new-character wizard and their accessibility requirements moved verbatim, with unchanged IDs, to
[spec 014](./014-easy-home-wizard.md), together with their layout diagrams, edge cases and data
contracts (`ViewRoute`, `EasyCategoryDef`, `SwatchSetDef`, `HOME_RENDER_PROFILE`,
`HomeFramesRecord`, `ProjectListMeta`). The UX prefix is shared by both files; a new UX requirement
in either file takes the next free UX number (REQ-UX-104 onward, after REQ-UX-103 in spec 014).
This spec keeps what both views share: the shortcut registry and its scopes, the history, projects
and autosave, UI preferences, recovery and settings.

Moved ID index (all defined in spec 014): REQ-UX-051 (AC-UX-051.1, AC-UX-051.2, AC-UX-051.3),
REQ-UX-052 (AC-UX-052.1), REQ-UX-053 (AC-UX-053.1, AC-UX-053.2), REQ-UX-054 (AC-UX-054.1,
AC-UX-054.2), REQ-UX-055 (AC-UX-055.1, AC-UX-055.2, AC-UX-055.3), REQ-UX-056 (AC-UX-056.1),
REQ-UX-057 (AC-UX-057.1), REQ-UX-058 (AC-UX-058.1, AC-UX-058.2), REQ-UX-059 (AC-UX-059.1),
REQ-UX-060 (AC-UX-060.1, AC-UX-060.2), REQ-UX-061 (AC-UX-061.1, AC-UX-061.2), REQ-UX-062
(AC-UX-062.1, AC-UX-062.2), REQ-UX-063 (AC-UX-063.1, AC-UX-063.2), REQ-UX-064 (AC-UX-064.1),
REQ-UX-065 (AC-UX-065.1, AC-UX-065.2), REQ-UX-066 (AC-UX-066.1), REQ-UX-067 (AC-UX-067.1),
REQ-UX-068 (AC-UX-068.1, AC-UX-068.2), REQ-UX-069 (AC-UX-069.1, AC-UX-069.2, AC-UX-069.3),
REQ-UX-070 (AC-UX-070.1), REQ-UX-071 (AC-UX-071.1), REQ-UX-072 (AC-UX-072.1), REQ-UX-073
(AC-UX-073.1), REQ-UX-074 (AC-UX-074.1), REQ-UX-075 (AC-UX-075.1, AC-UX-075.2, AC-UX-075.3),
REQ-UX-076 (AC-UX-076.1), REQ-UX-077 (AC-UX-077.1), REQ-UX-078 (AC-UX-078.1, AC-UX-078.2),
REQ-UX-079 (AC-UX-079.1, AC-UX-079.2, AC-UX-079.3), REQ-UX-080 (AC-UX-080.1, AC-UX-080.2),
REQ-UX-081 (AC-UX-081.1), REQ-UX-082 (AC-UX-082.1, AC-UX-082.2), REQ-UX-083 (AC-UX-083.1),
REQ-UX-084 (AC-UX-084.1), REQ-UX-085 (AC-UX-085.1), REQ-UX-086 (AC-UX-086.1), REQ-UX-087
(AC-UX-087.1), REQ-UX-088 (AC-UX-088.1), REQ-UX-089 (AC-UX-089.1), REQ-UX-090 (AC-UX-090.1),
REQ-UX-091 (AC-UX-091.1), REQ-UX-092 (AC-UX-092.1, AC-UX-092.2, AC-UX-092.3 added 2026-10-09),
REQ-UX-093 (AC-UX-093.1), REQ-UX-094 (AC-UX-094.1), REQ-UX-095 (AC-UX-095.1, AC-UX-095.2),
REQ-UX-096 (AC-UX-096.1, AC-UX-096.2), REQ-UX-097 (AC-UX-097.1), REQ-UX-098 (AC-UX-098.1,
AC-UX-098.2), REQ-UX-099 (AC-UX-099.1), REQ-UX-100 (AC-UX-100.1), REQ-UX-101 (AC-UX-101.1),
REQ-UX-102 (AC-UX-102.1, AC-UX-102.2). Spec 014 also adds REQ-UX-103 (AC-UX-103.1, AC-UX-103.2),
the M3 home-preset rule (PM 2026-10-09).

Requirements of other specs that spec 014 builds on: REQ-ANA-013, REQ-ANA-014 (spec 002);
REQ-CMP-008, REQ-CMP-018, REQ-CMP-019, REQ-CMP-027, REQ-CMP-029, AC-CMP-004.1, REQ-CMP-045
(spec 001); REQ-AST-015 (spec 011); AC-GEN-007.3 (spec 000).

## Edge cases

- Shortcut pressed during IME composition (`event.isComposing`) → ignored (REQ-UX-014).
- Key repeat on single-key toggles (M, V, H) → only the first keydown fires (`event.repeat` ignored); arrows and +/- may repeat.
- Same chord in two simultaneously visible regions → focus decides (REQ-UX-012); with nothing focused (`document.body`), only `global` applies.
- Undo while an export or upload is running → allowed; export uses a snapshot taken at start (spec 005).
- Undo that would re-equip a deleted user asset → applies, slot shows "Missing asset" (REQ-UPL-048).
- Storage quota exceeded during autosave → REQ-UX-027 fallback; autosave ring counted in usage (REQ-UX-050).
- A graph that repeatedly loses the GPU device → reverted, safe mode offered next launch (REQ-UX-049).
- Corrupt or tampered autosave, or a crash during restore → "Start without restoring" (REQ-UX-045).
- Forged or malformed BroadcastChannel message → ignored (REQ-UX-029).
- Private browsing without IndexedDB → session-only projects with a banner (mirrors REQ-UPL-043).
- Window resized below 768 px while editing → layout switches to view-only, unsaved changes kept and autosaved (REQ-UX-008, -026).
- Browser zoom 200 % at 1280×800 → layout switches by CSS px breakpoints; no loss of content (WCAG 1.4.10 reflow, REQ-UX-006).
- WebGL2 backend → identical shell behavior; badge reflects it (REQ-UX-042).
- Easy, home and wizard edge cases (workspace switch during a load, hand-edited fragment in the wizard, home-frame cache, 200 saved characters) → spec 014 Edge cases.

## Data & contracts

```ts
/** Scopes in precedence order (REQ-UX-012). */
export type ShortcutScope =
  | 'global'
  | 'library' | 'viewport' | 'inspector' | 'timeline' | 'graph'
  | 'easy-preview' | 'easy-panel' | 'home' | 'wizard' // added 2026-10-09
  | 'modal' | 'prop-fitting' | 'palette' | 'help' | 'tour';

/** One command, shared by shortcuts, palette, menus and toolbar buttons. */
export interface CommandDef {
  /** Stable id, never reused, e.g. 'composer.randomize'. */
  readonly id: string;
  /** i18n key for the title, e.g. 'cmd.composer.randomize'. */
  readonly titleKey: string;
  readonly category: 'app' | 'project' | 'composer' | 'animation' | 'viewport' | 'graph' | 'export' | 'upload' | 'dock' | 'inspector';
  readonly synonyms?: readonly string[];
  /** Returns null when enabled, or an i18n key explaining why not. */
  readonly disabledReason?: () => string | null;
  readonly run: () => void | Promise<void>;
}

/** One binding row of the registry (REQ-UX-011, -013). */
export interface ShortcutDef {
  readonly commandId: string;
  /** Platform-neutral chords: 'Mod+Shift+Z', 'Shift+A', 'Space', '?'. */
  readonly keys: readonly string[];
  readonly scope: ShortcutScope;
  readonly allowInInput?: boolean;
  /** Global command id this binding intentionally overrides in its scope. */
  readonly shadows?: string;
  /** Extra condition, e.g. graph Tab only with a group node selected. */
  readonly when?: string;
}

/** Editor history entry (REQ-UX-022..024). */
export interface HistoryEntry {
  readonly label: string; // i18n-resolved, e.g. "Add node Toon Ramp"
  readonly feature: 'composer' | 'anatomy' | 'render' | 'animation' | 'graph';
  readonly undo: () => void;
  readonly redo: () => void;
  /** UI context restored on undo/redo (tab, dock, selection). */
  readonly context: {
    inspectorTab?: string;
    dock?: string;
    selection?: readonly string[];
    /** Easy category active when the entry was recorded (REQ-UX-051, added 2026-10-09). */
    easyCategory?: EasyCategoryId;
  };
}

/**
 * Local UI preferences (REQ-UX-047), localStorage key 'csg.prefs'.
 * Version 2 (2026-10-09). Migration v1 -> v2: `workspace` = 'pro' (an existing profile keeps the
 * layout it knew; a new profile gets 'easy', REQ-UX-054), `easyTab` = 'body',
 * `showHomeOnStartup` = !v1.dismissed.welcome, `dismissed.welcome` dropped.
 */
export interface UiPrefs {
  readonly format: 'sprite-ui-prefs';
  readonly version: 2;
  theme: 'dark' | 'light' | 'system';
  layout: { libraryPx: number; inspectorPx: number; dockPx: number; collapsed: { library: boolean; inspector: boolean; dock: boolean } };
  dockTab: 'timeline' | 'material-graph' | 'post-graph';
  inspectorTab: 'parts' | 'colors' | 'anatomy' | 'render' | 'animation';
  singleKeyShortcuts: boolean;
  reduceMotion: boolean | 'system';
  remaps: Record<string, string[]>; // commandId -> keys
  workspace: 'easy' | 'pro';
  easyTab: EasyCategoryId;
  showHomeOnStartup: boolean;
  dismissed: { tour: boolean };
}

/** Easy categories (spec 014 REQ-UX-060); shared by HistoryEntry and UiPrefs. */
export type EasyCategoryId = 'body' | 'skin' | 'face' | 'hair' | 'outfit' | 'accessories' | 'colors';

/** Cross-tab message (REQ-UX-029); validated with Zod on receipt, invalid messages ignored. */
export type TabMessage =
  | { readonly type: 'claim' | 'release' | 'takeover'; readonly projectId: string; readonly tabId: string };

/** Start-up recovery markers (REQ-UX-045, -049), localStorage key 'csg.recovery'. */
export interface RecoveryMarkers {
  readonly format: 'sprite-recovery';
  readonly version: 1;
  /** Set before a restore starts, cleared after the first rendered frame. */
  restoreInProgress?: { projectId: string };
  /** Set when REQ-UX-049 reverted a graph; triggers the "Start in safe mode" offer. */
  offerSafeMode?: boolean;
}
```

Error codes owned here: `UX_PROJECT_INVALID`, `UX_PANEL_CRASHED`, `UX_SAVE_FAILED`,
`UX_STORAGE_UNAVAILABLE`, `UX_GRAPH_REVERTED` (warning, REQ-UX-049), and in spec 014
`UX_PROJECT_NOT_FOUND` (warning, REQ-UX-069; added 2026-10-09).

IndexedDB stores (database `csg`): `projects` (current `ProjectDocument` + `ProjectListMeta`, spec
014), `project-snapshots` (autosave ring, 10 per project), `home-frames` (spec 014 REQ-UX-082, added
2026-10-09); shared with spec 008 stores `user-assets` and `bone-map-presets`.

The `ViewRoute`, `EasyCategoryDef`, `SwatchSetDef`, `HOME_RENDER_PROFILE`, `HomeFramesRecord` and
`ProjectListMeta` contracts moved to spec 014 Data & contracts on 2026-10-09.

## Non-functional

- Performance (P-07): shell + composer initial JS within the 400 KB gzip budget; shader graph, upload wizard and `gltf-validator` are lazy-loaded chunks. Opening the palette ≤ 100 ms; panel resize keeps ≥ 55 fps (no layout thrash: viewport canvas resizes on `ResizeObserver`, at most once per frame).
- Accessibility (P-06): WCAG 2.2 AA incl. 2.1.4, 2.4.11, 2.5.7, 2.5.8; axe-core in CI (REQ-UX-036).
- Privacy (P-03): projects, prefs and diagnostics stay local; "Copy report" only copies to clipboard.
- Determinism (P-04): autosave timestamps are metadata only and never enter exports.
- Home, wizard and Easy performance and privacy: spec 014 Non-functional.

## Open questions

- ~~Final graph bindings must be reconciled with spec 006.~~ Resolved 2026-10-08: node preview is Shift+H (not P), `A`/`Alt+A` select/deselect all added, cut, Shift+D, zoom, nudge, connect, snapping, align, find and context-menu rows added, Tab/Escape conditions aligned, `,`/`.` frame steps added from spec 004.
- [NEEDS CLARIFICATION: Can F6 be reliably intercepted in all target browsers (Firefox/Safari may move focus to the address bar)? If not, keep skip links + palette "Focus region…" as the guaranteed path. Owner: editor-ux-engineer during M3.]
- [NEEDS CLARIFICATION: Should the history persist across reloads (e.g. last 50 entries in IndexedDB)? Default for v1: no; history starts empty after reload. Owner: project owner.]
- [NEEDS CLARIFICATION: `Mod+E`, `Mod+J`, `Mod+D`, `Mod+G`, `Mod+F` override browser defaults (search bar, downloads, bookmark, find next, find; `Mod+H` dropped 2026-10-09, PM: `graph.hideUnused` moved to Alt+Shift+H). Accepted for v1 because they only fire in the matching scope; confirm with user testing. `graph.nudge` uses `Mod+←/→`, which is browser Back/Forward on macOS (Cmd+←/→); the canvas must call `preventDefault`, or the binding moves to `Alt+arrow` if that proves unreliable. Owner: editor-ux-engineer.]
- Home screen visual design (resolved 2026-10-09), the workspace toggle placement and the M3 presets: see spec 014 Open questions.
- ~~[NEEDS CLARIFICATION: On macOS, Option changes `KeyboardEvent.key` (Cmd+Option+P gives "π"; the same affects `Mod+Alt+N` and `Mod+Alt+G`). REQ-UX-018 matches characters on `key`. Should chords with Alt match on `code` instead? Proposed: yes, for letters only. Owner: editor-ux-engineer. Non-blocking for the spec, blocking for the Mod+Alt+P implementation on macOS.]~~ Resolved 2026-10-09 (PM, plan question Q7, recorded in M3-00): a chord that holds Alt matches its letter key on `KeyboardEvent.code` (`KeyA`…`KeyZ`, the physical key) instead of `key`, so `Mod+Alt+P` works on macOS; this extends the REQ-UX-018 `code` list, and all other keys keep the REQ-UX-018 rule.
- ~~[NEEDS CLARIFICATION: Should the onboarding tour (REQ-UX-010) have an Easy variant? Its steps describe Pro regions. Default until answered: the tour is offered only when a project first opens in Pro. Owner: user.]~~ Resolved 2026-10-09 (PM): the tour is Pro-only in M3 (REQ-UX-010 note); an Easy variant is deferred to the P3 backlog.

## References

- `docs/architecture.md` §1.1, §3.3, §4.4, §4.8; ADR-0004 (React Flow), ADR-0005 (local-first)
- `.tagconn/work/research.md` (shader graph UX to copy)
- WCAG 2.2: https://www.w3.org/TR/WCAG22/ — SC 2.1.4 Character Key Shortcuts, 2.4.11 Focus Not Obscured, 2.5.7 Dragging Movements, 2.5.8 Target Size (accessed 2026-10-08)
- WAI-ARIA Authoring Practices: Tabs, Combobox, Dialog, Window Splitter patterns: https://www.w3.org/WAI/ARIA/apg/patterns/ (accessed 2026-10-08)
- Blender keymap (node editor) and Unity Shader Graph shortcuts, for convention alignment
- ICU MessageFormat: https://unicode-org.github.io/icu/userguide/format_parse/messages/
- Browser default shortcuts checked for `Mod+Alt+P` (none found): Chrome https://support.google.com/chrome/answer/157179, Firefox https://support.mozilla.org/kb/keyboard-shortcuts-perform-firefox-tasks-quickly, browser shortcut overview https://www.popsci.com/web-browser-keyboard-shortcuts/ (accessed 2026-10-09)
- User decisions 2026-10-09 (M3 scope: workspaces, Easy, home screen, wizard), relayed by the coordinator; details and their references are in spec 014
- PM decisions 2026-10-09 (spec split into 009 and 014, Pro-only tour), relayed by the coordinator
