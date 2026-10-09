---
'@csg/engine': patch
---

Frame sampler union bounds: skinned meshes now contribute one stage-space box per bone cluster (vertices grouped by their dominant skin bone) instead of one box per mesh, so auto framing at diagonal yaws and elevated cameras stays within a few centimetres of the exact vertex bounds (REQ-PIX-007). Adds a look-review GPU export of the default Quaternius character.
