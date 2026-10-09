---
title: Save, load and share
description: How autosave, crash recovery and version restore work, how to save and open project and character files, and how share links stay local.
---

# Save, load and share

Your work is saved in this browser. Nothing is sent to a server when you save, load, open or share a character. There are three kinds of saved files and one kind of link:

- A **project** holds everything in the editor: the character, the render settings, the animations and the graphs. The editor saves projects automatically in this browser.
- A **project file** (`<name>.csgproj.json`) is a copy of one project that you download.
- A **character file** (`<name>.character.json`) holds only the character: its body, parts, colors, proportions and seed.
- A **share link** carries one character inside the web address.

## Projects save automatically

- Your project is saved in this browser about two seconds after your last change. If you keep editing, it is saved at least every ten seconds.
- Press `Ctrl / Cmd+S` to save now. The top bar shows **Saved** when the save finishes.
- The top bar shows the save state as text: **Saved**, **Saving…**, **Unsaved changes** or **Save failed — Retry**.
- The editor keeps the ten most recent autosave versions of each project. Open **File › Restore version** to go back to one of them.
- If a save fails, the top bar shows **Save failed — Retry**. Choose **Retry**. If it keeps failing, download a project file as a backup, and free some browser storage.
- The storage display counts your projects and their autosave versions together, under "Projects and autosaves".

Closing the tab while a save is pending asks you to confirm. When everything is saved, the tab closes without a prompt.

## Crash recovery

If the editor or the browser closes unexpectedly, the next time you open the editor it asks "Restore your last session?". The prompt shows the project name and the time of the last autosave.

- **Restore** opens the autosave, which is the state just before the crash.
- **Start without restoring** opens the home screen. Your autosave is kept, and you can find it under **File › Restore version**.

The editor never restores your work without asking. It checks the saved data first. If the data is damaged, it shows the first problem and offers **Start without restoring**.

## Download a project file

- Press `Ctrl / Cmd+Shift+S` to download the project as `<name>.csgproj.json`.
- Choose **Open file…** on the home screen, or press `Ctrl / Cmd+O` in the editor, to open a project file. The editor checks it first.
- If the file is not valid, the editor says what is wrong and shows the first problem. Your current project does not change.

Project files are a good backup. Keep one copy for each important character.

## Save and load a character file

- In Pro, the part library has a **Character file** menu. Choose **Save** to download `<name>.character.json`. The file lists keys in a fixed order, so saving the same character twice gives the same file.
- Choose **Load** and pick a character file. It replaces the character in the current project. One undo brings the old character back.

The editor will not open a file that is:

- not valid JSON, or not a character file;
- too large (the limit is 1 MB);
- made with a newer version of the editor.

If a file uses a built-in part that is no longer available, the rest of the character still loads. That slot is left empty, and a notice names the missing part.

If a file uses one of your uploaded models and that model is not in your library, the slot shows **Missing asset**. See [Custom models](../custom-models/index.md).

## Share links

A share link holds one character in the web address, after the `#c=` part. Nothing is stored on a server.

- **Copy share link** copies the link for the current character.
- When someone opens a share link, the editor asks you to confirm first. It then opens the character as a new project. It never replaces the project you have open.
- Only built-in parts are included. Parts you uploaded are left out, and the editor warns you before it copies the link.

Share links are local. The editor does not contact a server to make or open one.

## Two tabs, one project

If the same project is open in a second tab, the second tab opens it read-only and shows a banner. Choose **Take over editing** in the banner to edit there instead. The first tab then becomes read-only.

<!-- TODO(screenshot): top bar showing the Saved status and the Restore version list -->

<!-- spec: REQ-CMP-022 -->
<!-- spec: REQ-CMP-023 -->
<!-- spec: REQ-CMP-024 -->
<!-- spec: REQ-CMP-025 -->
<!-- spec: REQ-CMP-026 -->
<!-- spec: REQ-CMP-035 -->
<!-- spec: REQ-UX-025 -->
<!-- spec: REQ-UX-026 -->
<!-- spec: REQ-UX-027 -->
<!-- spec: REQ-UX-028 -->
<!-- spec: REQ-UX-029 -->
<!-- spec: REQ-UX-030 -->
<!-- spec: REQ-UX-045 -->
<!-- spec: REQ-UX-050 -->
