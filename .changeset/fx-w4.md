---
'@csg/web': patch
---

Defer the engine chunk request until after first contentful paint (AC-GEN-007.3 c) and serve worker scripts from the preview server with the REQ-GEN-010 CSP header, read from the single `index.html` source (AC-GEN-015.3).
