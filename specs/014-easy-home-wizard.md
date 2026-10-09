---
id: UX
title: Easy workspace, home screen and new-character wizard
status: draft
owner: spec-writer
depends_on: [constitution, 000-overview, 001-character-composer, 002-anatomy, 003-pixel-render-pipeline, 005-export, 009-editor-shell-ux, 011-asset-pipeline, 013-body-styles-and-species]
last_updated: 2026-10-09
---

# 014 – Easy workspace, home screen and new-character wizard

## Rules for IDs

This spec keeps the `UX` prefix of spec 009. It was split out of spec 009 on 2026-10-09 because
spec 009 had grown to about 950 lines (spec 009 Open questions, split proposal approved). Every
requirement and acceptance criterion below, REQ-UX-051 to REQ-UX-102, moved here verbatim with its
ID unchanged; amendments made after the move are dated. REQ-UX-103 was added here after the move.
New UX requirements in either file take the next free UX number (REQ-UX-104 onward), shared with
spec 009, so no ID is ever defined twice.
Tests cite AC IDs (constitution P-09).

Terms used here and defined in spec 009: the *Default shortcuts* table (`app.toggleWorkspace`,
`project.new`, `wizard.exit`, the `easy-preview`, `easy-panel`, `home` and `wizard` scopes and their
component-local keys), UI preferences (`UiPrefs`, REQ-UX-047), the single editor history
(`HistoryEntry`, REQ-UX-022 to REQ-UX-024), `EasyCategoryId`, the IndexedDB database `csg` and the
Pro workspace layout (REQ-UX-001 to REQ-UX-008).

## Context

M3 scope decision (user, 2026-10-09): the editor has two **workspaces**, *Easy* (a character creator in
the style of a life-sim game, tiles and swatches, no sliders) and *Pro* (the multi-panel layout of
REQ-UX-001 to REQ-UX-006). Both are views of one project document. Before the editor, a **home
screen** shows saved characters and presets as a lineup, and a **new-character wizard** builds a
character in eight steps. Home, wizard and editor are in-app views addressed by the URL fragment
(REQ-UX-048 still holds). Style and species content beyond Realistic/Chibi and Human ships in
milestone M3.5 (spec 013); the wizard shows those options as "Coming soon".

Spec 009 owns the shell around these views: shortcut registry, command palette, undo/redo history,
projects, autosave, notifications, theming, crash recovery and settings. Spec 001 owns the
`CharacterSpec` fields that Easy and the wizard edit, including `style`, `species` and the gating
rule for style and species options (REQ-CMP-045). Spec 002 owns anatomy and body-shape presets.
Spec 013 owns the M3.5 style and species content.

## Goals

- G1: A beginner makes a good-looking character without touching a slider, and can move to Pro at any time without losing anything (was spec 009 G5, added 2026-10-09).
- G2: A returning user sees their characters at once and resumes work in one action.
- G3: A new user is guided through every choice of a new character, in at most eight steps.

## Non-goals

- NG1: A separate data model for Easy or the wizard. They edit the same `CharacterSpec` fields as Pro (was spec 009 NG5, added 2026-10-09).
- NG2: Render settings, animation selection, shader graphs and uploads in Easy. Those stay in Pro (was spec 009 NG6, added 2026-10-09).
- NG3: The shell behaviors of spec 009 (shortcut registry, history, autosave, recovery). This spec only uses them.
- NG4: Rendering of styles and species beyond Realistic/Chibi and Human (spec 013, M3.5).

## User stories

| # | Priority | As a … | I want … | so that … |
|---|----------|--------|----------|-----------|
| US-1 | P1 | beginner | to pick hair, outfit and colors from big tiles and swatches | I make a character without learning sliders |
| US-2 | P1 | returning user | to see my characters lined up when I open the app | I pick one and keep working in one click |
| US-3 | P1 | new user | a step-by-step wizard for a new character | I am guided through every choice |
| US-4 | P1 | power user | to switch to Pro and back with one shortcut | I fine-tune what Easy cannot express |

(US-1 to US-4 were spec 009 US-7 to US-10.)

## Layout

Views (REQ-UX-069): home screen (`#home`), wizard (`#new`), and the editor (`#p=<id>`) in the
Easy or Pro workspace. The Pro workspace layout is in spec 009.

**Easy workspace** (REQ-UX-056 to REQ-UX-068), at 1024 px and wider:

```
┌──────────── Top bar (48 px): Home · Project name · Save status · Renderer · [Easy|Pro] · ? · ⚙ ┐
├─────────────── Preview (≈ 55 %) ────────────┬────────────── Customize (≈ 45 %) ──────────────┤
│                                              │ [Body][Skin][Face][Hair][Outfit][Acc.][Colors] │
│                                              │  icon tabs with short labels                   │
│        ◀        (idle character)        ▶    │ ╭──────╮╭──────╮╭──────╮╭──────╮               │
│                                              │ │ None ││ tile ││ tile ││ tile │  option tiles │
│                                              │ ╰──────╯╰──────╯╰──────╯╰──────╯  (≥ 96 px)    │
│                                              │ ╭──────╮╭──────╮╭──────╮                       │
│                                              │ │ tile ││ tile ││Custom│                       │
│  [Pixel | 3D]              [Idle | Walk]     │ Color: Ponytail  ● ● ● ● ● ● ● ●  (swatches) │
├──────────────────────────────────────────────┴────────────────────────────────────────────────┤
│ Undo · Redo · Randomize ▾ · Reset tab                                        Export   (64 px) │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

At 768 to 1023 px the preview stacks above the Customize panel (REQ-UX-068). *(Amended 2026-10-09,
PM: the workspace toggle was removed from the bottom bar; it lives only in the top bar, REQ-UX-053.)*

**Home screen** (REQ-UX-069 to REQ-UX-088). Based on the user's reference image (2026-10-09, a game
lobby lineup); proportions are indicative, behavior is normative:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Logo                                              Open file…   ⚙ Settings   ? Help │
│                                                                                    │
│   Knight        Ranger       ┏━━ Mage ━━┓       Rogue        Robot     (name tags) │
│     ░             ░              ███              ░            ░                   │
│    ░░░           ░░░            █████            ░░░          ░░░      (lineup:    │
│     ░             ░              ███              ░            ░        selected   │
│    ░ ░           ░ ░            ██ ██            ░ ░          ░ ░       centered,  │
│  ═══════════════════════════ stage ═════════════════════════════════   larger)    │
│                          Mage · Edited 8 Oct 2026                                  │
│  ╭───╮╭───╮ │ ╭───╮╭───╮┏━━━┓╭───╮╭───╮╭───╮╭───╮╭───╮  …  (avatar strip, still)   │
│  │ + ││ ? │ │ │   ││   │┃   ┃│   ││   ││   ││   ││   │                              │
│  ╰───╯╰───╯ │ ╰───╯╰───╯┗━━━┛╰───╯╰───╯╰───╯╰───╯╰───╯                              │
│                         [    Edit    ]  [ ⋯ ]                                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Wizard** (REQ-UX-089 to REQ-UX-100): live preview left (≈ 55 %), step panel right with
"Step n of 8", option cards, and Back · Skip · Randomize · Next (Finish on step 8).

### Visual direction (PM, 2026-10-09)

The user approved the visual direction of the M3 mockup on 2026-10-09 and left the details to the
PM (mockup: https://claude.ai/artifact/LFES7m68SjccjgsxBajTSz, a design reference only; the app never
loads anything from it). It applies to home, wizard and Easy, and to the Pro shell where it fits:

- Dark-first, warm-charcoal game-tool UI (Dark stays the default theme, spec 009 REQ-UX-034; Light keeps the same contrast rules).
- Amber marks actions and selection (primary buttons, selected tiles, the selected avatar ring and name tag); mint marks focus and live states (focus indicator, live preview badge, saving state).
- A pixel display face is used sparingly (logo, home name tags, step titles); every other text uses a clean UI face.
- Home is a lobby stage with a spotlight on the selected character (REQ-UX-073).
- Fonts are self-hosted files shipped from the repository, with no third-party font fetch (constitution P-03, `connect-src 'self'`), and their licenses are recorded like other bundled assets.

Color and type are tokens (spec 009 REQ-UX-034) and must still meet REQ-UX-035 and REQ-UX-102
contrast: amber and mint are never the only carrier of state (check marks, rings, text).

## Requirements

### Workspaces (M3 decision 2026-10-09)

**REQ-UX-051 [P1]** THE SYSTEM SHALL offer two workspaces, Easy and Pro, as two views of the one open `ProjectDocument`, sharing one undo history (REQ-UX-022 to REQ-UX-024), the selection, the viewport state (3D/Pixel mode, direction, preview clip) and the save state.

- **AC-UX-051.1** Given Easy with hair equipped from the Hair tab, When the user switches to Pro and presses Mod+Z, Then the hair equip is undone and the history length before the switch equals the length after it.
- **AC-UX-051.2** Given Pro in Pixel mode, direction `se` and preview clip `walk`, When the user switches to Easy, Then the Easy preview shows Pixel mode, direction `se` and clip `walk`.
- **AC-UX-051.3** Given a hair tint change made in Easy and the Body tab now active, When undo runs in Easy, Then the Hair tab becomes active and the changed swatch is focused (REQ-UX-024 context, Easy category).

**REQ-UX-052 [P1]** WHEN the user switches workspace THE SYSTEM SHALL switch without converting, resetting or prompting: the document stays deep-equal, no dialog opens, no history entry is recorded, and the new workspace is interactive within 300 ms on the reference machine once its code chunk is loaded.

- **AC-UX-052.1** Given a project with a custom anatomy value and a custom tint, When the user switches Easy → Pro → Easy, Then the serialized document is byte-identical to before, no dialog appeared, and the Undo button label is unchanged.

**REQ-UX-053 [P1]** THE SYSTEM SHALL let the user switch workspace from a labelled segmented toggle "Workspace" (radiogroup with radios Easy and Pro) in the top bar of both workspaces, ~~from the same toggle in the Easy bottom bar,~~ from the command palette, and with `Mod+Alt+P` (`app.toggleWorkspace`, Default shortcuts table). *(Amended 2026-10-09, PM: the toggle is shown only once, in the top bar, as in the approved mockup; the Easy bottom bar no longer has it.)*

- **AC-UX-053.1** Given focus anywhere in Pro outside a text field, When Mod+Alt+P is pressed, Then Easy is shown and the top-bar radio Easy has `aria-checked="true"`.
- **AC-UX-053.2** Given the command palette, When the user types "workspace", Then "Switch workspace" is listed with the platform notation of Mod+Alt+P.

**REQ-UX-054 [P1]** THE SYSTEM SHALL remember the last used workspace per browser profile in UI preferences (REQ-UX-047), open every project in it, and use Easy for a new profile.

- **AC-UX-054.1** Given a fresh profile, When the first project opens, Then it opens in Easy.
- **AC-UX-054.2** Given the user switched to Pro, When the page reloads and a project opens, Then it opens in Pro.

**REQ-UX-055 [P1]** IF the document holds a value Easy cannot represent (anatomy values equal to no anatomy preset, a tint not in the channel's swatch set, a part that is not among the category's tiles such as a `user:` part) THEN THE SYSTEM SHALL show it in Easy as a selected "Custom" tile, card or swatch with an "Edit in Pro" action that switches to Pro and focuses the control that edits that value, and SHALL never change the value just because Easy displays it. *(Amended 2026-10-09 (M3-00), Q3: in the Shape group, "anatomy values equal to no anatomy preset" reads "anatomy values equal to the result of no body-shape card applied to the current style's base (REQ-ANA-023)"; AC-UX-055.1 holds as written.)*

- **AC-UX-055.1** Given `head = 1.2` and the other eight anatomy values at 1, When the Body tab opens, Then the Shape group shows a selected "Custom" card; When "Edit in Pro" is activated, Then Pro is shown with the Anatomy inspector tab active and focus on the anatomy preset selector, which reads "(modified)" (REQ-ANA-014).
- **AC-UX-055.2** Given hair tint `#123456` not in the hair swatch set, When the Hair tab opens, Then a checked swatch named "Custom color #123456" is shown; When "Edit in Pro" is activated, Then the Colors tab is active and the hair tint control is focused.
- **AC-UX-055.3** Given such custom values, When the user visits every Easy tab without choosing anything, Then the document is deep-equal to before.

### Easy workspace

**REQ-UX-056 [P1]** WHILE the Easy workspace is shown on a window at least 1024 px wide THE SYSTEM SHALL lay it out as the 48 px top bar, a preview region on the left taking 55 % (± 1 %) of the width below the top bar, a Customize panel on the right, and a 64 px bottom bar, with landmarks named "Preview", "Customize" and "Actions", and F6 cycling between top bar, preview, panel and bottom bar.

- **AC-UX-056.1** Given a 1440×900 window in Easy, When measured, Then the preview is 792 ± 14 px wide, the bottom bar is 64 ± 1 px tall, and a screen reader landmark list contains "Preview", "Customize" and "Actions".

**REQ-UX-057 [P1]** THE SYSTEM SHALL render the Easy preview through the engine viewport, playing the preview clip (default `idle`) in a loop, in Pixel mode at the largest integer zoom that fits the preview region (P-05), with the accessible name and live summary of REQ-UX-039.

- **AC-UX-057.1** Given 64 px output in a 792×788 preview region, When Pixel mode is shown, Then the canvas CSS size is 768×768 px (12×) and its backing store is 64×64 per frame.

**REQ-UX-058 [P1]** THE SYSTEM SHALL rotate the Easy preview in 45° steps through the eight labels of `DIRECTION_ORDER` (spec 003), independent of the export direction count, by horizontal pointer drag (one step per 48 px), by ← / → while the preview has focus (→ = next label, wrapping), and by labelled ◀ / ▶ buttons (non-drag alternative, SC 2.5.7), announcing the new facing politely (e.g. "Facing south-west").

- **AC-UX-058.1** Given direction label `s` and focus on the preview, When → is pressed twice, Then the direction is the label two positions after `s` in `DIRECTION_ORDER` (wrapping) and the live region announces it.
- **AC-UX-058.2** Given a pointer drag of 100 px to the right on the preview, When released, Then the direction moved exactly 2 steps and no history entry was recorded.

**REQ-UX-059 [P1]** THE SYSTEM SHALL show in the Easy preview a Pixel/3D segmented toggle and an Idle/Walk segmented toggle that set the shared viewport mode and preview clip (REQ-UX-051); WHILE the preview clip is neither `idle` nor `walk` THE SYSTEM SHALL show neither option pressed and the clip name as text next to the toggle.

- **AC-UX-059.1** Given preview clip `run` set in Pro, When Easy is shown, Then neither Idle nor Walk has `aria-pressed="true"` and the text "run" is visible; When Walk is pressed, Then the preview plays `walk`.

**REQ-UX-060 [P1]** THE SYSTEM SHALL show category tabs Body, Skin, Face, Hair, Outfit, Accessories and Colors, each an icon with a visible short label, following the ARIA tabs pattern (REQ-UX-004 keys), where each category's slots, tint channels and anatomy-preset group come from a data file (`EasyCategoryDef`, Data & contracts; P-11), and the last active tab is remembered in UI preferences.

- **AC-UX-060.1** Given focus on the Body tab, When → is pressed three times and Enter, Then the Hair panel is shown and the tab has `aria-selected="true"`.
- **AC-UX-060.2** Given a category data file that adds a slot `cape` to Accessories (no code change), When the app builds, Then the Accessories panel shows a `cape` tile group.

**REQ-UX-061 [P1]** THE SYSTEM SHALL show, below the tabs, one option-tile group per slot of the active category, each tile at least 96×96 CSS px with rounded corners, the part thumbnail (or the REQ-CMP-029 placeholder) and its name, listing only parts compatible with the current body (REQ-CMP-008) and, for optional slots, a "None" tile first; each group SHALL be a single-select `listbox` with a visible heading, roving tabindex, arrow keys moving focus by one tile (← / →) or one row (↑ / ↓), Home/End to the first/last tile, and Enter/Space selecting the focused tile (selection does not follow focus), announcing "Selected: <name>" politely.

- **AC-UX-061.1** Given the Hair group with 12 tiles in rows of 4 and focus on tile 1, When ↓ then → are pressed, Then tile 6 is focused, it is the only tile with `tabindex="0"`, and the equipped hair is unchanged.
- **AC-UX-061.2** Given focus on the "Ponytail" tile, When Space is pressed, Then the ponytail is equipped as one history entry, the tile has `aria-selected="true"`, and "Selected: Ponytail" is announced.

**REQ-UX-062 [P1]** THE SYSTEM SHALL show one swatch row under the tiles for the first tint channel of the most recently selected part in the active category (in Colors: the channel chosen in its tile group), as a `radiogroup` labelled "Color: <part name>", where each swatch has a spoken color name from its swatch-set data (`SwatchSetDef`), arrow keys move and check (ARIA radio pattern), each check commits one tint (keyboard bursts coalesced per REQ-UX-023), and the checked swatch shows a check mark, not only a color change (REQ-UX-035).

- **AC-UX-062.1** Given the hair swatch row with "Chestnut brown" checked, When → is pressed, Then the next swatch is checked, its name (e.g. "Auburn") is spoken, the hair tint equals that swatch's hex, and the preview shows it within 150 ms.
- **AC-UX-062.2** Given 4 → presses 100 ms apart, When undo is pressed once, Then the tint returns to "Chestnut brown".

**REQ-UX-063 [P1]** THE SYSTEM SHALL show no sliders, numeric fields or free color pickers in the Easy workspace, and SHALL present body shape as ~~4 to 6 anatomy preset cards (spec 002 REQ-ANA-013 data)~~ one card per body-shape preset (spec 002 REQ-ANA-022 data, menu order; six in M3) in a Shape group of the Body tab, where choosing a card applies that ~~preset~~ body shape relative to the current style's base anatomy (spec 002 REQ-ANA-023) as one undoable command. *(Amended 2026-10-09 (M3-00), PM decision on plan question Q3: the Shape group uses the six body-shape presets, not the anatomy presets; anatomy presets are applied by the style choice (spec 001 REQ-CMP-042) and stay selectable in Pro (spec 002 REQ-ANA-013). A body-shape data file added later adds a card (AC-ANA-022.3), so the former 4-to-6 cap no longer applies.)*

- **AC-UX-063.1** Given each Easy tab in turn, When the DOM is queried, Then it contains no element with role `slider` or `spinbutton` and no `input[type=range|number|color]`.
- **AC-UX-063.2** ~~Given the `chibi` card, When chosen, Then the nine anatomy values equal the `chibi` preset and one undo restores the previous values.~~ Given the Body tab of a project with style `realistic`, When the Shape group renders, Then it shows the cards Average, Slim, Athletic, Stocky, Tall and Petite in that order and no `chibi` or `heroic` card; When `stocky` is chosen, Then the nine anatomy values equal the `stocky` factors (AC-ANA-023.1), the `stocky` card is checked, and one undo restores the previous values; Given style `chibi` instead, When `stocky` is chosen, Then `torsoWidth` is 1.32 and `legLength` 0.70 (AC-ANA-023.2). *(Amended 2026-10-09 (M3-00), PM decision Q3.)*

**REQ-UX-064 [P1]** THE SYSTEM SHALL show in the Easy bottom bar, in this order, Undo and Redo (accessible names include the entry label, e.g. "Undo: Equip Ponytail", disabled when empty), Randomize (menu button: "This tab", "Everything"), Reset tab, ~~the workspace toggle (REQ-UX-053)~~ and Export (opens the spec 005 export dialog). *(Amended 2026-10-09, PM: workspace toggle removed from the bottom bar, REQ-UX-053.)*

- **AC-UX-064.1** Given a project just opened (empty history), When the bottom bar renders, Then Undo and Redo are disabled, the ~~six~~ five controls are present in order, no workspace toggle is in the bottom bar, and Export opens the export dialog with focus inside it. *(Amended 2026-10-09, PM.)*

**REQ-UX-065 [P2]** WHEN the user chooses Randomize › This tab THE SYSTEM SHALL randomize only the active category's slots, tint channels and (Body) anatomy preset choice, as if every other field were locked (REQ-CMP-019), and WHEN Randomize › Everything is chosen THE SYSTEM SHALL randomize per REQ-CMP-018 with the user's locks; each press SHALL use a fresh seed (reroll, REQ-CMP-018) stored in `CharacterSpec.seed`, pick tints only from swatch sets and anatomy only from presets, and record one history entry. *(Amended 2026-10-09 (M3-00), Q3: in Easy, "anatomy preset choice" and "anatomy only from presets" mean one of the body-shape presets of the Shape group, applied as REQ-ANA-023 to the style's base; the style's anatomy preset itself changes only with the style.)*

- **AC-UX-065.1** Given the Hair tab, When Randomize › This tab runs 20 times, Then each time only `parts.hair` and the hair tint channels may differ from before, and each result has a different `seed`.
- **AC-UX-065.2** Given Randomize › Everything, When the result is shown, Then no "Custom" tile, card or swatch is selected in any Easy tab.

**REQ-UX-066 [P1]** WHEN the user activates Reset tab THE SYSTEM SHALL set the active category's slots, tint channels and (Body) anatomy values to the default `CharacterSpec` values (spec 001), as one history entry labelled "Reset <category>".

- **AC-UX-066.1** Given a changed hair and hair tint, When Reset tab runs on the Hair tab, Then both equal the default spec, other categories are unchanged, and the Undo button reads "Undo: Reset Hair".

**REQ-UX-067 [P1]** WHEN the user changes anything in Easy THE SYSTEM SHALL show the change in the preview within the composer budget of 150 ms for cached assets (AC-CMP-004.1), and WHILE an uncached part loads THE SYSTEM SHALL mark its tile busy (`aria-busy="true"`, spinner) until it appears.

- **AC-UX-067.1** Given cached parts, When a tile, swatch or shape card is chosen, Then the preview shows the change within 150 ms of the key or pointer event.

**REQ-UX-068 [P1]** THE SYSTEM SHALL stack the Easy preview above the Customize panel at widths from 768 to 1023 px (preview 40 to 50 % of the viewport height), apply the REQ-UX-008 view-only layout below 768 px, never scroll the page horizontally at widths ≥ 320 px, and make every Easy, home and wizard target at least 44×44 CSS px at 768 to 1023 px or with a coarse pointer.

- **AC-UX-068.1** Given an 834×1112 touch viewport, When Easy is shown, Then the preview is above the panel, every interactive target is ≥ 44×44 px, and a hair tile can be chosen with touch only.
- **AC-UX-068.2** Given a 1023×800 window, When Easy is shown, Then `document.documentElement.scrollWidth` ≤ 1023.

### Home screen and view routing (replaces REQ-UX-009)

**REQ-UX-069 [P1]** THE SYSTEM SHALL select the view from the URL fragment, treated as untrusted input: `#home` the home screen, `#new` the wizard, `#p=<id>` the editor with project `<id>` (`<id>` must match `[A-Za-z0-9_-]{1,64}`), `#c=…` the share link (REQ-CMP-025, unchanged), an empty fragment the startup rule (REQ-UX-070, REQ-UX-087), and any other value the home screen; every view change SHALL update the fragment as a new browser history entry so Back and Forward move between views, and leaving the editor SHALL flush a pending autosave first.

- **AC-UX-069.1** Given `#p=does-not-exist`, When the editor loads, Then the home screen is shown and a warning toast shows `UX_PROJECT_NOT_FOUND`.
- **AC-UX-069.2** Given `#p=<script>`, `#p=` with 65 characters and `#zzz`, When each is loaded, Then the home screen is shown, no project lookup with that value happens, and no error is thrown.
- **AC-UX-069.3** Given a project opened from home with one unsaved change, When the browser Back button is pressed, Then the change is saved, the home screen is shown, and Forward reopens the project.

**REQ-UX-070 [P1]** WHEN the editor loads with an empty fragment or `#home` THE SYSTEM SHALL show the home screen, not a dialog, unless REQ-UX-087 applies.

- **AC-UX-070.1** Given a fresh profile and `<basePath>/app/` with no fragment, When the page loads, Then the home screen is shown, the URL fragment becomes `#home`, and no modal dialog is open.

**REQ-UX-071 [P1]** THE SYSTEM SHALL show on the home screen a character lineup, a details line for the selected character (name and "Edited <date>" via `Intl`, or "Preset"), the avatar strip with a "New character" tile, a bottom-center primary action button, a ⋯ menu button for saved characters, and "Open file…" (REQ-UX-028), Settings and Help in its header, inside a `main` landmark named "Characters".

- **AC-UX-071.1** Given 3 saved characters, When the home screen renders, Then each listed element is present, and the details line of the selected saved character contains its last-edited date formatted for the active locale.

**REQ-UX-072 [P1]** THE SYSTEM SHALL order the characters of the lineup and the avatar strip identically: pinned saved characters (most recently edited first), then the other saved characters (most recently edited first), then at least 6 built-in presets (REQ-CMP-027 data, pack order) that use only built-in assets and cover side-view and top-down/isometric camera presets; the initial selection SHALL be the first character in that order.

- **AC-UX-072.1** Given saved A (edited day 3), B (day 5, pinned), C (day 4) and 6 presets, When home renders, Then the order is B, C, A, then the 6 presets, and B is selected.

*(Amended 2026-10-09 (M3-00), PM decision on plan question Q4.)* A preset "covers" a camera preset through its `camera` field (`CharacterPreset`, Data & contracts): an absent `camera` means the default `side`. The home lineup itself always renders with `HOME_RENDER_PROFILE` (REQ-UX-080), whatever the preset's `camera`.

- **AC-UX-072.2** Given the shipped M3 preset data, When validated, Then at least one preset has `camera` absent or `side`, and at least one has `camera` `three-quarter` or `isometric`. *(Added 2026-10-09 (M3-00).)*

**REQ-UX-073 [P1]** THE SYSTEM SHALL draw the lineup as one horizontal row of characters standing left to right on a stage, each from its pre-rendered idle frames (REQ-UX-080) at an integer scale with a name tag above it, where the selected character is horizontally centered (± 1 px), drawn at the largest integer scale `s` with 64·`s` ≤ 50 % of the lineup height (minimum 2) and is the only one with a highlighted name tag, and the others are drawn at scale max(1, `s` − 1) with sprite opacity 70 % at distance 1 and 45 % at distance 2 or more; name tags keep text contrast ≥ 4.5:1 at every distance.

- **AC-UX-073.1** Given a 600 px tall lineup and the 4th character selected, When rendered, Then the selected sprite is drawn at 4× (256 px), its center is within 1 px of the lineup center, its neighbours are at 3×, and every name tag passes the 4.5:1 contrast check.

**REQ-UX-074 [P1]** WHEN the selection changes THE SYSTEM SHALL slide the row horizontally with an ease-out transition of at most 300 ms so the new selection ends centered, and WHEN the user clicks a lineup character THE SYSTEM SHALL select it; the lineup SHALL be `aria-hidden="true"` because the avatar strip is its accessible equivalent.

- **AC-UX-074.1** Given selection on character 2, When character 5 is clicked, Then the row transition lasts ≤ 300 ms, character 5 ends centered, and the strip's selected option is character 5.

**REQ-UX-075 [P1]** THE SYSTEM SHALL show below the lineup a single row of square, never-animated avatar thumbnails (head-and-shoulders crop, REQ-UX-080) in lineup order as a horizontal single-select `listbox` where selection follows focus, ← / → change the selection of strip and lineup together, Home/End select the first/last character, Enter runs the primary action (REQ-UX-078), each option is at least 64×64 CSS px with the accessible name "<name>, <n> of <N>, saved" or "… preset", the selected avatar has a ring at least 3 px wide with ≥ 3:1 contrast, and the strip scrolls horizontally on overflow so the selected avatar is fully visible.

- **AC-UX-075.1** Given 12 characters and focus on option 3 "Mage", When → is pressed, Then option 4 has `aria-selected="true"`, the lineup centers character 4, and its accessible name is "<name>, 4 of 12, saved".
- **AC-UX-075.2** Given 30 characters in a 1024 px window, When End is pressed, Then the last avatar is selected and fully inside the strip's visible area.
- **AC-UX-075.3** Given the strip visible for 10 s, When avatar pixels are sampled every 500 ms, Then no avatar changes.

**REQ-UX-076 [P1]** THE SYSTEM SHALL place a "New character" tile ("+", a button, not a listbox option) before the avatar strip, which opens the wizard (`#new`).

- **AC-UX-076.1** Given focus on the "New character" tile, When Enter is pressed, Then the wizard shows step 1 and the fragment is `#new`.

**REQ-UX-077 [P2]** THE SYSTEM SHALL place a "Random preset" tile ("?", a button) after the "New character" tile that selects a uniformly chosen built-in preset (`crypto.getRandomValues`) and centers it, without creating a project.

- **AC-UX-077.1** Given 6 presets, When the tile is activated 600 times (mocked random source), Then each preset is selected 100 times and no project is created.

**REQ-UX-078 [P1]** THE SYSTEM SHALL label the bottom-center primary action "Edit" for a saved character, opening it in the last workspace (`#p=<id>`), and "Start from this preset" for a preset, creating and saving (REQ-UX-025) a new project named after the preset with a copy of its `CharacterSpec` and ~~default render settings~~ the default render settings of the preset's `camera` (spec 003 Defaults table for that `camera.preset`; the `side` defaults when `camera` is absent) and opening it directly in the editor in the last workspace (not the wizard); built-in presets are never modified.

- **AC-UX-078.1** Given saved "Knight" selected and Pro as last workspace, When Edit is activated, Then Knight opens in Pro.
- **AC-UX-078.2** Given preset "Mage" selected, When "Start from this preset" is activated, Then within 500 ms a new project "Mage" is in IndexedDB, it opens in the last workspace, its spec deep-equals the preset spec, and on the reference machine the character renders within 5 s (P-07).

*(Amended 2026-10-09 (M3-00), PM decision on plan question Q4.)* A `CharacterPreset` may carry `camera`; when it is set, it sets `render.camera.preset` of the new project, and every other render field (including `camera.pivotRowPx`, filled by the spec 003 resolution-relative default rule) takes the spec 003 default for that camera preset. The camera is not copied back into the preset and is not part of the `CharacterSpec`, so AC-UX-078.2's spec equality is unchanged. The wizard (REQ-UX-099) does not use preset cameras and keeps the plain default render settings.

- **AC-UX-078.3** Given preset "Scout" with `camera: 'isometric'`, When "Start from this preset" is activated, Then the saved project's `render` deep-equals the spec 003 defaults for `camera.preset` `isometric` (so `camera.pivotRowPx` is 10 at 64×64 with the default outline); Given preset "Mage" without `camera`, Then the project's `render` deep-equals the `side` defaults. *(Added 2026-10-09 (M3-00).)* *(Note 2026-10-10 (PM): "deep-equals the spec 003 defaults" excludes `render.animations`, which spec 004 owns; every new project starts with the spec 001/004 default clip selection (idle, then walk), as for the wizard and share-link paths. Meaning otherwise unchanged.)*

**REQ-UX-079 [P1]** THE SYSTEM SHALL offer, for the selected saved character only, a ⋯ menu (ARIA menu button) with Open, Duplicate ("<name> copy", then selected), Rename (dialog, 1 to 64 characters after trimming), Export (opens the project with the export dialog), Pin/Unpin, and Delete, where Delete asks for confirmation in a dialog whose default focus is Cancel and then removes the project, its autosave snapshots and its home frames.

- **AC-UX-079.1** Given a preset selected, When home renders, Then no ⋯ button is present.
- **AC-UX-079.2** Given saved "Knight", When Delete is chosen and confirmed, Then the `projects`, `project-snapshots` and `home-frames` records of Knight are gone and the selection moves to the next character; When Cancel is chosen instead, Then nothing is removed.
- **AC-UX-079.3** Given unpinned "Knight" last in the saved group, When Pin is chosen, Then Knight moves to the pinned group at its edit-date position, stays selected, and the order persists after reload.

**REQ-UX-080 [P1]** THE SYSTEM SHALL produce lineup frames and avatars with the engine's `renderFrames` using the fixed home render profile (`HOME_RENDER_PROFILE`, Data & contracts: 64 px, `three-quarter` camera, direction `s`, clip `idle` at its manifest frame count and fps, default pipeline) plus one 64×64 head-and-shoulders avatar still, rendering one character at a time from the selected one outward, caching the result under a key derived from the canonical `CharacterSpec` JSON, the profile version and the pack versions, animating at most 7 lineup characters (the selected one ± 3), not drawing or decoding off-screen characters, and pausing playback while the page is hidden.

- **AC-UX-080.1** Given 30 saved characters, When home has been shown for 10 s, Then at most 7 lineup characters change pixels between two samples 200 ms apart and characters outside the visible row have no decoded frames.
- **AC-UX-080.2** Given cached frames for "Knight", When home reopens without any change to Knight, Then `renderFrames` is not called for Knight; When Knight's hair changed, Then it is called once.

**REQ-UX-081 [P1]** WHILE a character's frames are not ready THE SYSTEM SHALL show in its lineup position its cached avatar still, or for a preset its pack thumbnail (REQ-AST-015), or otherwise a skeleton placeholder, so the lineup never shows an empty slot.

- **AC-UX-081.1** Given a cold load of `#home` on a fresh profile, When first contentful paint occurs, Then every visible lineup position shows a preset thumbnail or a skeleton placeholder, and within 5 s on the reference machine the selected character is animated.

**REQ-UX-082 [P1]** THE SYSTEM SHALL persist home frames and avatars in the IndexedDB store `home-frames` and SHALL treat every stored record as untrusted: PNG magic bytes required, strip ≤ 512 KB and avatar ≤ 64 KB, decoded only with `createImageBitmap`, strip exactly (64 × `frameCount`) × 64 px with `frameCount` 1 to 32 and avatar exactly 64×64 px; IF a record fails THEN THE SYSTEM SHALL delete it, regenerate it, and show no error toast; preset and orphaned records are capped at 64, least recently used first; the store's bytes count in the "Projects and autosaves" line (REQ-UX-050).

- **AC-UX-082.1** Given a record whose strip is a 2 MB JPEG, When home reads it, Then it is deleted, regenerated, no toast appears, and a dev-mode console warning names the failed check.
- **AC-UX-082.2** Given 80 preset records, When a new one is written, Then 64 remain and the least recently used were removed.

**REQ-UX-083 [P1]** THE SYSTEM SHALL paint the home screen and the wizard without the engine chunk: on a cold load of `#home` or `#new`, the request for the engine chunk starts after first contentful paint (AC-GEN-007.3), and LCP stays ≤ 2.5 s (P-07).

- **AC-UX-083.1** Given a Chromium trace of cold loads of `#home` and of `#new`, When analysed, Then in both the engine chunk request starts after FCP and LCP ≤ 2.5 s.

**REQ-UX-084 [P1]** WHERE reduced motion is in effect (REQ-UX-038) THE SYSTEM SHALL move the home row to the new selection without a transition and show every lineup character as the still frame 0 of its idle frames.

- **AC-UX-084.1** Given `prefers-reduced-motion: reduce`, When the selection changes, Then the row has no transition or animation with duration > 0 and no lineup pixel changes over 2 s.

**REQ-UX-085 [P1]** WHILE no saved character exists THE SYSTEM SHALL show only the presets in the lineup, the text "No saved characters yet. Create one or start from a preset." next to the strip, and focus the "New character" tile on load; IF no preset can be loaded either THEN the lineup area shows that text and "New character" still works.

- **AC-UX-085.1** Given a fresh profile, When home loads, Then the lineup contains exactly the presets, the empty-state text is visible, and `document.activeElement` is the "New character" tile.

**REQ-UX-086 [P1]** WHEN the editor starts after an unclean shutdown THE SYSTEM SHALL show the REQ-UX-045 restore prompt as a dialog over the home screen before any project opens, also when the fragment is `#p=<id>`, and "Start without restoring" SHALL leave the user on the home screen.

- **AC-UX-086.1** Given an unclean shutdown and a load of `#p=<id>`, When the editor starts, Then the restore dialog is shown over home, and choosing "Start without restoring" shows home with the fragment `#home`.

**REQ-UX-087 [P2]** THE SYSTEM SHALL offer "Show home screen on startup" (default on) in Settings, and WHILE it is off, WHEN the editor loads with an empty fragment and at least one saved project exists THE SYSTEM SHALL open the most recently edited project in the last workspace; `#home` always shows home.

- **AC-UX-087.1** Given the setting off and saved projects, When `<basePath>/app/` loads, Then the most recently edited project opens; Given no saved project, Then home is shown.

**REQ-UX-088 [P3]** WHILE the window is narrower than 768 px THE SYSTEM SHALL show the home lineup, strip and a primary action "View" that opens the selected character in the REQ-UX-008 view-only layout, and hide "New character", "Random preset", the ⋯ menu and "Open file…".

- **AC-UX-088.1** Given a 390×844 viewport, When home loads, Then the primary action reads "View" and none of the hidden controls is in the DOM.

### New-character wizard

**REQ-UX-089 [P1]** WHEN the user opens `#new` (via the "New character" tile, `project.new` or the URL) THE SYSTEM SHALL show an eight-step wizard in this order: Style, Species, Body shape, Face, Hair, Outfit, Colors, Name and finish, with the live preview on the left (≈ 55 %) and the step panel on the right, stacked at 768 to 1023 px (REQ-UX-068).

- **AC-UX-089.1** Given Mod+Alt+N pressed in the editor, When the wizard opens, Then the heading reads "Step 1 of 8: Style" and the step list shows the eight titles in order.

**REQ-UX-090 [P1]** THE SYSTEM SHALL offer on the Style step the cards Realistic, Chibi, Stickman and Voxel (description "Blocky, built from cubes"; UI copy names no third-party game or trademark), write the choice to `CharacterSpec.style` (spec 001), and preselect Realistic.

- **AC-UX-090.1** Given the Style step, When Chibi is chosen and the wizard finishes, Then the saved spec has the Chibi `style` value defined by spec 001, and no UI string of the step contains "Minecraft".

**REQ-UX-091 [P1]** THE SYSTEM SHALL offer on the Species step the cards Human, Animal (described "Anthropomorphic animal") and Monster, write the choice to `CharacterSpec.species` (spec 001), and preselect Human.

- **AC-UX-091.1** Given the Species step, When Human is chosen, Then the draft's `species` is the Human value of spec 001.

**REQ-UX-092 [P1]** IF a style or species option ~~has no content in the loaded packs~~ is not available under the spec 001 REQ-CMP-045 gating rule (its pair with the draft's other current value is in `SUPPORTED_STYLE_COMBOS` **and** the loaded packs provide that pair's required content) (in M3: Stickman, Voxel, Animal, Monster; spec 013) THEN THE SYSTEM SHALL render its card with `aria-disabled="true"`, a visible "Coming soon" label and the accessible description "Coming soon. Available in a later update.", keep it reachable by arrow keys but not selectable, let Tab leave the group normally, never pick it in Randomize, and enable it without ~~code changes once a pack provides the content~~ UI code changes once both conditions hold. *(Amended 2026-10-09, PM gating decision: one rule for the wizard and the editor pickers, defined in spec 001 REQ-CMP-045 and referenced by spec 013 REQ-STY-029.)*

- **AC-UX-092.1** Given the Style step with focus on Chibi, When → is pressed, Then focus is on Stickman, the description is announced, Space does not select it, and Tab moves focus out of the group.
- **AC-UX-092.2** Given ~~a fixture pack that provides Stickman content~~ a test build whose `SUPPORTED_STYLE_COMBOS` contains `stickman`/`human` and a loaded fixture pack that provides `presets/styles/stickman.json`, When the wizard opens with species Human, Then Stickman is enabled and selectable. *(Amended 2026-10-09, PM gating decision.)*
- **AC-UX-092.3** Given a test build whose `SUPPORTED_STYLE_COMBOS` contains `stickman`/`human` but no loaded pack provides `presets/styles/stickman.json`, When the Style step renders, Then Stickman has `aria-disabled="true"` and the "Coming soon" label; Given the fixture pack loaded but `stickman`/`human` not in `SUPPORTED_STYLE_COMBOS`, Then Stickman is also disabled. *(Added 2026-10-09, PM gating decision.)*

**REQ-UX-093 [P1]** THE SYSTEM SHALL offer on the Body shape step ~~4 to 6 anatomy preset cards (spec 002 REQ-ANA-013, those valid for the chosen style)~~ one card per body-shape preset (spec 002 REQ-ANA-022, menu order; six in M3), applied relative to the base anatomy of the style chosen on step 1 (spec 002 REQ-ANA-023), with a still image and a name, and no sliders. *(Amended 2026-10-09 (M3-00), PM decision on plan question Q3: body shapes, not anatomy presets; body shapes are relative, so every card is valid for every style.)*

- **AC-UX-093.1** ~~Given the Body shape step, When rendered, Then it shows between 4 and 6 cards, no `slider` role, and choosing `heroic` sets the draft's nine anatomy values to that preset.~~ Given the Body shape step after Realistic was chosen on step 1, When rendered, Then it shows the six cards Average, Slim, Athletic, Stocky, Tall and Petite in that order, no `slider` role, and choosing `athletic` sets the draft's nine anatomy values to the `athletic` row of spec 002 REQ-ANA-022 (the Realistic base is all 1.00); Given Chibi chosen on step 1, When `petite` is chosen, Then the draft's `height` is 0.80 (AC-ANA-023.3). *(Amended 2026-10-09 (M3-00), PM decision Q3.)*

**REQ-UX-094 [P1]** THE SYSTEM SHALL build the Face, Hair, Outfit and Colors steps from the Easy option-tile groups (REQ-UX-061) and swatch row (REQ-UX-062) of the matching Easy categories, with the same keyboard model and accessible names.

- **AC-UX-094.1** Given the Hair step, When the tile groups are inspected, Then their roles, names and key handling equal those of the Easy Hair tab for the same draft.

**REQ-UX-095 [P1]** THE SYSTEM SHALL show "Step n of 8: <title>" on every step, move focus to that heading (`tabindex="-1"`) on each step change so it is announced, mark the current step with `aria-current="step"`, offer Back (all choices kept, absent on step 1), Next (keeps the step's choices) and Skip (resets the step's fields to their values at wizard start, then advances; absent on step 8).

- **AC-UX-095.1** Given Hair chosen on step 5, When Back is pressed twice and Next twice, Then step 5 shows the same hair selected.
- **AC-UX-095.2** Given a hair chosen on step 5, When Skip is pressed, Then the draft's hair equals the starting draft's hair and step 6 is shown with focus on its heading.

**REQ-UX-096 [P2]** THE SYSTEM SHALL offer a Randomize button on steps 1 to 7 that randomizes only that step's fields with a fresh seed (REQ-CMP-018), choosing only enabled options, swatch-set tints and preset anatomy. *(Amended 2026-10-09 (M3-00), Q3: on the Body shape step, "preset anatomy" is one of the body-shape cards of REQ-UX-093.)*

- **AC-UX-096.1** Given the Outfit step, When Randomize runs 20 times, Then only the outfit slots and their tints may differ from before.
- **AC-UX-096.2** Given the Style step with Stickman and Voxel disabled, When Randomize runs 100 times, Then the chosen style is always Realistic or Chibi.

**REQ-UX-097 [P1]** THE SYSTEM SHALL keep a large preview of the draft character visible on every wizard step at ≥ 768 px, showing at first paint a still image of the starting draft (its preset thumbnail, REQ-AST-015) and replacing it with the live engine preview (REQ-UX-057, REQ-UX-058) as soon as the engine is ready, and SHALL show each choice within 150 ms once live (REQ-UX-067).

- **AC-UX-097.1** Given a cold load of `#new`, When first contentful paint occurs, Then the preview shows a character image (not empty), and on the reference machine the live preview replaces it within 5 s.

**REQ-UX-098 [P1]** WHEN the user presses Escape (`wizard.exit`), activates Close, or navigates Back out of the wizard THE SYSTEM SHALL return to the home screen directly if the draft equals the starting draft, and otherwise ask "Discard this character?" in a dialog with "Discard" and "Keep editing" (default focus) and return home only on Discard; nothing is saved.

- **AC-UX-098.1** Given no change, When Escape is pressed, Then home is shown and no dialog appeared.
- **AC-UX-098.2** Given a hair chosen, When Escape is pressed and then "Keep editing", Then the wizard stays on the same step with the choice kept; When Escape and "Discard" follow, Then home is shown and no project was created.

**REQ-UX-099 [P1]** WHEN the user activates Finish on step 8 THE SYSTEM SHALL create a `ProjectDocument` with the draft `CharacterSpec`, the name from the step's field (trimmed, 1 to 64 characters, "Untitled character" if empty) and default render settings, save it (REQ-UX-025) within 500 ms, set the fragment to `#p=<id>`, and open it in the last workspace (Easy by default) with an empty history.

- **AC-UX-099.1** Given a fresh profile and the name "  Mira  ", When Finish is activated, Then within 500 ms a project "Mira" is in IndexedDB, it opens in Easy, and Undo is disabled.

**REQ-UX-100 [P1]** THE SYSTEM SHALL hold the wizard state only as an in-memory draft `CharacterSpec` (spec 001 schema, including `style` and `species`), with every choice writing the same fields the editor writes, no wizard-only persisted fields, and no autosave of the draft (a reload on `#new` restarts at step 1).

- **AC-UX-100.1** Given a finished wizard, When the saved spec is validated, Then it passes the `CharacterSpec` schema and has no keys beyond it.

### Accessibility of home, wizard and Easy

**REQ-UX-101 [P1]** THE SYSTEM SHALL make the home screen, the wizard, the Easy tile groups and the Easy swatch rows fully operable by keyboard, with the focus indicator of REQ-UX-036.

- **AC-UX-101.1** Given keyboard-only use on a fresh profile, When the user starts the wizard from home, makes a choice on every step, finishes, changes a tile and a swatch in Easy, switches to Pro and returns home, Then the flow completes without a pointer (E2E).

**REQ-UX-102 [P1]** THE SYSTEM SHALL have zero axe-core A/AA violations, text contrast ≥ 4.5:1 in both themes (including name tags and "Coming soon" labels), and a non-empty, human-readable accessible name (never a file name or ID) for every tile, card, swatch and avatar in these states: home (saved characters, empty state, ⋯ menu open, delete dialog), each wizard step, the discard dialog, and each Easy tab.

- **AC-UX-102.1** Given each listed state, When axe-core runs in Playwright, Then 0 violations are reported.
- **AC-UX-102.2** Given each listed state, When every element with role `option`, `radio` or `button` in the tile, card, swatch and avatar groups is inspected, Then its accessible name is non-empty and does not match `/\.(glb|png|webp)$|^builtin:|^user:/`.

### M3 home presets (PM decision 2026-10-09)

**REQ-UX-103 [P1]** THE SYSTEM SHALL ship in M3 at least 6 built-in home presets (REQ-UX-072) whose body and every part reference resolve only to parts of the bundled packs `quaternius-ubc` (bodies, hair, eyebrows) and `quaternius-outfits` (the peasant and ranger outfits, male and female), with `species` `human` and a `style` whose pair is available (spec 001 REQ-CMP-045), each named with a unique role-style name that matches the outfit it wears (for example Ranger, Wanderer, Villager, Scout); the exact list is preset data owned by asset-pipeline-engineer (spec 001 REQ-CMP-027, P-11), not part of this spec.

- **AC-UX-103.1** Given the shipped M3 preset data, When validated, Then there are at least 6 presets, every `body.ref` and `parts.*.ref` starts with `builtin:quaternius-ubc/` or `builtin:quaternius-outfits/`, every outfit part ID contains `peasant` or `ranger`, every preset has `species: 'human'` and an available pair, and the names are unique, non-empty and not file names or IDs (AC-UX-102.2 pattern).
- **AC-UX-103.2** Given the shipped M3 preset data and a table that maps each preset name to the outfit family it claims (ranger or peasant), When validated, Then every preset's outfit parts belong to the family its name claims (for example no "Ranger" preset in a peasant outfit).

## Edge cases

- Easy preview at direction `ne` and the project exports 4 directions → Pro shows the same yaw; Pro's `[` / `]` then step to the adjacent direction of the export set (spec 003).
- A project whose body has no compatible part for an Easy slot → the group shows only "None" (optional slot) or the current part as "Custom" (required slot).
- Workspace switch during an uncached part load → the load continues; the new workspace shows the busy state of REQ-UX-067.
- Fragment changed by hand while the wizard has changes → the wizard stays, the fragment is restored to `#new`, and the discard dialog of REQ-UX-098 opens.
- Two tabs on home, one deletes a character → the other tab's lineup drops it on the next `projects` change event; opening it shows `UX_PROJECT_NOT_FOUND` (REQ-UX-069).
- Pack update changes a preset or part → the frame cache key changes and frames are regenerated (REQ-UX-080); stale records age out (REQ-UX-082).
- Clip `idle` missing from all loaded packs → lineup frames use one frame of the rest pose (`frameCount` 1).
- 200 saved characters → strip and lineup stay virtualized; only visible avatars are decoded (REQ-UX-080).
- Style or species pair supported by the engine but its content pack not loaded (or the reverse) → the wizard card shows "Coming soon" (REQ-UX-092, spec 001 REQ-CMP-045). *(Added 2026-10-09, PM gating decision.)*
- Preset or opened project whose pair is unavailable → the preview falls back and export is blocked (spec 001 REQ-CMP-043, REQ-CMP-044); Easy shows the stored values unchanged (REQ-UX-055).

## Data & contracts

`EasyCategoryId`, `UiPrefs`, `HistoryEntry` and `ShortcutScope` are defined in spec 009 Data & contracts.

```ts
/** View selected by the URL fragment (REQ-UX-069). */
export type ViewRoute =
  | { readonly view: 'home' }                                  // '#home', '' (startup rule), unknown
  | { readonly view: 'wizard' }                                // '#new'
  | { readonly view: 'project'; readonly projectId: string }   // '#p=<id>', id /^[A-Za-z0-9_-]{1,64}$/
  | { readonly view: 'share'; readonly payload: string };      // '#c=…' (REQ-CMP-025)

/** Data file mapping an Easy category to document fields (REQ-UX-060). */
export interface EasyCategoryDef {
  readonly format: 'sprite-easy-category';
  readonly version: 1;
  readonly id: EasyCategoryId;
  readonly labelKey: string;          // i18n key, e.g. 'ux.easy.hair'
  readonly icon: string;              // icon id from the bundled icon set
  readonly slots: readonly string[];  // slot ids from the slot registry (spec 001), group order
  readonly tintChannels: readonly string[];
  /** True only for 'body': show the Shape group. Amended 2026-10-09 (M3-00, Q3): the group lists
   *  body-shape presets (spec 002 REQ-ANA-022), not anatomy presets; the field name is kept. */
  readonly anatomyPresets: boolean;
}

/** Data file of swatches for one or more tint channels (REQ-UX-062). */
export interface SwatchSetDef {
  readonly format: 'sprite-swatch-set';
  readonly version: 1;
  readonly id: string;
  readonly channels: readonly string[];
  /** 4 to 24 entries; `nameKey` resolves to the spoken color name. */
  readonly swatches: ReadonlyArray<{ readonly hex: string; readonly nameKey: string }>;
}

/**
 * Added 2026-10-09 (M3-00), PM decision Q4. Built-in character preset file in a pack's
 * `presets/` folder (spec 011 output layout; REQ-UX-072, -078, -103; spec 001 REQ-CMP-027). Validated by
 * `characterPresetSchema` in `@csg/parts-schema` (`packages/parts-schema/src/presets.ts`, plan row
 * M3-01). Strict object; `character` is migrated forward like any CharacterSpec (AC-CMP-049.2).
 */
export interface CharacterPreset {
  readonly format: 'sprite-character-preset';
  readonly version: 1;
  readonly id: string;                 // [a-z0-9-]{1,32}, unique per pack
  readonly name: string;               // display name, e.g. "Ranger" (REQ-UX-103)
  readonly character: CharacterSpec;   // spec 001
  /** Optional. Sets `render.camera.preset` of a project started from this preset (REQ-UX-078).
   *  Absent = 'side'. 'custom' is not allowed (it needs angles a preset does not carry). */
  readonly camera?: 'side' | 'three-quarter' | 'isometric';
}

/** Fixed render profile for home frames (REQ-UX-080). A change bumps `version`. */
export const HOME_RENDER_PROFILE = {
  version: 1,
  resolution: 64,
  camera: 'three-quarter',
  direction: 's',
  clip: 'idle',       // frame count and fps from the clip manifest
  avatarSize: 64,     // head-and-shoulders still
  pipeline: 'default',
} as const;

/** Record of the IndexedDB store 'home-frames' (REQ-UX-082); validated on every read. */
export interface HomeFramesRecord {
  readonly format: 'sprite-home-frames';
  readonly version: 1;
  /** Lowercase hex SHA-256 of canonical CharacterSpec JSON + '\n' + profile version + '\n' + sorted 'packId@version' list. */
  readonly key: string;
  readonly frameCount: number;  // 1..32
  readonly fps: number;         // 1..30
  readonly strip: Blob;         // PNG, (64 × frameCount) × 64 px, ≤ 512 KB
  readonly avatar: Blob;        // PNG, 64 × 64 px, ≤ 64 KB
  lastUsed: number;             // epoch ms, LRU bookkeeping only (never in exports, P-04)
}

/** Home-screen metadata kept beside each project record in the 'projects' store (REQ-UX-072, -079). */
export interface ProjectListMeta {
  readonly projectId: string;
  name: string;               // 1..64 chars, rendered as text only
  lastEditedAt: number;       // epoch ms
  pinned: boolean;
  homeFramesKey?: string;
}
```

Error codes owned here (UX prefix, listed with the spec 009 codes): `UX_PROJECT_NOT_FOUND`
(warning, REQ-UX-069; added 2026-10-09).

IndexedDB store owned here: `home-frames` (REQ-UX-082, added 2026-10-09), in the database `csg` of
spec 009. The `projects` store of spec 009 also holds `ProjectListMeta` beside each project.

Data files (P-11): `EasyCategoryDef` and `SwatchSetDef` JSON live in a pack's `presets/` folder
(spec 011 output layout) and are validated with Zod on load; an invalid file is skipped with a
dev-mode warning.

## Non-functional

- Performance (P-07, added 2026-10-09): home and wizard code is outside the engine chunk (REQ-UX-083); Easy and Pro panels are separate lazy chunks; the home row slide and lineup playback keep p95 frame time ≤ 16.7 ms with 30 saved characters on the reference machine; home-frame generation renders one character at a time and yields between characters so input latency stays ≤ 100 ms.
- Privacy (P-03): home frames, avatars and project metadata stay in IndexedDB; nothing is uploaded.
- Accessibility (P-06): WCAG 2.2 AA, including SC 2.5.7 and 2.5.8; axe-core in CI (REQ-UX-102).
- Determinism (P-04): `lastUsed` and `lastEditedAt` are bookkeeping metadata and never enter exports.

## Open questions

- Resolved 2026-10-09: the home screen visual design follows the user's reference image (a game lobby with a character lineup, a still avatar strip and a bottom-center primary action), REQ-UX-071 to REQ-UX-075.
- Resolved 2026-10-09 (PM): gating of style and species options. An option is enabled only when its pair is in `SUPPORTED_STYLE_COMBOS` and the loaded packs provide the pair's required content (spec 001 REQ-CMP-045, amended); REQ-UX-092 and spec 013 REQ-STY-029 refer to that one rule.
- ~~[NEEDS CLARIFICATION: The Easy workspace shows the workspace toggle twice, in the top bar and the bottom bar, as decided by the user. Two identical controls are allowed by WCAG but add noise for screen-reader users; keep both? Owner: user, pending the mockup review.]~~ Resolved 2026-10-09 (PM, after the user approved the mockup): the toggle lives only in the top bar, plus `Mod+Alt+P` and the command palette (REQ-UX-053, REQ-UX-064 amended).
- ~~[NEEDS CLARIFICATION: Which character presets ship as the ≥ 6 home presets for M3, and which of them are Chibi? Owner: asset-pipeline-engineer with the user (spec 011 / 001 preset data), pending the mockup review.]~~ Resolved 2026-10-09 (PM): the spec states the rule (REQ-UX-103: at least 6 presets from the bundled `quaternius-ubc` and `quaternius-outfits` peasant/ranger parts, role-style names true to the outfit); the exact list, including which presets use Chibi, is data owned by asset-pipeline-engineer.
- Resolved 2026-10-09 (PM): the onboarding tour (REQ-UX-010, spec 009) is Pro-only in M3; an Easy tour variant is deferred to the P3 backlog.
- Resolved 2026-10-09 (PM, after the user approved the mockup): visual direction, see Layout › Visual direction.
- Resolved 2026-10-09 (PM, plan question Q3, recorded in M3-00): the Easy Shape group (REQ-UX-063) and the wizard Body shape step (REQ-UX-093) show the six body-shape presets of spec 002 REQ-ANA-022, applied relative to the style's base anatomy (REQ-ANA-023), not the anatomy presets of REQ-ANA-013. AC-UX-063.2 and AC-UX-093.1 amended.
- Resolved 2026-10-09 (PM, plan question Q4, recorded in M3-00): a `CharacterPreset` may carry `camera`; when set, it sets `render.camera.preset` of a project started from that preset (REQ-UX-078 amended, AC-UX-078.3), which is how the presets cover side and top-down cameras (REQ-UX-072, AC-UX-072.2).
- ~~[NEEDS CLARIFICATION: (added 2026-10-09, M3-00) spec 001 REQ-CMP-027 and AC-CMP-049.2 describe a pack preset file as a bare `CharacterSpec`, while `CharacterPreset` here (and plan contract C1) wraps it with `format`, `id`, `name` and `camera`. Proposal: spec 001 adopts the wrapper, and AC-CMP-049.2 reads "a pack preset file whose `character` is a version-1 `CharacterSpec`". Owner: spec-writer for spec 001 (outside the M3-00 edit scope). Non-blocking: M3-01 implements the wrapper as in C1.]~~ Resolved 2026-10-09 (PM): spec 001 REQ-CMP-027 and AC-CMP-049.2 adopt the wrapper.

## References

- Spec 009 (shell, shortcut registry, history, persistence, recovery; the source of this split, 2026-10-09)
- Spec 001 (`CharacterSpec` v2 `style` / `species`, presets, randomize, REQ-CMP-043 to REQ-CMP-045 gating), spec 002 (anatomy presets), spec 003 (`DIRECTION_ORDER`, `renderFrames`), spec 011 (thumbnails REQ-AST-015), spec 013 (M3.5 style/species content)
- User decisions 2026-10-09 (M3 scope: workspaces, Easy, home screen, wizard) and the home screen reference image (game lobby lineup), relayed by the coordinator
- PM decisions 2026-10-09 (gating rule, unsupported-value fallback, workspace toggle placement, Pro-only tour, M3 preset rule, visual direction), relayed by the coordinator
- M3 mockup approved by the user 2026-10-09 (design reference, not loaded by the app): https://claude.ai/artifact/LFES7m68SjccjgsxBajTSz
- WAI-ARIA APG Listbox, Radio Group, Menu Button and Carousel patterns: https://www.w3.org/WAI/ARIA/apg/patterns/ (accessed 2026-10-09)
- WCAG 2.2 SC 2.5.8 Target Size (Minimum) and SC 2.3.3 / `prefers-reduced-motion`: https://www.w3.org/TR/WCAG22/ (accessed 2026-10-09)
