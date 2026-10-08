---
title: Custom models
description: Bring your own character, clothing, prop or animation into the editor, and learn what stays private on your device.
---

# Custom models

You can upload your own 3D models and use them alongside the built-in parts. An upload is stored only in your browser. It is never sent to a server, and it is never included in a share link.

## What you can upload

| Kind           | What it is                                               | Typical source                   |
| -------------- | -------------------------------------------------------- | -------------------------------- |
| Character      | A whole body, with its skeleton                          | A character from Mixamo or VRoid |
| Rigged part    | Clothing or hair that uses the base skeleton             | A part you made in Blender       |
| Static prop    | An item that is not skinned, such as a sword or a shield | A weapon or accessory model      |
| Animation clip | Animation on the base skeleton, without a mesh           | A Mixamo or Blender action       |

The editor works out which kind you have, then asks you to confirm it.

## Read the steps in order

1. [Preparing models](./preparing-models.md): get your model ready in Blender.
2. [Uploading a model](./upload.md): the wizard, the formats it accepts and the steps it runs through.
3. [Bone mapping](./bone-mapping.md): match your skeleton to the base skeleton.
4. [Props and sockets](./props-and-sockets.md): attach items to the hands, head and back.
5. [Budgets and limits](./budgets-and-limits.md): the size and complexity limits.
6. [Licensing your uploads](./licensing.md): the license you must record for each upload.

If an upload fails, see the upload errors in [Troubleshooting](../troubleshooting.md).

> [!IMPORTANT]
> Only upload models you have the right to use. The license you enter is saved with the model and appears in every export that uses it.

> [!NOTE]
> **Planned.** Uploading animation clips, importing FBX files (in beta), importing OBJ files as static props, and exporting your whole model library as one file are planned for a later release.

<!-- spec: REQ-UPL-001 -->
<!-- spec: REQ-UPL-006 -->
<!-- spec: REQ-UPL-011 -->
<!-- spec: REQ-UPL-047 -->
