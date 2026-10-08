---
title: Budgets and limits
description: The triangle, texture, bone, material, morph, clip and memory limits for each kind of upload, and how the editor reports a model that goes over them.
---

# Budgets and limits

Limits keep the editor fast and stop a single file from using all of your browser's memory. The editor checks them before it saves an upload, and it lists every limit a model breaks, not just the first.

## Limits by kind

| Limit                      | Character | Rigged part | Static prop | Clip file            |
| -------------------------- | --------- | ----------- | ----------- | -------------------- |
| Triangles                  | 50,000    | 10,000      | 10,000      | not used             |
| Textures                   | 8         | 8           | 8           | not used             |
| Texture size, each side    | 2048 px   | 2048 px     | 2048 px     | not used             |
| Bones                      | 128       | 128         | not used    | 128                  |
| Bone influences per vertex | 4         | 4           | not used    | not used             |
| Materials                  | 16        | 16          | 16          | not used             |
| Morph targets              | 64        | 64          | 64          | not used             |
| Clips                      | not used  | not used    | not used    | 64, up to 120 s each |
| Memory once decoded        | 256 MB    | 256 MB      | 256 MB      | 256 MB               |

## Limits for every upload

- **Total file size**: 50 MB, across all the files in one upload.
- **Number of files**: 64 files in one upload.
- **Analysis time**: 20 seconds. If analysis takes longer, the editor stops it and tells you.

## What the editor does with a model over a limit

- **Textures larger than 1024 pixels** are shrunk to 1024 pixels on their longest side when you save. Textures up to 2048 pixels are accepted.
- **More than four bone weights per vertex** are reduced to the four largest. A warning tells you how many vertices changed.
- **Transparent materials** become cut-out materials, with a warning.
- **Everything else** blocks the save. The wizard shows the code and the count, such as "50001 triangles; the limit for a rigged part is 10000."

## Check before you upload

- Count the triangles in Blender's statistics overlay.
- Count the bones in the armature.
- Make sure no texture is larger than 2048 pixels.

See [Preparing models in Blender](./preparing-models.md) for how to reduce each one, and [Troubleshooting](../troubleshooting.md) for each error code.

<!-- spec: REQ-UPL-007 -->
<!-- spec: REQ-UPL-012 -->
<!-- spec: REQ-UPL-013 -->
<!-- spec: REQ-UPL-031 -->
<!-- spec: REQ-UPL-033 -->
