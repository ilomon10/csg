---
'@csg/parts-schema': patch
'@csg/engine': patch
'@csg/web': patch
---

The default character and its default clips now live in one data file (`data/default-character.json`) read by `createDefaultCharacterSpec()`, the web preview and the default-set size check. `RigDefinition` validation names `rootBone` when it is not the joint with the null parent.
