---
'@csg/engine': patch
---

Socket props that inherit scale (the `head` socket by default) now take their joint's uniform anatomy world factor, including `height`, instead of the joint's scale relative to its parent (REQ-ANA-007, AC-ANA-007.3). A hat at `height = 1.2` now has world scale 1.2. Adds `anatomyUniformScales`.
