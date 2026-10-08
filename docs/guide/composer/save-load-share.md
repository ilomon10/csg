---
title: Save, load and share
description: Save a character as a file, load it again, understand what happens when a file has missing parts, and find out how projects autosave.
---

# Save, load and share

There are two kinds of saved files:

- A **character file** (`<name>.character.json`) holds one character: its body, parts, tints, proportions and seed.
- A **project file** (`<name>.csgproj.json`) holds everything in the editor: the character, render settings, animations and shader graphs.

## Save a character

Choose **Save character** from the **File** menu. The browser downloads a file named after the character. For example, a character called "Hero #1" is saved as `hero-1.character.json`.

Saving the same character twice produces identical files, so you can compare them or keep them in version control.

## Load a character

Choose **Open** and pick a character file. The file replaces the current character, and one undo brings the previous one back.

The editor refuses a file and leaves your current character unchanged when:

- the file is not valid JSON, or it is not a character file;
- the file is larger than 1 MB;
- the file was made with a newer version of the editor.

When a file uses a built-in part that is no longer available, the rest of the character still loads. That slot is left empty, and a notice names the missing part.

When a file uses one of your uploaded models that is not in your library, the slot shows **Missing asset**. See [Custom models](../custom-models/index.md).

## Projects save automatically

- Your project is saved in this browser about two seconds after your last change.
- Press `Ctrl+S` to save now. The top bar shows **Saved** when the save finishes.
- If a save fails, the top bar shows **Save failed** with a retry button. Use the download option as a backup.
- If the editor closes unexpectedly, it offers to restore your last session next time you open it.
- The editor keeps the ten most recent autosaves for each project.

Project files are local. Nothing is sent over the network when you save, load or open a project.

> [!NOTE]
> **Planned.** Sharing a character as a link is planned for a later release. The link will hold the character inside the URL, so nothing is stored on a server. Parts you uploaded are left out of shared links, and the editor warns you first.

<!-- TODO(screenshot): top bar showing the Saved status and the save menu -->

<!-- spec: REQ-CMP-022 -->
<!-- spec: REQ-CMP-023 -->
<!-- spec: REQ-CMP-024 -->
<!-- spec: REQ-UX-025 -->
<!-- spec: REQ-UX-026 -->
<!-- spec: REQ-UX-045 -->
