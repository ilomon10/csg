---
title: Bone mapping
description: How your model's bones are matched to the base skeleton, what the confidence levels mean, which bones are required, and how to correct a mapping by hand.
---

# Bone mapping

Built-in clips play on the base skeleton. To make them play on your model, each bone of your model is matched to a bone of the base skeleton. This matching is called the **bone map**.

## Automatic matching

The editor tries these steps in order:

1. **Presets.** It checks whether your bone names match the **Mixamo**, **VRM humanoid** or **UE5 Mannequin** naming. A preset is used when it matches at least 60 percent of the required bones.
2. **Name matching.** Bone names are normalized, so `Bip01 L Thigh` and `thigh.L` can match.
3. **Alias list.** Common alternative names, such as `hips` and `pelvis`, are matched.
4. **Shape of the skeleton.** When names give no answer, the editor uses the hierarchy. For example, the bone with the most children near the top is the pelvis.

## Confidence

Each matched bone shows how sure the editor is:

| Confidence | Shown as | How it was found          |
| ---------- | -------- | ------------------------- |
| High       | High     | A preset, or the VRM data |
| Medium     | Medium   | A close name match        |
| Low        | Low      | The skeleton shape only   |
| Manual     | Manual   | You chose it yourself     |

Each level has a text label and an icon, so you do not need to tell colors apart.

## Required bones

Every character and clip needs these 15 bones. You cannot save until they are all matched.

- Pelvis, spine (lower), and head
- Upper arms, lower arms and hands, left and right
- Thighs, calves and feet, left and right

Other bones are optional. The clavicles, the upper spine, the neck, the toes and the fingers can stay unmapped. A bone left unmapped is not animated.

> [!NOTE]
> The required bone names are provisional. They may change before the first release.

<!-- TODO(screenshot): bone mapping list with the confidence labels and the 3D preview highlighting one bone -->

## Fix a mapping

1. Open the mapping list. Bones are grouped under Spine and head, Left arm, Right arm, Left leg, Right leg, and Optional.
2. Select a canonical bone, then choose the source bone from the searchable list.
3. The 3D preview highlights the bone you chose, so you can check it.
4. Use **Reset to auto** to undo your changes, or **Clear** to remove one mapping.

If you map one source bone to two canonical bones, the editor warns you and asks you to confirm.

## Rest pose

The editor classifies the rest pose from the upper-arm angle, as a T-pose or an A-pose. If it cannot tell, a notice asks you to choose **Treat as T-pose** or **Treat as A-pose** before the preview runs.

## Test the mapping

The preview plays a test clip on your model, next to the built-in character. Choose the clip from `idle`, `walk`, `run` and `attack_1`. The preview updates within half a second of a change. Turn on reduced motion in your system settings and the preview starts paused, with a **Play** button.

> [!NOTE]
> **Planned.** Saving a bone map under a name, so you can apply it to later uploads, is planned for a later release.

<!-- spec: REQ-UPL-017 -->
<!-- spec: REQ-UPL-018 -->
<!-- spec: REQ-UPL-019 -->
<!-- spec: REQ-UPL-020 -->
<!-- spec: REQ-UPL-021 -->
<!-- spec: REQ-UPL-022 -->
<!-- spec: REQ-UPL-024 -->
