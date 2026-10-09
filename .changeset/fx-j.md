---
'@csg/engine': minor
'@csg/parts-schema': minor
---

FX-J look (user D2 "brighter + punchier"): the rim is now a screen-space 1 px lit edge post stage (`post.rimEdge@1`, after coverage, before the outline) instead of the normal-based material rim; toon materials write their band brightness into the free G channel of the `partId` MRT target (`scene.light`). `outline.colorMode` now applies to the outer outline (default `black`) and the new `outline.inner.colorMode` (default `darken`) to inner lines; `toon.rim.width` is deprecated. New defaults: ambient 0.1, rim strength 0.5, resolution-relative `pivotRowPx` (AC-PIX-008.5), brighter ranger tints in the default character.
