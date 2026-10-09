---
'@csg/parts-schema': minor
'@csg/engine': patch
---

Parts-schema: add `exportManifestSchema` and `ExportManifest` for `<base>.manifest.json` (REQ-EXP-011, AC-EXP-011.1). Engine export tests validate generated manifests against it; the worker stays Zod-free. Tools: `textureLimit()` returns the spec limits (512 body, 256 other, AC-AST-010.3) and `AST_NORMALIZE_NONUNIFORM` names the armature node (AC-AST-011.2).
