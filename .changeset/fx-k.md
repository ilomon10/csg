---
'@csg/engine': minor
'@csg/parts-schema': minor
---

Tint `multiply` mode is now `texel.rgb × tint` (texel alpha kept) on both the unlit and the toon material paths, instead of `luminance(texel) × tint` (spec 001 REQ-CMP-014 as amended). A white tint shows the authored texture colours. The default character's seven tints are all `#ffffff`, so it renders in the authored Quaternius colours. `replace` mode is unchanged.
