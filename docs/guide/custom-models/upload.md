---
title: Uploading a model
description: Upload a GLB, glTF or VRM file with the upload wizard, follow each step from checks to save, and learn which formats are accepted.
---

# Uploading a model

Uploads start with the **upload wizard**. The wizard checks your file, analyzes it, asks you to confirm what it is, and saves it to your library.

## Start an upload

You can start an upload in three ways:

- Click **Upload** in the part library, then pick your file or folder. Press `Enter` on the button to use the keyboard.
- Drag files or a folder anywhere onto the editor. A **Drop to upload** overlay appears while you drag.
- Open the command palette with `Ctrl+K`, then choose **Upload model**.

<!-- TODO(screenshot): upload wizard at the analysis step with a file being checked -->

## Accepted formats

| Format                    | File extension                 | Status        |
| ------------------------- | ------------------------------ | ------------- |
| Binary glTF               | `.glb`                         | Supported     |
| glTF with separate files  | `.gltf` with `.bin` and images | Supported     |
| VRM, versions 0.x and 1.0 | `.vrm`                         | Supported     |
| FBX                       | `.fbx`                         | Planned, beta |
| OBJ, static props only    | `.obj` with `.mtl`             | Planned       |

Compressed files (Draco, Meshopt and KTX2 textures) are supported. Everything the file needs must be in the same upload. A file that links to a web address is refused, because the editor does not load anything from the internet.

## Upload a folder

If your model uses separate texture files, drop the whole folder at once. The editor finds the main model file in the folder and links the textures to it. If the folder has two main model files, the editor asks you which one to use.

## The wizard steps

The progress bar shows each step as it runs:

1. **Checking**: the file type and size are checked before anything is read.
2. **Validating**: the file's structure is checked for errors.
3. **Parsing**: the model is read and its limits are measured.
4. **Analyzing rig**: the bones are matched to the base skeleton.
5. **Preparing**: the model is converted and a thumbnail is made.

Then the wizard asks you to:

- **Confirm the kind**: character, rigged part, static prop or animation clip. The editor proposes one.
- **Map bones or fit the prop**: see [Bone mapping](./bone-mapping.md) and [Props and sockets](./props-and-sockets.md).
- **Assign materials**: choose which tint each material should follow, such as skin or hair. The editor suggests one from the material name.
- **Record the license**: see [Licensing your uploads](./licensing.md).
- **Save**.

Analysis stops after 20 seconds, if a file takes that long. Warnings do not stop an upload. Errors do, and the wizard shows the code and a hint. See the table in [Troubleshooting](../troubleshooting.md).

## Cancel

Press `Escape` at any step, then confirm. Nothing is saved, and the editor deletes any temporary copies it made.

## Where uploads are stored

Saved uploads are kept in your browser's private storage, with a thumbnail. They appear in the part library, and you can use them right away without analyzing them again. The library shows how much space you have used.

> [!NOTE]
> **Planned.** FBX and OBJ support, and saving a bone map under a name for later uploads, are planned for a later release.

<!-- spec: REQ-UPL-004 -->
<!-- spec: REQ-UPL-005 -->
<!-- spec: REQ-UPL-009 -->
<!-- spec: REQ-UPL-015 -->
<!-- spec: REQ-UPL-016 -->
<!-- spec: REQ-UPL-037 -->
