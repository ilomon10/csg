---
title: Preparing models in Blender
description: Export a model from Blender as a GLB file with a skeleton, textures and limits that the editor accepts, so the upload succeeds the first time.
---

# Preparing models in Blender

The editor reads GLB, glTF and VRM files. Blender can export all three. A model that is prepared well uploads faster, maps to the skeleton more accurately, and avoids budget errors.

## Export checklist

- **Export as glTF 2.0 Binary (`.glb`).** Choose **File**, then **Export**, then **glTF 2.0**. Select **glTF Binary (.glb)** as the format.
- **Embed the textures** in the file. A single `.glb` is the simplest upload.
- **Apply the transforms** before export, so scale and rotation are zero on the mesh and the armature. Otherwise the model can appear at the wrong size.
- **Keep one armature.** Use one skeleton for the whole character.
- **Limit the bone count** to 128 or fewer. Remove helper bones that you do not animate.
- **Limit the triangle count.** A character can have up to 50,000 triangles. A rigged part or a prop can have up to 10,000.
- **Use textures up to 2048 pixels** on each side. The editor shrinks any texture larger than 1024 pixels.
- **Keep the materials to 16 or fewer.** Merge materials that look the same.
- **Use at most four bone weights per vertex.** Extra weights are removed, with a warning.

## Name your bones

The editor matches bones by name first, then by position in the skeleton. These naming schemes map most reliably:

- **Mixamo** names, such as `mixamorig:Hips` and `LeftArm`.
- **VRM humanoid** names, which VRM files include.
- **UE5 Mannequin** names, such as `pelvis` and `upperarm_l`.

Names that differ from these still work, but you will need to check the mapping. See [Bone mapping](./bone-mapping.md).

## Match the pose

Models rigged in a T-pose (arms straight out to the sides) or an A-pose (arms angled down) both work. The editor detects which one you used. Export the model in its rest pose, the pose it was rigged in, rather than a pose from an animation frame.

## Clothing for the base skeleton

A piece of clothing must use the same skeleton as the base character, with the same bone positions. A shirt rigged to another skeleton will not fit. Re-skin it to the base skeleton in Blender before upload. The editor does not transfer weights for you.

<!-- TODO(screenshot): Blender export dialog with glTF Binary selected -->

<!-- spec: REQ-UPL-012 -->
<!-- spec: REQ-UPL-017 -->
<!-- spec: REQ-UPL-030 -->
