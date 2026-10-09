---
'@csg/parts-schema': patch
---

Asset build: body `_REGION` is now constant per triangle (vertices shared across regions are duplicated), so seam triangles no longer interpolate into unrelated regions. Tools JSON boundaries go through `parseJson`, and the glTF reader refuses symlinks, bad percent-encoding and oversized accessor counts.
