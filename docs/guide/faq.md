---
title: Frequently asked questions
description: Short answers to common questions about privacy, browsers, saving work, exports, licenses, engines and custom models.
---

# Frequently asked questions

## Do I need an account?

No. The editor has no accounts, no sign-in and no subscription. Your characters and projects live in your browser.

## Is my work uploaded anywhere?

No. Your projects, characters, uploaded models and exports stay on your device. The editor makes no network request that carries your files or your project data.

## Which browsers work?

The latest stable versions of Chrome, Edge, Firefox and Safari on a desktop or laptop. See [System requirements](./getting-started/system-requirements.md).

## Does it work offline?

You need a connection to open the editor the first time. Working offline after that is planned for a later release.

## Is it free?

Yes. The editor is free and open source. The bundled characters, parts and animations are CC0, so you can use them in commercial games without credit, although the export still lists them.

## Can I use my sprites in a commercial game?

For the bundled assets, yes. For your own uploads, it depends on the license you recorded. The editor warns you before an export if a license is unknown, non-commercial or share-alike. See [Credits and licensing](./export/credits-and-licensing.md).

## Why does my export look slightly different on another computer?

Exports depend on the renderer. WebGPU and the WebGL2 fallback can differ by a few pixels. The export records which renderer made it, and the same settings on the same renderer give identical files.

## Why is a part missing from the picker?

The part probably does not fit the body you chose. Turn on **Show incompatible** to see it, greyed out, with the reason. See [Parts and slots](./composer/parts-and-slots.md).

## Why are some animations missing?

Clips must use the same skeleton as your character. A clip on another skeleton is hidden. Turn on **Show incompatible** to see it, with the reason "Different skeleton".

## My changes disappeared. What happened?

Projects save automatically in your browser. Check the save status in the top bar. If the editor closed unexpectedly, it offers to restore your last session when you open it again. You can also restore an earlier autosave. See [Save, load and share](./composer/save-load-share.md).

## Why does my character look a different size in the game?

With **Auto** framing, the editor scales the character to fill the frame, so its size depends on its pose. Set a fixed framing scale in the **Render** tab to keep every character at the same scale. See [Camera styles](./render-settings/camera-styles.md).

## Can I use the sprites in Godot, Phaser or Unity?

Yes. Any engine that reads a PNG sheet and its frame rectangles can use an export. A Phaser loader works with the Aseprite-style JSON today. Godot and other engine files are planned. See [Using sprites in game engines](./export/using-in-game-engines.md).

## Can I make new animations in the editor?

No. The editor plays the built-in clips. To make new animation, use Blender. Uploading your own animation clips is planned for a later release. See [Custom models](./custom-models/index.md).

## Does the editor use AI to make sprites?

No. Every frame is rendered from 3D parts that you choose and arrange.

## Can I share a character with someone?

Yes. Save the character file and send it to them. They open it with **Open** in their editor. A share link that keeps the character inside the URL is planned for a later release.
