---
'@csg/engine': patch
---

Make `@csg/engine/rig` the single DOM-free FK and math source: full-matrix `restWorldMatrices` (optional armature root) and `restWorldPositions`, plus exported quaternion (`quat*`) and matrix (`mat4*`) helpers. Retarget's `legLength` now measures through the rig FK, so rotated, non-uniformly scaled bones agree with anatomy and `assets:verify-rig`; the component-wise scale approximation is gone. Tools take their FK and matrix math from `@csg/engine/rig`.
