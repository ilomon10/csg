---
title: Troubleshooting
description: Fix common editor problems, including graphics and browser issues, export limits, missing assets, lost work, and every upload error code.
---

# Troubleshooting

Find your problem below. Each entry names the error code you may see, so you can search this page for it.

## The editor will not start, or shows "No GPU"

The editor needs WebGPU or WebGL2. Update your browser to the latest stable version, and make sure hardware acceleration is turned on in its settings. Then reload the page. See [System requirements](./getting-started/system-requirements.md).

## The viewport is blank

- Wait a few seconds. A character preview can take up to five seconds to appear after you open a project or start from a preset.
- If the badge in the top bar reads **Renderer restarting**, the graphics device was reset. The editor recovers on its own within a few seconds, and your project is not changed.
- If the viewport still does not render, reload the page. Your project is restored from the last autosave.

## A panel says "This panel stopped working"

Only that panel has failed. Choose **Reload panel**. The rest of the editor keeps working, and the panel reopens with your current project. If it happens again, use **Copy diagnostic report** and include it when you ask for help.

## Export is refused: "too large"

A sheet must be no larger than 8192 pixels in either direction, and the export can have no more than 4096 frames or 512 MB of image data. To fix it, choose fewer scales, a layout with fewer columns, the strip layout, or fewer directions. See [Sheet layouts](./export/sheet-layouts.md).

## Export shows a license warning

The dialog lists the assets with an unknown, non-commercial or share-alike license. Read the license, then confirm to export, or cancel and change the asset. See [Credits and licensing](./export/credits-and-licensing.md).

## Export shows "EXP_LARGE_TEXTURE"

The sheet is wider or taller than 4096 pixels. The export still runs. Some engines and phones cannot load textures that large, so reduce the scale or the number of columns if your engine has a limit.

## A part or prop shows "Missing asset"

Your project uses an uploaded model that is not in your library. This can happen if you open a project on another browser, or if you deleted the model. Choose **Import file** to upload it again, **Replace with library asset** to pick another model, or **Remove from character** to clear the slot. Export stays blocked until every missing asset is resolved.

## "Save failed" appears in the top bar

The browser refused to save the project, often because storage is full or private browsing is on. Choose **Retry**. If it keeps failing, use the download option to save a project file, and free some browser storage before you continue.

## My work is gone after a crash

When you open the editor again, it asks "Restore your last session?". Choose **Restore** to get back your latest autosave. If you discard it, the autosave stays available under the version history.

## A character file will not open

- The file may not be a character file, or it may be damaged. Open it in a text editor and check that it starts with `{`.
- The file may be larger than 1 MB, or it may come from a newer version of the editor.
- If a part from a built-in pack is no longer available, the rest of the character still loads, and the slot is left empty.

## Upload error codes

When an upload fails, the wizard shows the code, a message and a hint. Codes starting with `UPL_W_` are warnings. They do not stop the upload.

| Code                         | Message                                                                            | How to fix                                              |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `UPL_UNSUPPORTED_FORMAT`     | `{file}` isn't a supported format. Use GLB, glTF, VRM, FBX (beta) or OBJ.          | Export as GLB from your 3D tool.                        |
| `UPL_MAGIC_MISMATCH`         | `{file}` doesn't look like a real `{format}` file.                                 | Re-export the file. Don't just rename it.               |
| `UPL_TOO_LARGE`              | These files are `{size}` MB. The limit is 50 MB.                                   | Compress textures, or use Draco or Meshopt compression. |
| `UPL_TOO_MANY_FILES`         | `{count}` files selected. The limit is 64 per upload.                              | Pack the model into a single GLB file.                  |
| `UPL_MISSING_RESOURCE`       | `{file}` needs `{resource}`, which wasn't included.                                | Select or drop the whole folder.                        |
| `UPL_EXTERNAL_URI`           | `{file}` links to `{uri}`. Files outside your upload aren't loaded.                | Embed the textures, for example by exporting as GLB.    |
| `UPL_VALIDATOR_ERROR`        | The glTF validator found `{count}` errors, first: `{code}` at `{pointer}`.         | Fix the export, or run the file through glTF Transform. |
| `UPL_PARSE_FAILED`           | `{file}` couldn't be read.                                                         | Re-export from your 3D tool.                            |
| `UPL_TIMEOUT`                | Reading the file took longer than 20 seconds and was stopped.                      | Reduce the file size or complexity.                     |
| `UPL_WORKER_CRASHED`         | The importer stopped unexpectedly.                                                 | Try again. If it repeats, note the file type.           |
| `UPL_FBX_VERSION`            | FBX version `{version}` isn't supported (needs binary 6400+ or ASCII 7.0+).        | Convert to GLB in Blender.                              |
| `UPL_DECODER_UNAVAILABLE`    | The `{decoder}` decoder isn't available offline yet.                               | Go online once, then try again.                         |
| `UPL_BUDGET_TRIS`            | `{count}` triangles; the limit for a `{kind}` is `{limit}`.                        | Simplify the mesh.                                      |
| `UPL_BUDGET_TEXTURES`        | `{count}` textures; the limit is 8.                                                | Combine textures into an atlas.                         |
| `UPL_TEXTURE_TOO_LARGE`      | Texture `{name}` is `{w}`×`{h}`; the limit is 2048 px per side.                    | Resize the texture.                                     |
| `UPL_BUDGET_BONES`           | `{count}` bones; the limit is 128.                                                 | Remove helper or hair bones.                            |
| `UPL_BUDGET_MATERIALS`       | `{count}` materials; the limit is 16.                                              | Merge materials.                                        |
| `UPL_BUDGET_MORPHS`          | `{count}` morph targets; the limit is 64.                                          | Remove unused shape keys.                               |
| `UPL_BUDGET_CLIPS`           | `{count}` clips (longest `{seconds}` s); limits are 64 clips and 120 s.            | Split the file.                                         |
| `UPL_MEMORY_ESTIMATE`        | This model would need about `{mb}` MB of memory; the limit is 256 MB.              | Reduce geometry and textures.                           |
| `UPL_NO_MESH`                | `{file}` has no mesh to use as a `{kind}`.                                         | Choose animation clip, or include a mesh.               |
| `UPL_NO_SKELETON`            | `{file}` has no skeleton, so it can't be a `{kind}`.                               | Upload it as a static prop, or add a rig.               |
| `UPL_BONE_MAP_INCOMPLETE`    | Required bones not mapped: `{bones}`.                                              | Map them in the list.                                   |
| `UPL_BIND_POSE_MISMATCH`     | This part's skeleton doesn't match the base skeleton (`{bones}`).                  | Re-skin the part to the base skeleton in Blender.       |
| `UPL_LICENSE_INCOMPLETE`     | Fill in license, author and confirm your rights.                                   | Complete the license fields.                            |
| `UPL_QUOTA_EXCEEDED`         | Not enough browser storage: need `{need}` MB, `{free}` MB free.                    | Delete unused assets, or export your library.           |
| `UPL_STORAGE_UNAVAILABLE`    | This browser can't store files here. Uploads will be lost when you close this tab. | Use a normal window, not a private one.                 |
| `UPL_ASSET_MISSING`          | `{count}` uploaded assets used by this project aren't in your library.             | Import the files, or replace them.                      |
| `UPL_LIBRARY_IMPORT_INVALID` | `{file}` isn't a valid library archive: `{reason}`.                                | Export the library again.                               |
| `UPL_W_INFLUENCES_PRUNED`    | `{count}` vertices had more than 4 bone influences. The extras were removed.       | Nothing to fix. This is a warning.                      |
| `UPL_W_BLEND_TO_MASK`        | Transparent materials were converted to cut-out (alpha 0.5).                       | Nothing to fix. This is a warning.                      |
| `UPL_W_FBX_BETA`             | FBX support is in beta. For best results convert to GLB in Blender.                | Nothing to fix. This is a warning.                      |

## Other error codes

| Code                  | What it means                                                           | How to fix                                                      |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `EXP_TOO_LARGE`       | The sheet or export is over a limit.                                    | See "Export is refused" above.                                  |
| `EXP_DOWNLOAD_FAILED` | The browser blocked the download, or storage is full.                   | Allow downloads for this site, then try again. Nothing is lost. |
| `EXP_CANCELLED`       | You cancelled the export.                                               | Nothing to fix.                                                 |
| `CMP_SPEC_INVALID`    | A character file is not valid. The message names the first problem.     | Check the file, or use a different copy.                        |
| `UX_PROJECT_INVALID`  | A project file is not valid. The current project is unchanged.          | Check the file, or use a different copy.                        |
| `UX_SAVE_FAILED`      | The browser refused to save the project.                                | See "Save failed" above.                                        |
| `UX_PANEL_CRASHED`    | One panel stopped working. The rest of the editor still works.          | See "A panel says" above.                                       |
| `PIX_DEVICE_LOST`     | The graphics device was reset during an export. No files were produced. | Export again.                                                   |

## Export is disabled: "is coming soon"

Your character uses a style or species that is not available yet, such as Stickman or Animal. The preview shows a fallback, and the export button says why. Choose an available style and species, such as Realistic or Chibi, and Human, to export. See [Styles and species](./anatomy/styles-and-species.md).

## The home screen opens with `UX_PROJECT_NOT_FOUND`

The project you tried to open was deleted, for example in another tab, or it is not in this browser. The home screen opens instead, with a warning. Choose another character from the lineup.

If you still need help, open an issue in the project's repository and include the code, the steps you took and your browser version. Do not attach files you do not want to share in public.
